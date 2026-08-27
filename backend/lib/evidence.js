import { expectancyOf } from './realisedR.js';

// Statistical test for "has this pattern actually been shown to lose money?"
//
// The scanner used to answer that with a fixed rule: win rate under 25% over
// at least 15 signals. That threshold never reaches statistical significance —
// even 10 wins from 50 sits inside the noise band around a ~30% breakeven — so
// it could permanently sideline a perfectly good setup on evidence that proves
// nothing, and a sidelined setup stops producing signals and can never clear
// its own name.
//
// The honest question is not "is the observed rate low?" but "is the rate low
// enough that the TRUE rate is almost certainly below breakeven?". That is the
// upper bound of a confidence interval, and the Wilson score interval is used
// because the textbook normal interval collapses to a meaningless 0-0% when a
// pattern has no wins yet.

// ─────────────────────────────────────────────────────────────────────────
// The win-rate test below is kept because it is still the right shape for a
// binary question, but it is NO LONGER what quarantines a setup. Applied to
// this system it asked a question the trades cannot answer: it counted every
// scale-out and every expiry as a failure, then compared the result against
// the breakeven of an all-or-nothing trade at full reward:risk — a structure
// the scanner does not use, since it banks a third at TP0.
//
// Measured on the tracked record that test blocked Trend Continuation Long
// (182 trades, +0.072R, the most profitable pattern in the book) and let forex
// through (-0.330R). See assessSetupExpectancy for what replaced it.
// ─────────────────────────────────────────────────────────────────────────

// Upper bound of the Wilson score interval for a proportion.
export function wilsonUpperBound(wins, n, z = 1.96) {
  if (!n || n <= 0) return 1;
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, centre + margin);
}

// Breakeven win rate for a given reward:risk. At 2.4:1 you need ~29.4%.
export function breakevenWinRate(rr) {
  return rr > 0 ? 1 / (1 + rr) : 1;
}

/**
 * True only when the pattern is PROVEN unprofitable — i.e. even the optimistic
 * end of its confidence interval sits below the win rate it needs to break
 * even. Small or ambiguous samples return false, so a pattern keeps trading
 * until the evidence is genuinely conclusive.
 *
 * Returns { proven, winRate, upperBound, breakeven, sampleSize }.
 */
export function assessSetupEvidence({ wins, sampleSize, rrRatio, z = 1.96 }) {
  const n = sampleSize || 0;
  const breakeven = breakevenWinRate(rrRatio || 0);
  const upperBound = wilsonUpperBound(wins || 0, n, z);
  return {
    proven: n >= 10 && upperBound < breakeven,
    winRate: n ? (wins || 0) / n : null,
    upperBound,
    breakeven,
    sampleSize: n
  };
}

/**
 * True only when a setup has been PROVEN to lose money — the upper end of the
 * confidence interval around its mean realised R still sits below zero.
 *
 * Judged on realised R rather than win rate because the exit is staged: a
 * trade that banks a third at TP0 and stops at breakeven made money, and one
 * that runs out its horizon in profit made more. Both were previously counted
 * against the setup.
 *
 * The sample floor is deliberately higher than the old test's. Signals are not
 * independent — the same ticker recurs across consecutive sessions — so the
 * interval is optimistic, and the cost of wrongly blocking a good setup is
 * permanent silence while the cost of waiting is a few more trades.
 */
export function assessSetupExpectancy({ trades, minSample = 30 }) {
  const stats = expectancyOf(trades);
  return {
    proven: stats.n >= minSample && stats.upper !== null && stats.upper < 0,
    expectancy: stats.mean,
    upperBound: stats.upper,
    lowerBound: stats.lower,
    sampleSize: stats.n,
    minSample
  };
}
