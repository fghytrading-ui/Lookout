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

// Fetch a single live quote — works for US stocks
export async function fetchFinnhubQuote(ticker) {
  if (!FINNHUB_ENABLED) throw new Error('Finnhub not configured');
  // Finnhub doesn't support some symbols (forex pairs in =X format, futures =F)
  if (ticker.includes('=') || ticker.includes('-USD')) {
    throw new Error('Symbol not supported by Finnhub free tier');
  }

  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const { data } = await axios.get(`${BASE}/quote`, {
    params: { symbol: ticker, token: API_KEY },
    timeout: 6000
  });

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

// Batch with rate-limit awareness (60/min = 1/sec safe; we use small bursts)
export async function fetchFinnhubBatch(tickers, { concurrency = 5 } = {}) {
  if (!FINNHUB_ENABLED) throw new Error('Finnhub not configured');
  const results = {};
  for (let i = 0; i < tickers.length; i += concurrency) {
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
