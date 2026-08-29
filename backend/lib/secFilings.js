// SEC EDGAR material-event filings (8-K) — free, no key, official source.
//
// News aggregators were the only window onto company events, and they miss
// things. RGTI filed an executive change on 20 Aug 2026 while the twelve
// headlines the system held for it were "Is It Buyable at $26?" and an options
// chain listing. Filings are the document those outlets write FROM, so reading
// them directly means seeing the event when it is filed rather than when
// somebody rewrites it.
//
// The categories that matter most are the ones no news feed reliably covers:
// share dilution and going-concern doubt quietly kill a long position, and a
// small-cap board is exactly where they happen.
import axios from 'axios';
import { registerCache } from './persistentCache.js';

const cache = new Map();
registerCache('sec-filings', cache);

const TTL       = 60 * 60 * 1000;        // filings per ticker — hourly is plenty
const MAP_TTL   = 24 * 60 * 60 * 1000;   // ticker -> CIK map changes rarely
const LOOKBACK_DAYS = 21;

// SEC asks for a contactable User-Agent and throttles anonymous traffic.
const HEADERS = {
  'User-Agent': 'ProjectLookOut/1.0 (personal trading dashboard; fghy.services@gmail.com)',
  'Accept': 'application/json'
};

// 8-K item numbers, with what each actually means for a trade.
// direction: 'bearish' | 'bullish' | 'neutral'
const ITEMS = {
  '1.01': { label: 'Material agreement signed',        direction: 'bullish', weight: 7 },
  '1.02': { label: 'Material agreement terminated',    direction: 'bearish', weight: 7 },
  '1.03': { label: 'Bankruptcy or receivership',       direction: 'bearish', weight: 10 },
  '2.01': { label: 'Acquisition or disposal of assets',direction: 'bullish', weight: 6 },
  '2.02': { label: 'Results announced',                direction: 'neutral', weight: 8 },
  '2.03': { label: 'New debt obligation',              direction: 'bearish', weight: 5 },
  '2.04': { label: 'Debt acceleration or default',     direction: 'bearish', weight: 9 },
  '2.05': { label: 'Restructuring costs',              direction: 'bearish', weight: 5 },
  '2.06': { label: 'Asset write-down',                 direction: 'bearish', weight: 7 },
  '3.01': { label: 'Delisting notice',                 direction: 'bearish', weight: 10 },
  '3.02': { label: 'Shares issued — dilution',         direction: 'bearish', weight: 8 },
  '3.03': { label: 'Shareholder rights modified',      direction: 'bearish', weight: 5 },
  '4.01': { label: 'Auditor changed',                  direction: 'bearish', weight: 6 },
  '4.02': { label: 'Past accounts not reliable',       direction: 'bearish', weight: 10 },
  '5.01': { label: 'Change of control',                direction: 'bullish', weight: 9 },
  '5.02': { label: 'Executive or board change',        direction: 'neutral', weight: 5 },
  '5.03': { label: 'Bylaws or fiscal year changed',    direction: 'neutral', weight: 2 },
  '7.01': { label: 'Company disclosure',               direction: 'neutral', weight: 3 },
  '8.01': { label: 'Other material event',             direction: 'neutral', weight: 4 }
};

let tickerMap = null, tickerMapAt = 0;
let cikMap = null;          // reverse: CIK -> ticker, for the market-wide feed

async function loadTickerMap() {
  if (tickerMap && Date.now() - tickerMapAt <= MAP_TTL) return tickerMap;
  try {
    const { data } = await axios.get('https://www.sec.gov/files/company_tickers.json',
      { headers: HEADERS, timeout: 15000 });
    tickerMap = {}; cikMap = {};
    for (const v of Object.values(data || {})) {
      if (!v?.ticker) continue;
      const cik = String(v.cik_str).padStart(10, '0');
      tickerMap[v.ticker] = cik;
      cikMap[String(Number(v.cik_str))] = v.ticker;   // unpadded, as EDGAR prints it
    }
    tickerMapAt = Date.now();
  } catch { /* leave whatever we had */ }
  return tickerMap;
}

/** CIK (as it appears in an EDGAR feed) -> ticker. Null when not listed. */
export async function tickerForCik(cik) {
  await loadTickerMap();
  return cikMap?.[String(Number(cik))] || null;
}

async function getCik(ticker) {
  // Only US-listed equities file with the SEC — futures, FX and crypto do not.
  if (!/^[A-Z][A-Z.-]{0,5}$/.test(ticker)) return null;
  await loadTickerMap();
  return tickerMap?.[ticker] || null;
}

/**
 * Recent material filings for one ticker.
 * Returns { filings[], topRisk, summary } or null when the ticker is not an
 * SEC filer or nothing has been filed in the window.
 */
export async function fetchRecentFilings(ticker) {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const cik = await getCik(ticker);
  if (!cik) { cache.set(ticker, { data: null, ts: Date.now() }); return null; }

  try {
    const { data } = await axios.get(`https://data.sec.gov/submissions/CIK${cik}.json`,
      { headers: HEADERS, timeout: 15000 });
    const recent = data?.filings?.recent;
    if (!recent?.form) { cache.set(ticker, { data: null, ts: Date.now() }); return null; }

    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
    const filings = [];

    for (let i = 0; i < recent.form.length; i++) {
      if (recent.form[i] !== '8-K') continue;
      const filed = recent.filingDate[i];
      if (!filed || filed < cutoff) continue;

      const codes = String(recent.items[i] || '').split(',').map(c => c.trim()).filter(Boolean);
      const known = codes.map(c => ({ code: c, ...ITEMS[c] })).filter(x => x.label);
      if (!known.length) continue;

      // The most consequential item on the filing drives its headline.
      const lead = known.reduce((a, b) => (b.weight > a.weight ? b : a));
      const daysAgo = Math.round((Date.now() - new Date(`${filed}T12:00:00Z`)) / 86400000);

      filings.push({
        filed, daysAgo,
        label: lead.label,
        direction: lead.direction,
        weight: lead.weight,
        items: known.map(k => k.label),
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/`
           + `${String(recent.accessionNumber[i]).replace(/-/g, '')}/`
           + `${recent.primaryDocument[i] || ''}`
      });
    }

    if (!filings.length) { cache.set(ticker, { data: null, ts: Date.now() }); return null; }

    filings.sort((a, b) => b.filed.localeCompare(a.filed));
    const bearish = filings.filter(f => f.direction === 'bearish');
    const topRisk = bearish.length
      ? bearish.reduce((a, b) => (b.weight > a.weight ? b : a))
      : null;

    const out = {
      filings: filings.slice(0, 5),
      topRisk,
      summary: topRisk
        ? `${topRisk.label} filed ${topRisk.daysAgo === 0 ? 'today' : `${topRisk.daysAgo}d ago`}`
        : `${filings[0].label} filed ${filings[0].daysAgo === 0 ? 'today' : `${filings[0].daysAgo}d ago`}`
    };
    cache.set(ticker, { data: out, ts: Date.now() });
    return out;
  } catch {
    cache.set(ticker, { data: null, ts: Date.now() });
    return null;
  }
}
