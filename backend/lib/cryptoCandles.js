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

// Fetch klines for one symbol. interval: 1h, 4h, 1d. limit max 1000.
// Returns candles in our standard shape: [{date, open, high, low, close, volume}]
//
// `start` (ms) asks for bars FROM that moment rather than the latest ones. The
// outcome monitor needs this: it grades a trade on the bars that followed the
// signal, and asking for "the latest 200 hours" stopped covering a crypto trade
// once it was eight days old. On a host that sleeps, grading a week late is the
// normal case, and the trade was then scored on a week that had nothing to do
// with it.
export async function fetchCryptoCandles(yahooTicker, { interval = '4h', limit = 120, start = null } = {}) {
  const symbol = toSpotSymbol(yahooTicker);
  const cacheKey = `${symbol}:${interval}:${limit}:${start ?? ''}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const HOUR = 3600_000;
  const stepMs = { '1h': HOUR, '4h': 4 * HOUR, '1d': 24 * HOUR }[interval];

  // Binance geo-blocks US hosts, which is where Render runs. Coinbase serves
  // the same OHLC from US infrastructure — but it has no 4-hour granularity
  // (only 1m/5m/15m/1h/6h/1d). This used to map '4h' to Coinbase's 21600s,
  // which is SIX hours: on the live site the crypto board, calibrated
  // throughout on 4h bars, was quietly being built from 6h ones. Coinbase 4h is
  // now assembled from its 1h bars on the same UTC boundaries Binance uses.
  async function coinbaseRange(granSec, fromMs, toMs) {
    const product = symbol.replace(/USDT$/, '-USD');
    const out = [];
    const span = 300 * granSec * 1000;            // Coinbase caps a request at 300 bars
    for (let a = fromMs; a < toMs; a += span) {
      const b = Math.min(toMs, a + span);
      const { data } = await axios.get(
        `https://api.exchange.coinbase.com/products/${product}/candles`,
        { params: { granularity: granSec, start: new Date(a).toISOString(), end: new Date(b).toISOString() },
          headers: HEADERS, timeout: 8000 });
      if (Array.isArray(data)) out.push(...data);
    }
    // [time, low, high, open, close, volume], newest first, possibly overlapping
    const seen = new Map();
    for (const k of out) seen.set(k[0], {
      date: new Date(k[0] * 1000).toISOString(),
      low: k[1], high: k[2], open: k[3], close: k[4], volume: k[5]
    });
    return [...seen.values()].sort((x, y) => new Date(x.date) - new Date(y.date));
  }

  function toFourHour(hourly) {
    const buckets = new Map();
    for (const c of hourly) {
      const t = new Date(c.date).getTime();
      const b = Math.floor(t / (4 * HOUR)) * 4 * HOUR;
      const cur = buckets.get(b);
      if (!cur) buckets.set(b, { date: new Date(b).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, n: 1 });
      else { cur.high = Math.max(cur.high, c.high); cur.low = Math.min(cur.low, c.low); cur.close = c.close; cur.volume += c.volume; cur.n++; }
    }
    // Keep the still-forming bar, as Binance does — the crypto calibration was
    // built on Binance's series, which includes it. Drop only past buckets with
    // missing hours, where a gap in Coinbase's data would understate the range.
    const now = Date.now();
    return [...buckets.values()]
      .filter(b => b.n === 4 || new Date(b.date).getTime() + 4 * HOUR > now)
      .map(({ n, ...bar }) => bar);
  }

  const providers = [
    {
      name: 'binance',
      run: async () => {
        const params = { symbol, interval, limit };
        if (start != null) params.startTime = start;
        const { data } = await axios.get('https://api.binance.com/api/v3/klines', {
          params, headers: HEADERS, timeout: 8000
        });
        if (!Array.isArray(data) || !data.length) return null;
        return data.map(k => ({
          date: new Date(k[0]).toISOString(),
          open: parseFloat(k[1]), high: parseFloat(k[2]),
          low: parseFloat(k[3]),  close: parseFloat(k[4]),
          volume: parseFloat(k[5])
        }));
      }
    },
    {
      name: 'coinbase',
      run: async () => {
        if (!stepMs) return null;
        const from = start != null ? start : Date.now() - (limit + 2) * stepMs;
        const to = Math.min(Date.now(), from + (limit + 2) * stepMs);
        let bars;
        if (interval === '4h') bars = toFourHour(await coinbaseRange(3600, from, to));
        else bars = await coinbaseRange(stepMs / 1000, from, to);
        if (!bars.length) return null;
        return start != null ? bars.slice(0, limit) : bars.slice(-limit);
      }
    }
  ];

  // CRYPTO_SKIP_BINANCE=1 reproduces Render's path from a machine where
  // Binance is reachable, so the fallback can be tested where it actually runs.
  const order = process.env.CRYPTO_SKIP_BINANCE === '1' ? providers.filter(p => p.name !== 'binance') : providers;
  let lastErr = null;
  for (const p of order) {
    try {
      const candles = await p.run();
      if (candles && candles.length) {
        if (p.name !== 'binance') console.log(`[crypto] ${symbol} candles via ${p.name} (Binance unreachable)`);
        cache.set(cacheKey, { data: candles, ts: Date.now() });
        return candles;
      }
    } catch (err) { lastErr = err; }
  }
  // Caller decides whether to use Yahoo daily candles instead.
  return null;
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
