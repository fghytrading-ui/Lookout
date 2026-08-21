import axios from 'axios';
import { registerCache } from './persistentCache.js';

// ── In-memory cache (avoids re-fetching within TTL) ───────────────────────
// TTL is per data type. Everything used to share an 8-second expiry, which
// meant a full scan re-downloaded three months of DAILY candles for every
// ticker every 8 seconds. Yahoo answered with hundreds of 429s and each one
// cost a 2-8s backoff, pushing a scan past 60 seconds.
//
// Daily candles change once a day, so they are cached for 30 minutes. Live
// price still updates every 8 seconds, and withLiveBar() splices the current
// quote onto the cached series — so indicators stay current without
// re-fetching history that has not changed.
const cache = new Map();
// 10 minutes rather than 30: fetchFull returns the quote alongside the
// candles, and that quote seeds the entry zone. Ten minutes keeps entry
// pricing sane while still cutting history fetches by ~75x. The displayed
// price is separately refreshed every 10s via /api/quotes/batch, and the
// frontend recomputes entry status against it.
const CACHE_TTL_MS = 8_000;             // quotes — supports 10s client polling
const CANDLE_TTL_MS = 10 * 60_000;      // daily candles — change once per day
const EXT_TTL_MS = 3 * 60_000;          // extended-hours bars
registerCache('yahoo-quotes', cache);

