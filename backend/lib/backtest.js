// "When this instrument looked like this before, what happened next?"
//
// The previous version answered a different question and, in practice, never
// answered it at all. It looked for one hardcoded pattern — RSI below 45 while
// price sat above both a rising 20 and 50 SMA — and those conditions are very
// nearly mutually exclusive: measured across 390 bars on six instruments it
// matched exactly zero times. RSI dropped under 45 on 15-36 bars each and
// price was above both averages on 10-43, and the intersection was always
// empty. So the analyst's "Historical backtest" line reported "not enough
// similar setups to judge — no weight applied" on every ticker, every time.
// A whole input, permanently silent.
//
// Two things changed. It now matches on how similar a past bar was to TODAY
// rather than to a fixed template, so it tests the setup actually being
// proposed. And it scores those matches with the trade's own geometry and the
// exit plan in force, reported in R, the same measure the scanner and the goal
// tracker use. That plan is one exit — the whole position at the target —
// since 2026-08-31; this kept simulating the retired thirds plan (a third at
// TP0, stop to breakeven, a runner to TP2) until 2026-10-08, which banked
// partial wins the cards no longer take.

import { calculateRSI, calculateATR, calculateSMA } from '../utils/signals.js';

// How close a past bar has to be to today's reading to count as an analogue.
const RSI_TOLERANCE = 8;      // RSI points
const SMA_TOLERANCE = 3.0;    // percentage points of distance from each average
const MIN_SPACING   = 4;      // bars between matches, so one move is not counted repeatedly
const MIN_MATCHES   = 5;

function state(closes, highLowCloses, price) {
  const rsi   = calculateRSI(closes);
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const atr   = calculateATR(highLowCloses);
  if ([rsi, sma20, sma50, atr].some(v => v == null) || !(price > 0)) return null;
  return {
    rsi,
    d20: ((price - sma20) / price) * 100,   // distance from each average, in %
    d50: ((price - sma50) / price) * 100,
    trendUp: sma20 > sma50,
    atr
  };
}

function similar(a, b) {
  return Math.abs(a.rsi - b.rsi) <= RSI_TOLERANCE
      && Math.abs(a.d20 - b.d20) <= SMA_TOLERANCE
      && Math.abs(a.d50 - b.d50) <= SMA_TOLERANCE
      && a.trendUp === b.trendUp;
}

/**
 * Walk forward from a matched bar under the single exit and return the
 * realised result in R: the target pays the full reward, the stop loses 1R,
 * and a trade that runs out of horizon settles at that close. Mirrors
 * lib/realisedR.js, computed from candles rather than from a closed record.
 */
function simulate(candles, startIdx, direction, stopDist, targetDist, horizonBars) {
  const entry = candles[startIdx].close;
  if (!(stopDist > 0) || !(targetDist > 0)) return null;
  const long = direction === 'LONG';
  const rr   = targetDist / stopDist;
  const dir  = long ? 1 : -1;
  const tp   = entry + dir * targetDist;
  const stop = entry - dir * stopDist;
  const last = Math.min(startIdx + horizonBars, candles.length - 1);

  for (let i = startIdx + 1; i <= last; i++) {
    const { high, low } = candles[i];
    const hitStop = long ? low <= stop : high >= stop;
    const hitTp   = long ? high >= tp  : low <= tp;
    // Within a bar the order is unknown. Resolve against the trade, so this
    // never flatters itself: the stop is taken first.
    if (hitStop) return -1.0;
    if (hitTp) return rr;
  }

  // Ran out of horizon: settle where it closed, as the live monitor does.
  return ((candles[last].close - entry) * dir) / stopDist;
}

/**
 * @param candles   daily candles, oldest first
 * @param direction 'LONG' | 'SHORT'
 * @param geometry  { stopDist, targetDist, horizonBars } in price terms; falls
 *                  back to ATR defaults when the caller has no setup to pass.
 */
export function backtestSetup(candles, direction, geometry = {}) {
  if (!candles || candles.length < 70) {
    return { sampleSize: 0, winRate: null, expectancy: null,
             message: 'Not enough price history to find comparable sessions' };
  }

  const closes = candles.map(c => c.close);
  const hlc    = candles.map(c => ({ high: c.high, low: c.low, close: c.close }));
  const today  = state(closes, hlc, candles[candles.length - 1].close);
  if (!today) {
    return { sampleSize: 0, winRate: null, expectancy: null,
             message: 'Indicators unavailable — no comparison possible' };
  }

  const horizonBars = geometry.horizonBars > 0 ? geometry.horizonBars : 3;
  const stopDist    = geometry.stopDist   > 0 ? geometry.stopDist   : today.atr * 0.7;
  const targetDist  = geometry.targetDist > 0 ? geometry.targetDist : today.atr * 1.5;

  const results = [];
  let lastIdx = -Infinity;
  // Stop far enough from the end that every match gets its full horizon.
  for (let i = 55; i < candles.length - horizonBars - 1; i++) {
    if (i - lastIdx < MIN_SPACING) continue;
    const past = state(closes.slice(0, i + 1), hlc.slice(0, i + 1), candles[i].close);
    if (!past || !similar(past, today)) continue;

    // Scale the geometry to the volatility of the day being matched, so a
    // quiet stretch is not judged against today's range.
    const scale = today.atr > 0 ? past.atr / today.atr : 1;
    const r = simulate(candles, i, direction, stopDist * scale, targetDist * scale, horizonBars);
    if (r === null) continue;
    results.push({ idx: i, date: candles[i].date, r });
    lastIdx = i;
  }

  if (results.length < MIN_MATCHES) {
    return {
      sampleSize: results.length, winRate: null, expectancy: null,
      message: results.length
        ? `Only ${results.length} comparable session${results.length === 1 ? '' : 's'} in the history — too few to draw on`
        : 'No comparable sessions in the price history'
    };
  }

  const rs        = results.map(x => x.r);
  const expectancy = rs.reduce((a, b) => a + b, 0) / rs.length;
  const green      = rs.filter(r => r > 0).length;
  const greenRate  = Math.round((green / rs.length) * 100);
  const reachedTp  = rs.filter(r => r >= (targetDist / stopDist) - 1e-9).length;
  const winRate    = Math.round((reachedTp / rs.length) * 100);

  const confidence = results.length >= 12 ? 'high' : results.length >= 8 ? 'medium' : 'low';

  return {
    sampleSize: results.length,
    winRate,                                   // reached the target
    greenRate,                                 // finished in profit
    expectancy: parseFloat(expectancy.toFixed(3)),
    confidence,
    recentMatches: results.slice(-5).reverse().map(x => ({
      date: x.date,
      result: x.r > 0 ? 'WIN' : x.r < 0 ? 'LOSS' : 'FLAT',
      r: parseFloat(x.r.toFixed(2))
    })),
    message: expectancy > 0.15
        ? `When it last looked like this, the trade returned ${expectancy.toFixed(2)}R on average (${green}/${rs.length} green)`
      : expectancy > 0
        ? `Slight edge historically — ${expectancy.toFixed(2)}R average over ${rs.length} comparable sessions`
        : `Historically negative here — ${expectancy.toFixed(2)}R average over ${rs.length} comparable sessions`
  };
}
