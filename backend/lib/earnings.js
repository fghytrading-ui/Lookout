import axios from 'axios';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

// Cache earnings dates for 24 hours — they don't change
const cache = new Map();
const TTL = 24 * 60 * 60 * 1000;

// Yahoo's chart endpoint includes `earningsTimestamp` in meta when available
// This is the most reliable free way to get next-earnings date
export async function fetchNextEarnings(ticker) {
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  try {
    // Use the chart endpoint with metadata flag — returns earningsTimestamp
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
    const { data } = await axios.get(url, {
      headers: HEADERS,
      params: { interval: '1d', range: '5d' },
      timeout: 8000
    });
    const meta = data?.chart?.result?.[0]?.meta;
    let earningsTs = null;
    if (meta?.earningsTimestamp) earningsTs = meta.earningsTimestamp * 1000;
    // Some tickers expose an array
    if (Array.isArray(meta?.earningsTimestamps) && meta.earningsTimestamps[0]) {
      earningsTs = meta.earningsTimestamps[0] * 1000;
    }

    const result = earningsTs ? { date: new Date(earningsTs).toISOString(), timestamp: earningsTs } : null;
    cache.set(ticker, { data: result, ts: Date.now() });
    return result;
  } catch {
    cache.set(ticker, { data: null, ts: Date.now() });
    return null;
  }
}

// Returns 'BLOCK' | 'WARN' | 'OK'
//   BLOCK = earnings within next 5 calendar days → reject trade
//   WARN  = earnings within next 6–10 days → caution
//   OK    = > 10 days away or no data
export function evaluateEarningsRisk(earningsData) {
  if (!earningsData?.timestamp) return { status: 'OK', daysAway: null };
  const now = Date.now();
  const ms = earningsData.timestamp - now;
  if (ms < 0) return { status: 'OK', daysAway: null }; // Past earnings
  const daysAway = ms / (1000 * 60 * 60 * 24);
  if (daysAway <= 5)  return { status: 'BLOCK', daysAway: Math.round(daysAway), date: earningsData.date };
  if (daysAway <= 10) return { status: 'WARN',  daysAway: Math.round(daysAway), date: earningsData.date };
  return { status: 'OK', daysAway: Math.round(daysAway), date: earningsData.date };
}
