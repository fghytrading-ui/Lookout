// Walk through the last 6 months of candles and find similar setups.
// For each historical occurrence, check if TP would have been hit before SL.
// Returns true win rate of this setup pattern on this specific stock.

import { calculateRSI, calculateATR, calculateSMA } from '../utils/signals.js';

// Conditions that define a "long pullback to support in uptrend" setup
function detectsLongPullback(rsi, price, sma20, sma50) {
  return rsi != null && sma20 != null && sma50 != null &&
         price > sma50 && price > sma20 && rsi < 45 && sma20 > sma50;
}
// Mirror for short
function detectsShortRally(rsi, price, sma20, sma50) {
  return rsi != null && sma20 != null && sma50 != null &&
         price < sma50 && price < sma20 && rsi > 55 && sma20 < sma50;
}

// Simulate: from entry candle, did price hit TP (3 ATR) before SL (1.5 ATR) within 10 days?
function simulateTrade(candles, startIdx, direction, atr) {
  if (startIdx + 10 > candles.length) return null;
  const entry = candles[startIdx].close;
  const tp = direction === 'LONG' ? entry + atr * 3   : entry - atr * 3;
  const sl = direction === 'LONG' ? entry - atr * 1.5 : entry + atr * 1.5;
  for (let i = startIdx + 1; i <= Math.min(startIdx + 10, candles.length - 1); i++) {
    const c = candles[i];
    if (direction === 'LONG') {
      if (c.low  <= sl) return 'LOSS';
      if (c.high >= tp) return 'WIN';
    } else {
      if (c.high >= sl) return 'LOSS';
      if (c.low  <= tp) return 'WIN';
    }
  }
  return 'TIMEOUT'; // Neither hit within 10 days
}

// Main: run backtest for a given direction over the candle history
export function backtestSetup(candles, direction) {
  if (!candles || candles.length < 60) return null;

  const detector = direction === 'LONG' ? detectsLongPullback : detectsShortRally;
  const trades = [];

  // Look at every candle from 50 onwards (need history for indicators) until 11 from end (need time to simulate)
  for (let i = 50; i < candles.length - 11; i++) {
    const slice = candles.slice(0, i + 1);
    const closes = slice.map(c => c.close);
    const rsi = calculateRSI(closes);
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const atr = calculateATR(slice.map(c => ({ high: c.high, low: c.low, close: c.close })));

    if (!atr) continue;
    if (!detector(rsi, candles[i].close, sma20, sma50)) continue;

    // Avoid trading too close to previous trade (overlap)
    if (trades.length && i - trades[trades.length - 1].idx < 5) continue;

    const result = simulateTrade(candles, i, direction, atr);
    if (result) trades.push({ idx: i, date: candles[i].date, result });
  }

  if (!trades.length) {
    return { sampleSize: 0, winRate: null, message: 'No similar setups in last 6 months — insufficient historical data' };
  }

  const wins    = trades.filter(t => t.result === 'WIN').length;
  const losses  = trades.filter(t => t.result === 'LOSS').length;
  const timeouts = trades.filter(t => t.result === 'TIMEOUT').length;
  const decided = wins + losses;
  const winRate = decided ? Math.round((wins / decided) * 100) : null;

  let confidence;
  if (trades.length < 4)       confidence = 'low';
  else if (trades.length < 10) confidence = 'medium';
  else                          confidence = 'high';

  // Return last 5 historical matches with actual outcomes for the UI
  const recentMatches = trades.slice(-5).reverse().map(t => ({
    date: t.date,
    result: t.result
  }));

  return {
    sampleSize: trades.length,
    wins, losses, timeouts,
    winRate,
    confidence,
    recentMatches,
    message: winRate >= 65 ? `Strong: this setup hit TP ${winRate}% of the time (${wins}/${decided}) over last 6mo`
           : winRate >= 50 ? `Mixed: ${winRate}% win rate (${wins}/${decided}) — slight edge`
           : winRate != null ? `Weak: only ${winRate}% historical win rate (${wins}/${decided}) — caution`
           : 'No conclusive historical data'
  };
}
