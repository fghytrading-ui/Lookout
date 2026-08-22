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
