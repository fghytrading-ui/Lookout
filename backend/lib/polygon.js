// Polygon.io data feed — real-time, no rate limits.
// Activates when POLYGON_API_KEY is set in environment.
// Falls back to Yahoo when no key is present.
import axios from 'axios';

const API_KEY = process.env.POLYGON_API_KEY || '';
export const POLYGON_ENABLED = !!API_KEY;

const BASE = 'https://api.polygon.io';
const HEADERS = { Accept: 'application/json' };

// Fetch live quote — returns same shape as Yahoo's fetchQuote
export async function polygonQuote(ticker) {
  if (!POLYGON_ENABLED) throw new Error('Polygon not configured');
  const url = `${BASE}/v2/last/trade/${encodeURIComponent(ticker)}`;
  const { data } = await axios.get(url, {
    headers: HEADERS,
    params: { apiKey: API_KEY },
    timeout: 6000
  });
  const trade = data.results;
  return {
    symbol: ticker,
    price: trade.p,
    timestamp: new Date(trade.t / 1000000).toISOString(),
    source: 'polygon'
  };
}

// Fetch daily candles
export async function polygonHistorical(ticker, days = 90) {
  if (!POLYGON_ENABLED) throw new Error('Polygon not configured');
  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${start}/${end}`;
  const { data } = await axios.get(url, {
    headers: HEADERS,
    params: { apiKey: API_KEY, adjusted: 'true', sort: 'asc', limit: 5000 },
    timeout: 8000
  });
  if (!data.results) return [];
  return data.results.map(r => ({
    date: new Date(r.t).toISOString().split('T')[0],
    open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v
  }));
}

// Snapshot endpoint — returns full quote with day data
export async function polygonSnapshot(ticker) {
  if (!POLYGON_ENABLED) throw new Error('Polygon not configured');
  const url = `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`;
  const { data } = await axios.get(url, {
    headers: HEADERS,
    params: { apiKey: API_KEY },
    timeout: 6000
  });
  const t = data.ticker;
  return {
    symbol: ticker,
    price: t.day?.c || t.lastTrade?.p,
    change: t.todaysChange,
    changePercent: t.todaysChangePerc,
    open: t.day?.o, dayHigh: t.day?.h, dayLow: t.day?.l, volume: t.day?.v,
    previousClose: t.prevDay?.c,
    timestamp: new Date(t.updated / 1000000).toISOString(),
    source: 'polygon'
  };
}