function ttlFor(key) {
  if (key.startsWith('full:'))   return CANDLE_TTL_MS;
  if (key.startsWith('weekly:')) return CANDLE_TTL_MS;
  if (key.startsWith('ext:'))    return EXT_TTL_MS;
  return CACHE_TTL_MS;
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlFor(key)) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ── HTTP helper with retry + backoff ──────────────────────────────────────
const AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function yahooGet(url, params, retries = 4) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent': AGENTS[attempt % AGENTS.length],
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://finance.yahoo.com/',
          'Origin': 'https://finance.yahoo.com'
        },
        params,
        timeout: 12000
      });
      return data;
    } catch (err) {
      const status = err.response?.status;
      if ((status === 429 || status === 503) && attempt < retries - 1) {
        const wait = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
        console.warn(`[yahoo] ${url.split('/').pop()} → ${status}, retry in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

// ── IN-FLIGHT REQUEST COALESCING ─────────────────────────────────────────
// The cache only helps once a response has landed. With several people
// loading at the same time — or one person's scan overlapping the next — the
// same ticker was fetched repeatedly in parallel because every caller missed
// the cache before any of them had filled it. Five simultaneous scans took
// 33-84s each for that reason.
//
// Callers now share a single in-flight promise per key: the first request
// does the work, everyone else awaits the same result.
const inFlight = new Map();

function coalesce(key, work) {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = work().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// ── Core fetch (quote + candles in one call) ──────────────────────────────
export async function fetchFull(ticker, range = '3mo') {
  const cacheKey = `full:${ticker}:${range}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  return coalesce(cacheKey, () => fetchFullUncached(ticker, range, cacheKey));
}

async function fetchFullUncached(ticker, range, cacheKey) {
  // Re-check: another caller may have completed while we queued
  const fresh = cacheGet(cacheKey);
  if (fresh) return fresh;

  const url  = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
  const data = await yahooGet(url, { interval: '1d', range, includePrePost: true });

  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const meta  = result.meta;
  const q     = result.indicators?.quote?.[0] || {};
  const ac    = result.indicators?.adjclose?.[0]?.adjclose || [];
  const times = result.timestamp || [];

  const candles = [];
  const rawCloses = [];   // unadjusted closes — adjclose skews the day change
  for (let i = 0; i < times.length; i++) {
    if (q.open?.[i] == null || q.close?.[i] == null) continue;
    candles.push({
      date:   new Date(times[i] * 1000).toISOString().split('T')[0],
      open:   q.open[i],  high: q.high[i],
      low:    q.low[i],   close: ac[i] ?? q.close[i],
      volume: q.volume[i] ?? 0
    });
    rawCloses.push(q.close[i]);
  }

  const price  = meta.regularMarketPrice;

  // meta.chartPreviousClose is the close before the START of the requested
  // range, not yesterday's close. Every caller using range='3mo'/'6mo' — which
  // includes the whole scan universe via fetchFullBatch — was therefore
  // measuring "today's move" against a three-to-six-month-old price. TSLA read
  // -13.16% on a day it was +5.14%; COIN read -3.65% on a +8.20% day.
  //
  // That is not cosmetic: reviewer.js rejects a LONG whose changePercent is
  // negative ("don't catch falling knives") and a SHORT whose changePercent is
  // positive, so a flipped sign silently discarded good setups and admitted
  // bad ones.
  //
  // Derive the reference from the candle series instead. Yahoo keeps the final
  // daily bar in step with the live price, so if the last close matches price
  // that bar is the current session and the one before it is the true previous
  // close; otherwise the last bar is already a completed prior session.
  let prev = null;
  if (rawCloses.length >= 2 && Number.isFinite(price)) {
    const lastClose = rawCloses[rawCloses.length - 1];
    const lastBarIsCurrentSession =
      Math.abs(price - lastClose) <= Math.max(0.01, Math.abs(price) * 0.0002);
    prev = lastBarIsCurrentSession ? rawCloses[rawCloses.length - 2] : lastClose;
  }
  // range='1d' returns a single bar, and there chartPreviousClose IS yesterday.
  if (!Number.isFinite(prev) || prev <= 0) {
    prev = meta.chartPreviousClose || meta.previousClose || price;
  }
  const chg    = price - (prev || price);
  const chgPct = prev ? (chg / prev) * 100 : 0;

  const out = {
    quote: {
      symbol:                   meta.symbol || ticker,
      price,
      previousClose:            prev,
      change:                   chg,
      changePercent:            chgPct,
      dayHigh:                  meta.regularMarketDayHigh,
      dayLow:                   meta.regularMarketDayLow,
      volume:                   meta.regularMarketVolume,
      fiftyTwoWeekHigh:         meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow:          meta.fiftyTwoWeekLow,
      marketState:              meta.marketState || 'CLOSED',
      preMarketPrice:           meta.preMarketPrice || null,
      postMarketPrice:          meta.postMarketPrice || null,
      currency:                 meta.currency || 'USD',
      exchangeName:             meta.exchangeName || meta.fullExchangeName || '',
      longName:                 meta.longName || meta.shortName || ticker,
      averageDailyVolume3Month: meta.averageDailyVolume3Month || null,
      timestamp:                new Date().toISOString()
    },
    candles
  };

  cacheSet(cacheKey, out);
  return out;
}

export async function fetchQuote(ticker) {
  const { quote } = await fetchFull(ticker, '1d');
  return quote;
}

export async function fetchHistorical(ticker, range = '3mo') {
  const { candles } = await fetchFull(ticker, range);
  return candles;
}

// Weekly candles for multi-timeframe trend confirmation
export async function fetchWeekly(ticker) {
  // Weekly candles were fetched fresh every time — uncached and uncoalesced —
  // once per reviewed card, so widening the review funnel multiplied them.
  // They change once a week; cache and share them like everything else.
  const cacheKey = `weekly:${ticker}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  return coalesce(cacheKey, () => fetchWeeklyUncached(ticker, cacheKey));
}

async function fetchWeeklyUncached(ticker, cacheKey) {
  const fresh = cacheGet(cacheKey);
  if (fresh) return fresh;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
  const data = await yahooGet(url, { interval: '1wk', range: '2y' });
  const result = data?.chart?.result?.[0];
  if (!result) return [];
  const q = result.indicators?.quote?.[0] || {};
  const times = result.timestamp || [];
  const candles = [];
  for (let i = 0; i < times.length; i++) {
    if (q.close?.[i] == null) continue;
    candles.push({
      date: new Date(times[i] * 1000).toISOString().split('T')[0],
      open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i],
      volume: q.volume[i] ?? 0
    });
  }
  cacheSet(cacheKey, candles);
  return candles;
}

// ── EXTENDED-HOURS (PRE / POST MARKET) ───────────────────────────────────
// The daily-chart meta does not carry preMarketPrice/postMarketPrice, so
// extended-hours action was invisible to the system. Intraday bars requested
// with includePrePost=true DO include it: any bar falling outside the regular
// session boundaries in meta.tradingPeriods is extended-hours trading.
//
// Returns { session, price, referenceClose, movePct, barTime } or null.
export async function fetchExtendedHours(ticker) {
  const cacheKey = `ext:${ticker}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null && cached !== undefined) return cached;

  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
    const data = await yahooGet(url, { interval: '5m', range: '2d', includePrePost: true });
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta  = result.meta;
    const times = result.timestamp || [];
    const q     = result.indicators?.quote?.[0] || {};
    if (!times.length) return null;

    // Normalise tradingPeriods — Yahoo returns either {regular:[[...]]} or [[...]]
    const tp = meta.tradingPeriods;
    const periods = Array.isArray(tp?.regular) ? tp.regular.flat()
                  : Array.isArray(tp)          ? tp.flat()
                  : null;
    if (!periods?.length) return null;

    const latestRegular = periods[periods.length - 1];
    const regStart = latestRegular.start;
    const regEnd   = latestRegular.end;

    // Reference for the gap = the last completed regular-session close.
    // meta.regularMarketPrice is exactly that: during pre-market it holds the
    // previous session's close, during post-market it holds today's close.
    // (Scanning bars for this is unreliable — the 2-day window can start
    // mid-session and silently pick a close from the wrong day.)
    const referenceClose = meta.regularMarketPrice
      ?? meta.chartPreviousClose
      ?? meta.previousClose;
    if (!referenceClose) return null;

    // Most recent bar outside regular hours
    let extPrice = null, extTime = null;
    for (let i = times.length - 1; i >= 0; i--) {
      const t = times[i];
      if (q.close?.[i] == null) continue;
      if (t > regEnd || t < regStart) { extPrice = q.close[i]; extTime = t; break; }
      break;  // newest bar is inside the session — no extended-hours activity
    }
    if (extPrice == null) { cacheSet(cacheKey, null); return null; }

    const movePct = ((extPrice - referenceClose) / referenceClose) * 100;
    const out = {
      session: extTime > regEnd ? 'post' : 'pre',
      price: extPrice,
      referenceClose,
      movePct: parseFloat(movePct.toFixed(2)),
      barTime: new Date(extTime * 1000).toISOString()
    };
    cacheSet(cacheKey, out);
    return out;
  } catch {
    return null;
  }
}

