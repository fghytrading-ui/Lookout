// Finnhub.io free-tier integration — 60 calls/min, real-time US stocks.
// Use for fast live price updates; Yahoo continues to handle bulk scans + history.
import axios from 'axios';
import { registerCache } from './persistentCache.js';

const API_KEY = process.env.FINNHUB_API_KEY || '';
export const FINNHUB_ENABLED = !!API_KEY;

const BASE = 'https://finnhub.io/api/v1';
const cache = new Map();
const TTL = 8_000; // 8s — Finnhub real-time, near-instant
registerCache('finnhub-quotes', cache);

// ── RATE LIMITER ─────────────────────────────────────────────────────────
// The free tier allows 60 calls/min. The previous batch fetcher fired chunks
// back-to-back with no pacing, so a 40-ticker refresh every 10s produced
// ~240 calls/min — four times the cap. Finnhub throttled the key and the app
// silently degraded to delayed Yahoo data without ever reporting it.
//
// Token bucket: 60 tokens, refilled continuously at 1/sec. If no token is
// available we skip the call entirely rather than spending it on a guaranteed
// 429 — the caller falls back to Yahoo, and we stay under the cap so the key
// recovers instead of staying throttled.
const MAX_TOKENS = 55;              // headroom under the 60/min ceiling
const REFILL_PER_MS = 55 / 60_000;  // tokens per millisecond
let tokens = MAX_TOKENS;
let lastRefill = Date.now();

// Throttle state, exposed so the UI can tell the truth about the data source
let throttledUntil = 0;
let lastThrottleReason = null;

function refill() {
  const now = Date.now();
  tokens = Math.min(MAX_TOKENS, tokens + (now - lastRefill) * REFILL_PER_MS);
  lastRefill = now;
}

function takeToken() {
  refill();
  if (tokens >= 1) { tokens -= 1; return true; }
  return false;
}

export function getFinnhubHealth() {
  refill();
  const throttled = Date.now() < throttledUntil;
  return {
    enabled: FINNHUB_ENABLED,
    throttled,
    reason: throttled ? lastThrottleReason : null,
    tokensAvailable: Math.floor(tokens),
    capacity: MAX_TOKENS,
    retryInSec: throttled ? Math.ceil((throttledUntil - Date.now()) / 1000) : 0
  };
}

function markThrottled(reason, cooldownMs = 60_000) {
  throttledUntil = Date.now() + cooldownMs;
  lastThrottleReason = reason;
  tokens = 0;  // drain — stop hammering while the key recovers
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
    // 429 means we are already over the cap — back off for a full minute
    if (err.response?.status === 429) {
      markThrottled('Rate limit exceeded (60 calls/min free tier)');
    }
    throw err;
  }

  if (data?.error) {
    markThrottled(String(data.error));
    throw new Error(String(data.error));
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
