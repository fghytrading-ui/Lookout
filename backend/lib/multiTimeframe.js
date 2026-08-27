// Trend agreement across 4h / daily / weekly / monthly.
//
// This module used to make four raw Yahoo requests of its own, outside the
// shared client, with no cache, no retry and no rate-limit handling. Yahoo now
// answers those 429, all four rejected, and Promise.allSettled turned every
// rejection into 'NEUTRAL' — so every ticker reported NEUTRAL on every
// timeframe and the alignment score was 0 for everything, in both the
// reliability breakdown and the corroboration panel. A silent, permanent zero
// is worse than an obvious failure: it read as "no trend agreement" rather
// than "this never ran".
//
// It now derives every timeframe from a daily series the caller already has,
// by resampling. No extra network calls, nothing to rate-limit, and the
// timeframes are guaranteed consistent with the prices shown elsewhere on the
// page. The intraday series is optional; when it is missing that timeframe
// reports null and is excluded from the count rather than counted as neutral.

import { calculateSMA } from '../utils/signals.js';

/** Last close of each calendar month in a daily series. */
function resampleMonthly(candles) {
  const out = [];
  let key = null, last = null;
  for (const c of candles) {
    const d = new Date(c.date);
    if (Number.isNaN(d.getTime())) continue;
    const m = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (key !== null && m !== key) out.push(last);
    key = m;
    last = c.close;
  }
  if (last != null) out.push(last);
  return out.filter(v => Number.isFinite(v));
}

/** Last close of each week. */
function resampleWeekly(candles) {
  const out = [];
  let key = null, last = null;
  for (const c of candles) {
    const d = new Date(c.date);
    if (Number.isNaN(d.getTime())) continue;
    const wk = Math.floor(d.getTime() / (7 * 86400000));
    if (key !== null && wk !== key) out.push(last);
    key = wk;
    last = c.close;
  }
  if (last != null) out.push(last);
  return out.filter(v => Number.isFinite(v));
}

/** UP / DOWN / NEUTRAL from price against a rising or falling average. */
function classifyTrend(closes, smaLen = 20) {
  if (!closes || closes.length < smaLen + 5) return null;   // null = could not judge
  const price = closes[closes.length - 1];
  const sma = calculateSMA(closes, smaLen);
  const smaEarlier = calculateSMA(closes.slice(0, -5), smaLen);
  if (!sma || !smaEarlier) return null;
  const slopeUp = sma > smaEarlier;
  if (price > sma && slopeUp) return 'UP';
  if (price < sma && !slopeUp) return 'DOWN';
  return 'NEUTRAL';
}

/**
 * @param dailyCandles  long daily series, oldest first — two years covers the
 *                      monthly average comfortably
 * @param hourlyCandles optional intraday series for the 4h read
 */
export function getTrendsFromCandles(dailyCandles, hourlyCandles = null) {
  const daily = (dailyCandles || []).filter(c => Number.isFinite(c?.close));
  const closes = daily.map(c => c.close);

  let h4 = null;
  if (Array.isArray(hourlyCandles) && hourlyCandles.length >= 100) {
    const bars = hourlyCandles.filter(c => Number.isFinite(c?.close));
    const four = bars.filter((_, i) => i % 4 === 3).map(c => c.close);   // every 4th hourly close
    h4 = classifyTrend(four, 20);
  }

  return {
    h4,
    daily:   classifyTrend(closes, 20),
    weekly:  classifyTrend(resampleWeekly(daily), 20),
    monthly: classifyTrend(resampleMonthly(daily), 12)
  };
}

/** Score how many of the timeframes we could actually judge agree with the trade. */
export function scoreTimeframeAlignment(trends, direction) {
  if (!trends) return null;
  const target = direction === 'LONG' ? 'UP' : 'DOWN';
  const tf = ['h4', 'daily', 'weekly', 'monthly'];
  const judged = tf.filter(t => trends[t] != null);
  if (!judged.length) return null;

  const aligned  = judged.filter(t => trends[t] === target).length;
  const opposing = judged.filter(t => trends[t] !== 'NEUTRAL' && trends[t] !== target).length;
  const total = judged.length;
  const ratio = aligned / total;

  return {
    aligned,
    opposing,
    total,
    score: Math.round(ratio * 100),
    label: ratio === 1        ? 'PERFECT ALIGNMENT'
         : ratio >= 0.66      ? 'STRONG ALIGNMENT'
         : ratio >= 0.5       ? 'MIXED'
         : aligned > 0        ? 'WEAK'
                              : 'CONFLICTING'
  };
}
