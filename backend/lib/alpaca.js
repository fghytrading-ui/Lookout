// Alpaca market data — daily bars, in bulk.
//
// Yahoo has been the binding constraint on this project for weeks. It rate-
// limits hard enough that a single session logged over 1,500 rejections, a
// full 150-instrument refresh took 69 seconds, and the ten-minute cache that
// throttling forced on us was why the board went stale between refreshes.
// Worse, it capped what could be TESTED: post-earnings drift died on one
// month of history, short-term reversal on 240 days, insider buying on three
// weeks. Every one of those was inconclusive for want of data rather than
// because the answer was known.
//
// Alpaca answers 126 symbols of daily bars in a single request in 1.2 seconds
// and carries six years of history. It is free, and the limit is 200 requests
// a minute — a ceiling we would have to try to reach.
//
// It is used for BARS only. Live quotes stay with Finnhub, whose real-time
// feed is consolidated; Alpaca's free tier is IEX-only, which is around 2.5%
// of volume and thinner than what a live price should be drawn from. Bars are
// a different matter: the free feed carries full market coverage there.
//
// Yahoo remains the fallback. If Alpaca is unconfigured or unreachable,
// everything works exactly as it did before.

import axios from 'axios';
import { registerCache } from './persistentCache.js';

const KEY    = process.env.ALPACA_KEY_ID || '';
const SECRET = process.env.ALPACA_SECRET_KEY || '';
export const ALPACA_ENABLED = !!(KEY && SECRET);

const BASE = 'https://data.alpaca.markets/v2';
const HEADERS = { 'APCA-API-KEY-ID': KEY, 'APCA-API-SECRET-KEY': SECRET };

const cache = new Map();
registerCache('alpaca-bars', cache);
const TTL = 60 * 1000;   // a minute: the request is cheap enough not to hoard

/** Alpaca bar -> the shape the rest of this codebase expects. */
function toCandle(b) {
  return {
    date:   String(b.t).slice(0, 10),
    open:   b.o,
    high:   b.h,
    low:    b.l,
    close:  b.c,
    volume: b.v
  };
}

/**
 * Daily bars for many symbols at once.
 * Returns { TICKER: [candle...] }. Symbols with no data are simply absent.
 */
export async function fetchDailyBarsBatch(tickers, { days = 200 } = {}) {
  if (!ALPACA_ENABLED || !tickers?.length) return {};

  // Only US equities. Crypto and FX use their own feeds.
  const symbols = [...new Set(tickers)].filter(t => /^[A-Z][A-Z.]{0,5}$/.test(t));
  if (!symbols.length) return {};

  const key = `bars:${days}:${symbols.join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const start = new Date(Date.now() - days * 1.6 * 86400000)  // calendar days for trading days
    .toISOString().slice(0, 10);

  const out = {};
  // The API pages large requests; follow the cursor rather than truncating.
  let pageToken = null;
  try {
    do {
      const { data } = await axios.get(`${BASE}/stocks/bars`, {
        headers: HEADERS, timeout: 30000,
        params: { symbols: symbols.join(','), timeframe: '1Day', start,
                  limit: 10000, feed: 'iex', adjustment: 'split',
                  ...(pageToken ? { page_token: pageToken } : {}) }
      });
      for (const [sym, bars] of Object.entries(data?.bars || {})) {
        (out[sym] ||= []).push(...bars.map(toCandle));
      }
      pageToken = data?.next_page_token || null;
    } while (pageToken);
  } catch {
    return hit?.data || {};      // fall back to whatever we had, then to Yahoo
  }

  for (const sym of Object.keys(out)) {
    out[sym].sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  cache.set(key, { data: out, ts: Date.now() });
  return out;
}

/** Daily bars for a single symbol, for backtesting and one-off lookups. */
export async function fetchDailyBars(ticker, { days = 200 } = {}) {
  const batch = await fetchDailyBarsBatch([ticker], { days });
  return batch[ticker] || null;
}
