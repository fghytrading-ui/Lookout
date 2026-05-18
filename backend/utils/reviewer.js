// Second-opinion analyst review — runs AFTER signal generation.
// Mimics how a human/AI analyst would stress-test a trade.
// Returns { verdict: 'PASS' | 'CAUTION' | 'REJECT', issues: [...], strengths: [...] }

const BEARISH_HEADLINE_WORDS = [
  'plunge', 'crash', 'tumble', 'sink', 'slump', 'lawsuit', 'investigation',
  'fraud', 'probe', 'subpoena', 'fine', 'penalty', 'downgrade', 'cut',
  'recall', 'warning', 'miss', 'disappoint', 'concern', 'sell-off', 'selloff',
  'risk', 'threat', 'losses', 'bankruptcy', 'halts', 'suspended'
];
const BULLISH_HEADLINE_WORDS = [
  'surge', 'soar', 'jump', 'rally', 'breakout', 'beat', 'beats', 'crushes',
  'upgrade', 'raises', 'record high', 'all-time high', 'outperform', 'buy rating',
  'profit', 'gains', 'wins', 'strong', 'positive', 'expand', 'acquisition'
];

function countKeywords(news, words) {
  if (!news?.length) return 0;
  let total = 0;
  for (const item of news) {
    const text = (item.title || '').toLowerCase();
    for (const w of words) if (text.includes(w)) total++;
  }
  return total;
}