// Batched fetches with concurrency cap + inter-chunk delay
export async function fetchBatch(tickers, { concurrency = 3, delayMs = 600 } = {}) {
  const results = {};
  const chunks  = [];
  for (let i = 0; i < tickers.length; i += concurrency) chunks.push(tickers.slice(i, i + concurrency));

  for (let ci = 0; ci < chunks.length; ci++) {
    if (ci > 0) await sleep(delayMs);
    const settled = await Promise.allSettled(chunks[ci].map(t => fetchQuote(t)));
    settled.forEach((r, i) => {
      const sym = chunks[ci][i];
      results[sym] = r.status === 'fulfilled' ? r.value : { error: true, ticker: sym, timestamp: new Date().toISOString() };
    });
  }
  return results;
}

// Pacing tuned for a ~200-name universe. At concurrency 3 / 600ms a full scan
// took over two and a half minutes, which is unusable when the host sleeps and
// most visits start cold. Yahoo tolerates this rate because daily candles cache
// for 10 minutes, so only the first scan of each window actually hits the
// network; the retry/backoff path still handles any 429s that do occur.
export async function fetchFullBatch(tickers, { concurrency = 12, delayMs = 120 } = {}) {
  const results = {};
  const chunks  = [];
  for (let i = 0; i < tickers.length; i += concurrency) chunks.push(tickers.slice(i, i + concurrency));

  for (let ci = 0; ci < chunks.length; ci++) {
    if (ci > 0) await sleep(delayMs);
    const settled = await Promise.allSettled(chunks[ci].map(t => fetchFull(t, '3mo')));
    settled.forEach((r, i) => {
      const sym = chunks[ci][i];
      results[sym] = r.status === 'fulfilled' ? r.value : { error: true, ticker: sym };
    });
  }
  return results;
}
