// Market-wide catalyst discovery.
//
// Every catalyst source in this codebase was per-ticker: given a symbol, tell
// me if it has news. That can only ever CONFIRM a catalyst on a stock
// something else already picked — it can never FIND one.
//
// And what picked them was price. The scan universe comes from Yahoo's
// most-actives, day-gainers and day-losers screens, so a name qualified by
// having already moved. That is the chasing problem measured elsewhere in this
// record: the session after a signal is right 37.6% of the time against 44.8%
// for a random entry on the same stocks, because the move had already
// happened. It also explains why real catalysts were scarce — 62% of signals
// carried none at all, and 19 of the 44 that did were analyst upgrades, the
// weakest kind. A company that just filed something material but has not moved
// yet was invisible.
//
// This inverts it: start from the event, then ask whether it is tradeable.
//
// Two feeds, both market-wide, both free:
//   SEC EDGAR 8-K firehose — unscheduled material events. Companies are
//     legally required to file within four business days, so this is the
//     primary source rather than a report of one.
//   Finnhub earnings calendar — scheduled events, known in advance.

import axios from 'axios';
import { registerCache } from './persistentCache.js';
import { tickerForCik } from './secFilings.js';

const cache = new Map();
registerCache('catalyst-feed', cache);

const FILINGS_TTL  = 10 * 60_000;   // EDGAR updates continuously through the day
const EARNINGS_TTL = 6 * 60 * 60_000;

const SEC_HEADERS = {
  'User-Agent': 'ProjectLookOut/1.0 (personal trading dashboard; fghy.services@gmail.com)',
  'Accept': 'application/atom+xml'
};

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';

// EDGAR lists every security a filer has registered, so the raw feed is full
// of warrants, units and rights — BNAIW, MOBXW, AENTW and so on. They share
// the parent's news and none of its liquidity, and each one would occupy a
// slot in a capped scan universe.
function isCommonStock(ticker) {
  if (!/^[A-Z]{1,5}$/.test(ticker)) return false;          // no dots, dashes, digits
  if (ticker.length === 5 && /[WUR]$/.test(ticker)) return false;  // warrant / unit / right
  return true;
}

/**
 * The most recent 8-K filings across every SEC filer, newest first.
 * Returns [{ ticker, company, filedAt, cik }].
 */
export async function fetchRecent8Ks({ count = 100 } = {}) {
  const hit = cache.get('8k');
  if (hit && Date.now() - hit.ts < FILINGS_TTL) return hit.data;

  try {
    const { data } = await axios.get('https://www.sec.gov/cgi-bin/browse-edgar', {
      params: { action: 'getcurrent', type: '8-K', company: '', dateb: '',
                owner: 'include', count, output: 'atom' },
      headers: SEC_HEADERS, timeout: 15000
    });
    const xml = String(data || '');
    const entries = xml.split('<entry>').slice(1);
    const out = [];
    for (const e of entries) {
      // "8-K - COMPANY NAME (0001234567) (Filer)"
      const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const m = title.match(/^\s*8-K[^-]*-\s*(.+?)\s*\((\d{7,10})\)/);
      if (!m) continue;
      const updated = (e.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1] || null;
      const ticker = await tickerForCik(m[2]);
      if (!ticker) continue;                     // private or non-listed filer
      if (!isCommonStock(ticker)) continue;      // warrants, units, rights
      out.push({ ticker, company: m[1].trim(), cik: m[2],
                 filedAt: updated ? new Date(updated).getTime() : Date.now() });
    }
    // One entry per company — a filer can appear several times in a session.
    const seen = new Set();
    const unique = out.filter(f => !seen.has(f.ticker) && seen.add(f.ticker));
    cache.set('8k', { data: unique, ts: Date.now() });
    return unique;
  } catch {
    return hit?.data || [];
  }
}

