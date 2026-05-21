import axios from 'axios';
import { registerCache } from './persistentCache.js';

// ── In-memory cache (avoids re-fetching within TTL) ───────────────────────
const cache = new Map();
const CACHE_TTL_MS = 8_000; // 8 seconds — supports 10-second client polling
registerCache('yahoo-quotes', cache);

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
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

// ── Core fetch (quote + candles in one call) ──────────────────────────────
export async function fetchFull(ticker, range = '3mo') {
  const cacheKey = `full:${ticker}:${range}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url  = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
  const data = await yahooGet(url, { interval: '1d', range, includePrePost: true });

  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const meta  = result.meta;
  const q     = result.indicators?.quote?.[0] || {};
  const ac    = result.indicators?.adjclose?.[0]?.adjclose || [];
  const times = result.timestamp || [];

  const candles = [];
  for (let i = 0; i < times.length; i++) {
    if (q.open?.[i] == null || q.close?.[i] == null) continue;
    candles.push({
      date:   new Date(times[i] * 1000).toISOString().split('T')[0],
      open:   q.open[i],  high: q.high[i],
      low:    q.low[i],   close: ac[i] ?? q.close[i],
      volume: q.volume[i] ?? 0
    });
  }

  const prev   = meta.chartPreviousClose || meta.previousClose || (candles.length > 1 ? candles[candles.length - 2].close : meta.regularMarketPrice);
  const price  = meta.regularMarketPrice;
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
  return candles;
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

export async function fetchFullBatch(tickers, { concurrency = 3, delayMs = 600 } = {}) {
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
