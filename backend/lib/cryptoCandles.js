// Intraday OHLCV candles for crypto from Binance public klines API.
// Free, no key, high rate limit (1200 weight/min). Per-bar volume is REAL
// (unlike CoinGecko's market_chart which returns rolling 24h volume).
//
// Maps our Yahoo ticker (BTC-USD) → Binance symbol (BTCUSDT) and returns
// candles in the same shape as yahoo.js so signals.js works unchanged.

import axios from 'axios';
import { registerCache } from './persistentCache.js';
import { tickerToBinanceSymbol } from './cryptoContext.js';

const cache = new Map();
const TTL = 5 * 60 * 1000; // 5 min — matches scan cadence
registerCache('crypto-candles', cache);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
};

// Some Binance perp listings differ from spot — fall back map for edge cases.
const SPOT_FALLBACK = {
  'TON11419USDT': 'TONUSDT', // our Yahoo ticker → Binance spot symbol
  // PEPE spot on Binance is just PEPEUSDT (1000PEPEUSDT is perps-only)
  // MATIC/POL — Binance keeps both listed; default mapping (MATICUSDT) works
};

function toSpotSymbol(yahooTicker) {
  const binance = tickerToBinanceSymbol(yahooTicker); // BTCUSDT, MATICUSDT, etc.
  return SPOT_FALLBACK[binance] || binance;
}

// Fetch klines for one symbol. interval: 1m, 5m, 15m, 1h, 4h, 1d. limit max 1000.
// Returns candles in our standard shape: [{date, open, high, low, close, volume}]
export async function fetchCryptoCandles(yahooTicker, { interval = '4h', limit = 120 } = {}) {
  const symbol = toSpotSymbol(yahooTicker);
  const cacheKey = `${symbol}:${interval}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  try {
    const { data } = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval, limit },
      headers: HEADERS,
      timeout: 8000
    });
    if (!Array.isArray(data) || data.length === 0) return null;

    const candles = data.map(k => ({
      date: new Date(k[0]).toISOString(),       // open time
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low:  parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])                   // base asset volume per bar (real per-bar vol)
    }));

    cache.set(cacheKey, { data: candles, ts: Date.now() });
    return candles;
  } catch (err) {
    // Fall back gracefully — caller decides whether to use Yahoo daily candles instead
    return null;
  }
}

// Batch fetch with mild concurrency to stay well under Binance rate limits
export async function fetchCryptoCandlesBatch(tickers, opts = {}) {
  const concurrency = 6;
  const out = {};
  for (let i = 0; i < tickers.length; i += concurrency) {
    const chunk = tickers.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map(t => fetchCryptoCandles(t, opts)));
    chunk.forEach((t, j) => {
      out[t] = results[j].status === 'fulfilled' ? results[j].value : null;
    });
  }
  return out;
}

// Session VWAP — cumulative (price × volume) / cumulative volume, reset at UTC midnight.
// Returns { vwap, distance, distancePct, side } for the LAST bar in the series.
// Crypto convention: session = UTC day. Pros use VWAP as both a magnet and a bias filter.
export function computeSessionVWAP(candles) {
  if (!candles || candles.length === 0) return null;

  // Walk backwards to find the most recent UTC midnight, then accumulate forward
  const lastBar = candles[candles.length - 1];
  const lastTs = new Date(lastBar.date);
  const sessionStart = new Date(Date.UTC(
    lastTs.getUTCFullYear(), lastTs.getUTCMonth(), lastTs.getUTCDate(), 0, 0, 0
  ));

  let cumPV = 0;
  let cumV  = 0;
  for (const c of candles) {
    const t = new Date(c.date);
    if (t < sessionStart) continue;
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV  += c.volume;
  }
  if (cumV === 0) return null;

  const vwap = cumPV / cumV;
  const lastClose = lastBar.close;
  const distance = lastClose - vwap;
  const distancePct = (distance / vwap) * 100;
  const side = distance >= 0 ? 'ABOVE' : 'BELOW';

  return {
    vwap: parseFloat(vwap.toFixed(vwap > 100 ? 2 : vwap > 1 ? 4 : 6)),
    distance: parseFloat(distance.toFixed(vwap > 100 ? 2 : vwap > 1 ? 4 : 6)),
    distancePct: parseFloat(distancePct.toFixed(2)),
    side
  };
}