/**
 * Companies that have JUST REPORTED, market-wide.
 *
 * Deliberately backward-looking. An upcoming report is not a trade, it is a
 * coin toss on a number nobody has seen, and the risk rules elsewhere already
 * reject any setup within five days of one — so seeding the universe with
 * companies about to report would fill it with names guaranteed to be thrown
 * out. The tradeable event is the reaction: the report is public, the
 * uncertainty is resolved, and the drift afterwards is one of the few
 * genuinely documented effects in equities.
 *
 * Returns [{ ticker, date, hour, epsEstimate, epsActual, surprisePct }].
 */
export async function fetchEarningsCalendar({ daysBack = 3 } = {}) {
  if (!FINNHUB_KEY) return [];
  const key = `earnings:back${daysBack}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < EARNINGS_TTL) return hit.data;

  const iso = (d) => d.toISOString().slice(0, 10);
  const from = new Date(Date.now() - daysBack * 86400000), to = new Date();
  try {
    const { data } = await axios.get('https://finnhub.io/api/v1/calendar/earnings', {
      params: { from: iso(from), to: iso(to), token: FINNHUB_KEY }, timeout: 12000
    });
    const out = (data?.earningsCalendar || [])
      .filter(e => e?.symbol && isCommonStock(e.symbol))
      .map(e => {
        const est = e.epsEstimate, act = e.epsActual;
        // A percentage against a near-zero estimate is arithmetic noise: a
        // one-cent beat on a 0.001 estimate prints as "beat by 1218%", which
        // says nothing about the size of the surprise. Below a sane
        // denominator, report the direction and leave the number out.
        const usable = Number.isFinite(est) && Number.isFinite(act) && Math.abs(est) >= 0.10;
        const surprisePct = usable ? ((act - est) / Math.abs(est)) * 100 : null;
        const beat = Number.isFinite(est) && Number.isFinite(act) ? act > est : null;
        return { ticker: e.symbol, date: e.date, hour: e.hour || null,
                 epsEstimate: est ?? null, epsActual: act ?? null, surprisePct, beat };
      })
      // Only where the number is actually out. A row with no actual is a
      // scheduled report that has not happened.
      .filter(e => Number.isFinite(e.epsActual));
    cache.set(key, { data: out, ts: Date.now() });
    return out;
  } catch {
    return hit?.data || [];
  }
}

/**
 * Today's catalyst names, each with the reason it is here.
 *
 * Deliberately does NOT judge tradeability — liquidity, price and volume gates
 * live in the universe builder and the signal engine, and duplicating them
 * here would put the same threshold in three places.
 */
export async function getCatalystNames({ earningsDaysBack = 3 } = {}) {
  const [filings, earnings] = await Promise.all([
    fetchRecent8Ks({ count: 100 }),
    fetchEarningsCalendar({ daysBack: earningsDaysBack })
  ]);

  const byTicker = new Map();
  const add = (ticker, source, reason, at) => {
    if (!ticker) return;
    const prev = byTicker.get(ticker);
    if (prev) { prev.reasons.push(reason); return; }
    byTicker.set(ticker, { ticker, source, reasons: [reason], at: at || Date.now() });
  };

  for (const f of filings) {
    add(f.ticker, 'sec-8k', `8-K filed by ${f.company}`, f.filedAt);
  }
  for (const e of earnings) {
    let note = '';
    if (e.surprisePct != null) {
      // Percentages past a couple of hundred are arithmetically real but
      // unreadable — they come from a swing through zero, not from a bigger
      // surprise than the next one down. Say "more than" and stop counting.
      const p = Math.abs(e.surprisePct);
      const size = p > 200 ? 'more than 200%' : `${p.toFixed(0)}%`;
      note = e.surprisePct > 2  ? ` — beat by ${size}`
           : e.surprisePct < -2 ? ` — missed by ${size}`
           : ' — in line';
    } else if (e.beat !== null && e.beat !== undefined) {
      note = e.beat ? ' — beat' : ' — missed';
    }
    add(e.ticker, 'earnings', `Reported ${e.date}${note}`);
  }

  return [...byTicker.values()].sort((a, b) => b.at - a.at);
}
