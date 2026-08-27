// Trade Quality Grade — synthesizes the entire analysis into a single letter grade
// Helps user decide quickly without reading 10 separate sections

export function computeTradeGrade({ setup, review, reliability, mtfAlignment, backtest, weeklyTrend, sentiment }) {
  if (!setup) return { grade: '—', score: 0, label: 'No setup', breakdown: [] };

  let score = 0;
  const breakdown = [];

  // 1. Reliability score (40% weight — most important)
  const relScore = (reliability?.score || 0) * 0.4;
  score += relScore;
  breakdown.push({
    factor: 'Reliability',
    points: Math.round(relScore),
    max: 40,
    detail: `${reliability?.score || 0}/100 → ${reliability?.label || '–'}`
  });

  // 2. R:R ratio (15% weight)
  const rr = setup.rrRatio || 0;
  const rrPts = Math.min(15, Math.max(0, (rr - 1.5) * 6));
  score += rrPts;
  breakdown.push({
    factor: 'Risk/Reward',
    points: Math.round(rrPts),
    max: 15,
    detail: `${rr}:1 ${rr >= 2.5 ? '(excellent)' : rr >= 2 ? '(good)' : rr >= 1.5 ? '(acceptable)' : '(poor)'}`
  });

  // 3. Multi-timeframe alignment (20% weight)
  const mtfPts = mtfAlignment ? (mtfAlignment.score / 100) * 20 : 10;
  score += mtfPts;
  breakdown.push({
    factor: 'Timeframe alignment',
    points: Math.round(mtfPts),
    max: 20,
    detail: mtfAlignment ? `${mtfAlignment.aligned}/4 timeframes agree (${mtfAlignment.label})` : 'Not measured'
  });

  // 4. Reviewer verdict (10% weight)
  const rev = review?.verdict;
  const revPts = rev === 'PASS' ? 10 : rev === 'CAUTION' ? 5 : 0;
  score += revPts;
  breakdown.push({
    factor: 'Stress test',
    points: revPts,
    max: 10,
    detail: rev === 'PASS' ? 'PASS — all checks cleared'
          : rev === 'CAUTION' ? 'CAUTION — warnings present'
                              : 'REJECT'
  });

  // 5. Historical backtest (10% weight)
  //
  // Scored on what the comparable sessions returned, not on how many reached
  // the far target. With a staged exit the target-hit rate is structurally low
  // — a trade can bank its first third and finish green without ever touching
  // TP1 — so grading on it would mark down setups that made money. -0.2R earns
  // nothing, +0.4R earns full marks.
  if (backtest && backtest.expectancy != null) {
    const btPts = Math.min(10, ((backtest.expectancy + 0.2) / 0.6) * 10);
    score += Math.max(0, btPts);
    breakdown.push({
      factor: 'Historical performance',
      points: Math.round(Math.max(0, btPts)),
      max: 10,
      detail: `${backtest.expectancy >= 0 ? '+' : ''}${backtest.expectancy}R over ${backtest.sampleSize} comparable sessions`
    });
  } else {
    score += 4; // partial credit
    breakdown.push({ factor: 'Historical performance', points: 4, max: 10, detail: 'Insufficient history' });
  }

  // 6. Sentiment alignment (5% weight)
  if (sentiment && sentiment.total >= 2) {
    const wantsBullish = setup.direction === 'LONG';
    const isBullish = sentiment.score >= 55;
    const isBearish = sentiment.score <= 45;
    const aligned = (wantsBullish && isBullish) || (!wantsBullish && isBearish);
    const opposed = (wantsBullish && isBearish) || (!wantsBullish && isBullish);
    const sentPts = aligned ? 5 : opposed ? 0 : 3;
    score += sentPts;
    breakdown.push({
      factor: 'News sentiment',
      points: sentPts,
      max: 5,
      detail: `${sentiment.label} ${sentiment.score}% (${aligned ? 'aligned' : opposed ? 'opposed' : 'neutral'})`
    });
  } else {
    score += 2;
    breakdown.push({ factor: 'News sentiment', points: 2, max: 5, detail: 'No sentiment data' });
  }

  score = Math.round(score);

  // Convert score to letter grade
  let grade, label, color;
  if (score >= 90)      { grade = 'A+'; label = 'Elite setup';        color = 'green'; }
  else if (score >= 80) { grade = 'A';  label = 'Excellent setup';    color = 'green'; }
  else if (score >= 70) { grade = 'B+'; label = 'Strong setup';       color = 'green'; }
  else if (score >= 60) { grade = 'B';  label = 'Solid setup';        color = 'amber'; }
  else if (score >= 50) { grade = 'C';  label = 'Mediocre setup';     color = 'amber'; }
  else if (score >= 40) { grade = 'D';  label = 'Weak setup';         color = 'orange';}
  else                  { grade = 'F';  label = 'Avoid';              color = 'red';   }

  return { grade, score, label, color, breakdown };
}
