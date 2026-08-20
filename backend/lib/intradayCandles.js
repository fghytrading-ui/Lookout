// Hourly candles for equities.
//
// Stocks were analysed on daily bars: one price point per session. That is
// enough to judge trend, but not enough to time an entry — the system could
// not see whether a name was breaking down or holding support at the moment
// it fired. The cost shows in the outcome data: 62% of losses resolved inside
// six hours having travelled only 24% of the way toward target. Those trades
// went wrong almost immediately, which is an entry-timing failure rather than
// a target or stop failure.
//
// Crypto already runs on 4h Binance bars and behaves better. This brings the
// same resolution to equities using Yahoo's 60-minute series, which returns
// ~443 bars over three months — comfortably enough for the 200-period
// indicators the engine uses.

import axios from 'axios';
import { registerCache } from './persistentCache.js';

const cache = new Map();
const TTL = 10 * 60_000;      // matches the daily-candle window
registerCache('intraday-candles', cache);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json'
};

// Share in-flight work, as the daily fetcher does — several cards and several
// concurrent users otherwise request the same series simultaneously.
const inFlight = new Map();
function coalesce(key, work) {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = work().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * Hourly OHLCV for one ticker, in the same shape as the daily series so the
 * signal engine consumes it unchanged.
 * Returns null on failure so callers can fall back to daily bars.
 */
export async function fetchIntradayCandles(ticker, { interval = '60m', range = '3mo' } = {}) {
  const key = `intraday:${ticker}:${interval}:${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;
  return coalesce(key, () => doFetch(ticker, interval, range, key));
}

async function doFetch(ticker, interval, range, key) {
  const fresh = cache.get(key);
  if (fresh && Date.now() - fresh.ts < TTL) return fresh.data;
  try {
    const { data } = await axios.get(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
      { params: { interval, range, includePrePost: false }, headers: HEADERS, timeout: 12000 }
    );
    const res = data?.chart?.result?.[0];
    const times = res?.timestamp || [];
    const q = res?.indicators?.quote?.[0] || {};
    if (!times.length) return null;

    const candles = [];
    for (let i = 0; i < times.length; i++) {
      if (q.open?.[i] == null || q.close?.[i] == null) continue;
      candles.push({
        date: new Date(times[i] * 1000).toISOString(),
        open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i],
        volume: q.volume[i] ?? 0
      });
    }
    // Below ~120 bars the 50/200-period averages degrade badly; fall back to
    // daily rather than compute indicators on too little history.
    if (candles.length < 120) return null;

    cache.set(key, { data: candles, ts: Date.now() });
    return candles;
  } catch {
    return null;
  }
}

export async function fetchIntradayBatch(tickers, opts = {}) {
  const out = {};
  const chunk = 10;
  for (let i = 0; i < tickers.length; i += chunk) {
    const slice = tickers.slice(i, i + chunk);
    const res = await Promise.allSettled(slice.map(t => fetchIntradayCandles(t, opts)));
    slice.forEach((t, j) => { out[t] = res[j].status === 'fulfilled' ? res[j].value : null; });
  }
  return out;
}
