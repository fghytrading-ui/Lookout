// Finnhub.io free-tier integration — 60 calls/min, real-time US stocks.
// Use for fast live price updates; Yahoo continues to handle bulk scans + history.
import axios from 'axios';
import { registerCache } from './persistentCache.js';

const API_KEY = process.env.FINNHUB_API_KEY || '';
export const FINNHUB_ENABLED = !!API_KEY;

const BASE = 'https://finnhub.io/api/v1';
const cache = new Map();
// 20s rather than 8s. The tape polls every 10s across ~20 symbols; at an
// 8-second TTL almost every poll was a cache miss, spending the entire
// minute's budget on a decorative price strip. Twenty-second-old Finnhub
// data is still far fresher than the 15-minute-delayed Yahoo fallback.
const TTL = 20_000;
registerCache('finnhub-quotes', cache);

// ── RATE LIMITER ─────────────────────────────────────────────────────────
// The free tier allows 60 calls/min. Two things were burning it:
//
//  1. The original batch fetcher fired chunks with no pacing at all.
//  2. The token bucket that replaced it still overshot. A full bucket (55)
//     could be spent immediately AND refill through the same minute, so the
//     real ceiling was ~110 calls/min — the key kept getting throttled while
//     the limiter still reported budget remaining.
//
// This is an exact sliding window instead: every call timestamp is recorded
// and a new call is only allowed when fewer than MAX_PER_MIN sit inside the
// trailing 60 seconds. No burst can exceed the cap.
const MAX_PER_MIN = 50;           // headroom under the 60/min ceiling
let callTimes = [];               // timestamps of calls in the trailing minute

// Throttle state, exposed so the UI can tell the truth about the data source
let throttledUntil = 0;
let lastThrottleReason = null;

function pruneWindow() {
  const cutoff = Date.now() - 60_000;
  if (callTimes.length && callTimes[0] < cutoff) {
    callTimes = callTimes.filter(t => t >= cutoff);
  }
}

function takeToken() {
  pruneWindow();
  if (callTimes.length >= MAX_PER_MIN) return false;
  callTimes.push(Date.now());
  return true;
}

export function getFinnhubHealth() {
  pruneWindow();
  const throttled = Date.now() < throttledUntil;
  return {
    enabled: FINNHUB_ENABLED,
    throttled,
    reason: throttled ? lastThrottleReason : null,
    usedThisMinute: callTimes.length,
    capacity: MAX_PER_MIN,
    tokensAvailable: Math.max(0, MAX_PER_MIN - callTimes.length),
    retryInSec: throttled ? Math.ceil((throttledUntil - Date.now()) / 1000) : 0
  };
}

function markThrottled(reason, cooldownMs = 90_000) {
  throttledUntil = Date.now() + cooldownMs;
  lastThrottleReason = reason;
  callTimes = new Array(MAX_PER_MIN).fill(Date.now());  // block until window clears
}

// Fetch a single live quote — works for US stocks
export async function fetchFinnhubQuote(ticker) {
  if (!FINNHUB_ENABLED) throw new Error('Finnhub not configured');
  // Finnhub doesn't support some symbols (forex pairs in =X format, futures =F)
  if (ticker.includes('=') || ticker.includes('-USD')) {
    throw new Error('Symbol not supported by Finnhub free tier');
  }

  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  // Respect the cooldown after a throttle rather than burning more calls
  if (Date.now() < throttledUntil) throw new Error('Finnhub throttled — using fallback');
  if (!takeToken()) throw new Error('Finnhub rate budget spent — using fallback');

  let data;
  try {
    ({ data } = await axios.get(`${BASE}/quote`, {
      params: { symbol: ticker, token: API_KEY },
      timeout: 6000
    }));
  } catch (err) {
    // Only an actual rate-limit response should stop the whole integration.
    if (err.response?.status === 429) {
      markThrottled('Rate limit exceeded (60 calls/min free tier)');
    }
    throw err;
  }

  // A per-symbol error is NOT a rate limit. Finnhub returns an error object
  // for symbols the free tier cannot serve, and treating that as a global
  // throttle meant one unsupported ETF in the ticker tape disabled real-time
  // pricing for every symbol — the app then ran on delayed Yahoo data and
  // displayed "FINNHUB LIMIT" while the key was healthy with 49 of 60 calls
  // still available. Only genuine rate-limit wording trips the breaker.
  if (data?.error) {
    const msg = String(data.error);
    if (/rate limit|too many requests|limit reached/i.test(msg)) {
      markThrottled(msg);
    }
    throw new Error(msg);
  }

  if (!data || data.c == null || data.c === 0) {
    throw new Error(`No quote for ${ticker}`);
  }

  const result = {
    ticker, source: 'finnhub',
    price: data.c, change: data.d, changePercent: data.dp,
    open: data.o, dayHigh: data.h, dayLow: data.l, previousClose: data.pc,
    timestamp: data.t ? new Date(data.t * 1000).toISOString() : new Date().toISOString()
  };
  cache.set(ticker, { data: result, ts: Date.now() });
  return result;
}

// Batch fetch, paced by the token bucket above. Chunks are separated by a
// short delay so a large watchlist refresh cannot burst past the cap; any
// ticker that cannot get a token is simply omitted and the caller falls back
// to Yahoo for it.
export async function fetchFinnhubBatch(tickers, { concurrency = 5 } = {}) {
  if (!FINNHUB_ENABLED) throw new Error('Finnhub not configured');
  const results = {};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < tickers.length; i += concurrency) {
    if (Date.now() < throttledUntil) break;   // stop early while cooling down
    if (i > 0) await sleep(1100);             // ~5 calls/1.1s ≈ 55/min
    const chunk = tickers.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map(t => fetchFinnhubQuote(t)));
    settled.forEach((r, idx) => {
      const sym = chunk[idx];
      if (r.status === 'fulfilled') {
        results[sym] = {
          ticker: sym,
          price: r.value.price,
          change: r.value.change,
          changePercent: r.value.changePercent,
          timestamp: r.value.timestamp,
          source: 'finnhub'
        };
      }
      // Failed lookups silently fall through — caller may retry via Yahoo
    });
  }
  return results;
}