export function reviewTrade(card, historical, signalData, marketContext = {}) {
  const issues = [];
  const strengths = [];

  const { direction, price, changePercent, rsi, news, sentiment, fiftyTwoWeekHigh, fiftyTwoWeekLow, earnings, volRatio } = card;
  const { sma200, sma50, macd, atr } = signalData;
  const { vix, weeklyTrend } = marketContext;

  // ── A. VIX market regime override ────────────────────────────────────
  if (vix && vix > 25) {
    issues.push({ severity: 'caution', text: `VIX at ${vix.toFixed(1)} — extreme fear, expect chop and false breakouts` });
  }
  if (vix && vix > 30) {
    issues.push({ severity: 'reject', text: `VIX at ${vix.toFixed(1)} — markets too volatile for clean swing setups` });
  }

  // ── B. Weekly trend alignment (huge win-rate boost) ──────────────────
  if (weeklyTrend) {
    if (direction === 'LONG' && weeklyTrend === 'DOWN') {
      issues.push({ severity: 'reject', text: 'Weekly trend is DOWN — do not long against the weekly chart' });
    }
    if (direction === 'SHORT' && weeklyTrend === 'UP') {
      issues.push({ severity: 'reject', text: 'Weekly trend is UP — do not short against the weekly chart' });
    }
    if (direction === 'LONG' && weeklyTrend === 'UP') {
      strengths.push('Weekly trend UP — multi-timeframe alignment confirmed');
    }
    if (direction === 'SHORT' && weeklyTrend === 'DOWN') {
      strengths.push('Weekly trend DOWN — multi-timeframe alignment confirmed');
    }
  }

  // ── C. Today's intraday momentum conflict ────────────────────────────
  if (changePercent != null) {
    if (direction === 'LONG' && changePercent < -1.5) {
      issues.push({ severity: 'reject', text: `Stock is DOWN ${changePercent.toFixed(1)}% today — don't catch falling knives` });
    }
    if (direction === 'SHORT' && changePercent > 1.5) {
      issues.push({ severity: 'reject', text: `Stock is UP ${changePercent.toFixed(1)}% today — don't short into strength` });
    }
    if (direction === 'LONG' && changePercent > 0.5) {
      strengths.push(`Stock already +${changePercent.toFixed(1)}% today — confirming momentum`);
    }
    if (direction === 'SHORT' && changePercent < -0.5) {
      strengths.push(`Stock already ${changePercent.toFixed(1)}% today — confirming weakness`);
    }
  }

  // ── D. Volume conviction (weak volume = unreliable signal) ───────────
  if (volRatio != null) {
    if (volRatio < 0.4) {
      issues.push({ severity: 'reject', text: `Volume only ${(volRatio * 100).toFixed(0)}% of average — no conviction, signal unreliable` });
    } else if (volRatio < 0.7) {
      issues.push({ severity: 'caution', text: `Below-average volume (${volRatio.toFixed(1)}×) — wait for participation` });
    } else if (volRatio > 1.5) {
      strengths.push(`Strong volume ${volRatio.toFixed(1)}× average — institutional participation`);
    }
  }

  // ── E. Choppy session detection ──────────────────────────────────────
  if (historical && historical.length >= 1 && atr) {
    const today = historical[historical.length - 1];
    if (today) {
      const todayRange = today.high - today.low;
      if (todayRange > atr * 1.8) {
        issues.push({ severity: 'caution', text: `Today's range ${(todayRange / price * 100).toFixed(1)}% — choppy session, signals unreliable` });
      }
    }
  }

  // ── 0. EARNINGS RISK (hardest filter — never hold through report) ────
  if (earnings?.status === 'BLOCK') {
    issues.push({ severity: 'reject', text: `Earnings in ${earnings.daysAway} day${earnings.daysAway === 1 ? '' : 's'} — do NOT hold through report` });
  } else if (earnings?.status === 'WARN') {
    issues.push({ severity: 'caution', text: `Earnings in ${earnings.daysAway} days — must clear position before report` });
  }

  // ── 1. News-direction conflict (HARD REJECT) ─────────────────────────
  if (news?.length >= 2) {
    const bullCount = countKeywords(news, BULLISH_HEADLINE_WORDS);
    const bearCount = countKeywords(news, BEARISH_HEADLINE_WORDS);

    if (direction === 'LONG' && bearCount >= 2 && bearCount > bullCount) {
      issues.push({ severity: 'reject', text: `News flow is bearish (${bearCount} negative headlines) — long trade conflicts` });
    }
    if (direction === 'SHORT' && bullCount >= 2 && bullCount > bearCount) {
      issues.push({ severity: 'reject', text: `News flow is bullish (${bullCount} positive headlines) — short trade conflicts` });
    }
    if (direction === 'LONG' && bullCount >= 2) {
      strengths.push(`News confirms bullish bias (${bullCount} positive headlines)`);
    }
    if (direction === 'SHORT' && bearCount >= 2) {
      strengths.push(`News confirms bearish bias (${bearCount} negative headlines)`);
    }
  }

  // ── 2. Extended move warning — don't chase ───────────────────────────
  if (historical?.length >= 5) {
    const fiveBack = historical[historical.length - 5];
    const fiveDayMove = ((price - fiveBack.close) / fiveBack.close) * 100;
    if (direction === 'LONG' && fiveDayMove > 12) {
      issues.push({ severity: 'reject', text: `Already up ${fiveDayMove.toFixed(1)}% in 5 days — too extended for fresh long` });
    }
    if (direction === 'SHORT' && fiveDayMove < -12) {
      issues.push({ severity: 'reject', text: `Already down ${fiveDayMove.toFixed(1)}% in 5 days — too extended for fresh short` });
    }
    if (direction === 'LONG' && fiveDayMove > 7) {
      issues.push({ severity: 'caution', text: `Up ${fiveDayMove.toFixed(1)}% in 5 days — wait for pullback to entry zone` });
    }
    if (direction === 'SHORT' && fiveDayMove < -7) {
      issues.push({ severity: 'caution', text: `Down ${fiveDayMove.toFixed(1)}% in 5 days — wait for bounce to entry zone` });
    }
  }

  // ── 3. Today's gap risk (rejected if >5%) ────────────────────────────
  if (Math.abs(changePercent || 0) > 5) {
    issues.push({ severity: 'caution', text: `Today's move ${changePercent.toFixed(1)}% is large — wait for stabilization` });
  }

  // ── 4. RSI / MACD divergence (conflicting signals) ────────────────────
  if (rsi != null && macd) {
    if (direction === 'LONG' && rsi > 70 && macd.histogram < 0) {
      issues.push({ severity: 'reject', text: 'RSI overbought BUT MACD bearish — momentum stalling' });
    }
    if (direction === 'SHORT' && rsi < 30 && macd.histogram > 0) {
      issues.push({ severity: 'reject', text: 'RSI oversold BUT MACD bullish — bottom forming' });
    }
  }

  // ── 5. 52-week extreme proximity ─────────────────────────────────────
  if (fiftyTwoWeekHigh && fiftyTwoWeekLow) {
    if (direction === 'LONG' && (fiftyTwoWeekHigh - price) / fiftyTwoWeekHigh < 0.02) {
      issues.push({ severity: 'caution', text: 'Within 2% of 52-week high — significant resistance overhead' });
    }
    if (direction === 'SHORT' && (price - fiftyTwoWeekLow) / fiftyTwoWeekLow < 0.02) {
      issues.push({ severity: 'reject', text: 'Within 2% of 52-week low — extreme short-squeeze risk' });
    }
  }

  // ── 6. Trend alignment confidence boost ──────────────────────────────
  if (sma200) {
    if (direction === 'LONG' && price > sma200 && sma50 && sma50 > sma200) {
      strengths.push('Major uptrend confirmed: price > 50 SMA > 200 SMA');
    }
    if (direction === 'SHORT' && price < sma200 && sma50 && sma50 < sma200) {
      strengths.push('Major downtrend confirmed: price < 50 SMA < 200 SMA');
    }
    if (direction === 'LONG' && price < sma200) {
      issues.push({ severity: 'caution', text: 'Trading long BELOW 200 SMA — counter-trend' });
    }
    if (direction === 'SHORT' && price > sma200) {
      issues.push({ severity: 'caution', text: 'Trading short ABOVE 200 SMA — counter-trend' });
    }
  }

  // ── 7. Volatility sanity check ───────────────────────────────────────
  if (atr && price) {
    const atrPct = (atr / price) * 100;
    if (atrPct > 6) {
      issues.push({ severity: 'caution', text: `High volatility (${atrPct.toFixed(1)}% daily ATR) — size carefully` });
    }
  }

  // ── 8. Sentiment vs direction final cross-check ──────────────────────
  if (sentiment && sentiment.total >= 3) {
    if (direction === 'LONG' && sentiment.score < 30) {
      issues.push({ severity: 'reject', text: `Sentiment ${sentiment.score}% bearish — avoid long` });
    }
    if (direction === 'SHORT' && sentiment.score > 70) {
      issues.push({ severity: 'reject', text: `Sentiment ${sentiment.score}% bullish — avoid short` });
    }
  }

  // ── Verdict ──────────────────────────────────────────────────────────
  const rejectCount = issues.filter(i => i.severity === 'reject').length;
  const cautionCount = issues.filter(i => i.severity === 'caution').length;

  let verdict;
  if (rejectCount > 0) verdict = 'REJECT';
  else if (cautionCount >= 2) verdict = 'CAUTION';
  else if (cautionCount === 1) verdict = 'CAUTION';
  else verdict = 'PASS';

  // Build a human-readable summary
  let summary;
  if (verdict === 'PASS') {
    summary = strengths.length
      ? `✓ Cleared all checks. ${strengths[0]}.`
      : '✓ Cleared all sanity checks — proceed with planned risk.';
  } else if (verdict === 'CAUTION') {
    summary = `⚠ Take with caution: ${issues[0].text}`;
  } else {
    summary = `✗ Reviewer rejects: ${issues.find(i => i.severity === 'reject').text}`;
  }

  return { verdict, issues, strengths, summary };
}
