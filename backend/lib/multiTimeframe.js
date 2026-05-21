// Multi-timeframe trend analysis — checks 4h / daily / weekly / monthly alignment
import axios from 'axios';
import { calculateSMA } from '../utils/signals.js';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

async function fetchYahooCandles(ticker, interval, range) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
  const { data } = await axios.get(url, {
    headers: HEADERS,
    params: { interval, range },
    timeout: 10000
  });
  const result = data?.chart?.result?.[0];
  if (!result) return [];
  const q = result.indicators?.quote?.[0] || {};
  const times = result.timestamp || [];
  const closes = [];
  for (let i = 0; i < times.length; i++) {
    if (q.close?.[i] != null) closes.push(q.close[i]);
  }
  return closes;
}

// Determine trend on a given timeframe: UP / DOWN / NEUTRAL
function classifyTrend(closes, smaLen = 20) {
  if (!closes || closes.length < smaLen + 5) return 'NEUTRAL';
  const price = closes[closes.length - 1];
  const sma = calculateSMA(closes, smaLen);
  if (!sma) return 'NEUTRAL';
  // Check SMA slope (is it rising or falling?)
  const slice = closes.slice(0, -5);
  const smaEarlier = calculateSMA(slice, smaLen);
  if (!smaEarlier) return 'NEUTRAL';
  const slopeUp = sma > smaEarlier;
  if (price > sma && slopeUp) return 'UP';
  if (price < sma && !slopeUp) return 'DOWN';
  return 'NEUTRAL';
}

// Compute trend on all timeframes
export async function getMultiTimeframeTrends(ticker) {
  const [h4, daily, weekly, monthly] = await Promise.allSettled([
    fetchYahooCandles(ticker, '1h', '1mo'),      // ~120 4h-equivalent candles
    fetchYahooCandles(ticker, '1d', '3mo'),
    fetchYahooCandles(ticker, '1wk', '2y'),
    fetchYahooCandles(ticker, '1mo', '5y')
  ]);

  return {
    h4:      h4.status      === 'fulfilled' ? classifyTrend(h4.value, 20)      : 'NEUTRAL',
    daily:   daily.status   === 'fulfilled' ? classifyTrend(daily.value, 20)   : 'NEUTRAL',
    weekly:  weekly.status  === 'fulfilled' ? classifyTrend(weekly.value, 20)  : 'NEUTRAL',
    monthly: monthly.status === 'fulfilled' ? classifyTrend(monthly.value, 12) : 'NEUTRAL'
  };
}

// Score how many timeframes align with the trade direction
export function scoreTimeframeAlignment(trends, direction) {
  const target = direction === 'LONG' ? 'UP' : 'DOWN';
  const tf = ['h4', 'daily', 'weekly', 'monthly'];
  const aligned = tf.filter(t => trends[t] === target).length;
  const opposing = tf.filter(t => trends[t] !== 'NEUTRAL' && trends[t] !== target).length;
  return {
    aligned,
    opposing,
    total: 4,
    score: Math.round((aligned / 4) * 100),
    label: aligned === 4 ? 'PERFECT ALIGNMENT'
         : aligned === 3 ? 'STRONG ALIGNMENT'
         : aligned === 2 ? 'MIXED'
         : aligned === 1 ? 'WEAK'
                         : 'CONFLICTING'
  };
}
