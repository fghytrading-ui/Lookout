// What a closed trade actually returned, in units of the risk taken (R).
//
// This lives in one place because four separate parts of the system judge
// performance — the goal tracker, the learning engine, the per-setup evidence
// gate and the confidence feedback — and they were not using the same
// definition. Where they disagreed, they disagreed in the same direction:
// anything that was not a clean target hit was treated as a failure.
//
// That is wrong for two of the five ways a trade can end:
//
//   SCALED_BE   a third of the position was banked at TP0 and the rest closed
//               at breakeven. That is a small PROFIT, not a scratch.
//   EXPIRED     the trade reached its horizon without touching target or stop
//               and was closed at the market. Across the tracked record those
//               settled at +0.50R on average, with 67% finishing green — they
//               are the slow winners, not failures.
//
// Counting both as losses is what made the most profitable setup in the record
// look like a 21% win rate and get itself quarantined.
//
// The scale plan is thirds: TP0 at 30% of the TP1 distance, then TP1, then a
// runner at 1.2x TP1, with the stop moved to breakeven once TP0 fills.

/** Realised return in R, or null when the record cannot support the maths. */
export function realisedR(s) {
  const rr = s?.rrRatio;
  if (!rr) return null;
  const rr2 = s.rrRatio2 || rr * 1.2;

  switch (s.closeReason) {
    // The entry limit was never reached, so no position existed. Excluded
    // rather than scored zero: a zero would be averaged in and drag every
    // expectancy toward the middle, when the honest statement is that this
    // was not a trade at all. The share of signals that never fill is
    // reported separately, because it decides how many chances you get.
    case 'NEVER_FILLED': return null;
    case 'SL':        return -1.0;
    case 'TP1':       return (0.3 * rr) / 3 + rr / 3;
    case 'TP2':       return (0.3 * rr) / 3 + rr / 3 + rr2 / 3;
    case 'SCALED_BE': return (0.3 * rr) / 3;
    case 'EXPIRED': {
      // Settle at the price it was actually closed at. When the monitor could
      // not fetch candles it falls back to recording the entry price, which
      // lands on exactly 0R — neutral, which is the honest answer for a trade
      // whose path we never saw.
      const { entry, sl, closePrice } = s;
      if (![entry, sl, closePrice].every(v => Number.isFinite(v))) return null;
      const risk = Math.abs(entry - sl);
      if (risk <= 0) return null;
      const dir = s.direction === 'SHORT' ? -1 : 1;
      const move = ((closePrice - entry) * dir) / risk;
      // If it banked the first third on the way, that third is already booked.
      return s.scaledOut ? (0.3 * rr) / 3 + (move * 2) / 3 : move;
    }
    default: return null;
  }
}

/**
 * Mean realised R for a set of closed trades, with the 95% confidence interval
 * around that mean. `upper < 0` is the honest test for "this has been shown to
 * lose money", and it is the direct analogue of the Wilson bound the win-rate
 * test used — just applied to the quantity that actually matters.
 */
export function expectancyOf(rows) {
  const v = (rows || []).map(realisedR).filter(x => x !== null);
  const n = v.length;
  if (!n) return { n: 0, mean: null, se: null, lower: null, upper: null };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, se: null, lower: null, upper: null };
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  return { n, mean, se, lower: mean - 1.96 * se, upper: mean + 1.96 * se };
}

/** Share of trades that finished in profit, scale-outs and expiries included. */
export function greenRateOf(rows) {
  const v = (rows || []).map(realisedR).filter(x => x !== null);
  return v.length ? v.filter(x => x > 0).length / v.length : null;
}
