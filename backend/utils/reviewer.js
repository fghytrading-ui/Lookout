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
  const { vix, weeklyTrend, market, btcTrend, fearGreed, cryptoSession, funding, inventoryRisk } = marketContext;
  const isCrypto = market === 'crypto';

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

  // ── C. Today's intraday momentum conflict (crypto has wider thresholds — 3% is common) ──
  if (changePercent != null) {
    const conflictThresh = isCrypto ? 4.0 : 1.5;
    const momentumThresh = isCrypto ? 1.5 : 0.5;
    const noun = isCrypto ? 'Coin' : 'Stock';
    if (direction === 'LONG' && changePercent < -conflictThresh) {
      issues.push({ severity: 'reject', text: `${noun} is DOWN ${changePercent.toFixed(1)}% today — don't catch falling knives` });
    }
    if (direction === 'SHORT' && changePercent > conflictThresh) {
      issues.push({ severity: 'reject', text: `${noun} is UP ${changePercent.toFixed(1)}% today — don't short into strength` });
    }
    if (direction === 'LONG' && changePercent > momentumThresh) {
      strengths.push(`${noun} already +${changePercent.toFixed(1)}% today — confirming momentum`);
    }
    if (direction === 'SHORT' && changePercent < -momentumThresh) {
      strengths.push(`${noun} already ${changePercent.toFixed(1)}% today — confirming weakness`);
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

  // ── 0b. INVENTORY RELEASE RISK (energy commodities — earnings equivalent) ──
  // EIA crude/NG reports are scheduled binary events that move CL/NG 2–5%
  // in minutes. Treat same as earnings: never hold through.
  if (inventoryRisk?.status === 'BLOCK') {
    issues.push({ severity: 'reject', text: inventoryRisk.message });
  } else if (inventoryRisk?.status === 'CAUTION') {
    issues.push({ severity: 'caution', text: inventoryRisk.message });
  }

  // ── 0c. SCHEDULED EVENT INSIDE THE TRADE WINDOW ──────────────────────
  // A high-impact macro release lands during the hold. Position sizing and
  // stop placement mean nothing through an FOMC decision or a CPI print —
  // price gaps straight through the level.
  if (card.eventTimeline?.warning) {
    // Grade against the event that raised the warning, not whatever happens
    // to be first on the clock. Rejection is reserved for a top-tier release
    // within six hours — traders routinely hold into an FOMC a day out with
    // reduced size, but opening fresh risk just before the print is not a
    // trade, it is a coin flip.
    const e = card.eventTimeline.warningEvent || card.eventTimeline.nextEvent;
    const severity = (e?.impact >= 9 && e?.hoursUntil <= 6) ? 'reject' : 'caution';
    issues.push({ severity, text: card.eventTimeline.warning });
  }

  // ── 0. EARNINGS RISK (hardest filter — never hold through report) ────
  if (earnings?.status === 'BLOCK') {
    issues.push({ severity: 'reject', text: `Earnings in ${earnings.daysAway} day${earnings.daysAway === 1 ? '' : 's'} — do NOT hold through report` });
  } else if (earnings?.status === 'WARN') {
    issues.push({ severity: 'caution', text: `Earnings in ${earnings.daysAway} days — must clear position before report` });
  }

  // ── 1. CATALYST CHECK — the specific event moving this name ──────────
  // Replaces blunt keyword counting. A merger collapsing and a merger being
  // agreed both contain the word "merger"; only the event type tells you
  // which way to trade, and only recency tells you whether it still matters.
  const cat = card.catalystAnalysis || card._catalystAnalysis;
  if (cat?.primary) {
    const p = cat.primary;
    const aligned  = (direction === 'LONG'  && p.direction === 'bullish') ||
                     (direction === 'SHORT' && p.direction === 'bearish');
    const conflicts = (direction === 'LONG'  && p.direction === 'bearish') ||
                      (direction === 'SHORT' && p.direction === 'bullish');

    // A fresh, high-impact event overrides the chart entirely. Technicals do
    // not survive an FDA rejection or a collapsed acquisition.
    if (cat.blocking) {
      const b = cat.blocking;
      const bAligned = (direction === 'LONG'  && b.direction === 'bullish') ||
                       (direction === 'SHORT' && b.direction === 'bearish');
      if (!bAligned) {
        issues.push({ severity: 'reject',
          text: `${b.label} (${b.age}) — event-driven move against this ${direction}; the chart is irrelevant here` });
      } else {
        issues.push({ severity: 'caution',
          text: `${b.label} (${b.age}) — major event already in motion; much of the move may be gone and volatility will be extreme` });
      }
    } else if (conflicts && p.weight >= 1.3) {
      issues.push({ severity: 'reject',
        text: `${p.label} (${p.age}) runs against this ${direction}` });
    } else if (aligned && p.weight >= 1.3) {
      strengths.push(`${p.label} (${p.age}) supports this ${direction}${p.impact >= 8 ? ' — major catalyst' : ''}`);
    }

    // Something is unfolding right now — spreads widen and direction whipsaws
    if (cat.burst && !cat.blocking) {
      issues.push({ severity: 'caution',
        text: 'Unusual news volume in the last few hours — a story is developing, expect volatility' });
    }
  } else if (news?.length >= 4) {
    // No classifiable catalyst — fall back to tone as a weak signal only.
    const bullCount = countKeywords(news, BULLISH_HEADLINE_WORDS);
    const bearCount = countKeywords(news, BEARISH_HEADLINE_WORDS);
    if (direction === 'LONG' && bearCount >= 3 && bearCount > bullCount * 2) {
      issues.push({ severity: 'caution', text: `News tone is negative (${bearCount} bearish headlines) with no clear catalyst` });
    }
    if (direction === 'SHORT' && bullCount >= 3 && bullCount > bearCount * 2) {
      issues.push({ severity: 'caution', text: `News tone is positive (${bullCount} bullish headlines) with no clear catalyst` });
    }
  }

  // NOTE: thesis quality is deliberately NOT judged here. The reviewer's job
  // is RISK — what could go wrong with this trade. The thesis answers a
  // different question: is there a reason to take it at all. Feeding thesis
  // quality into the verdict double-counted it (it already gates ENTER NOW)
  // and made every card CAUTION, which left the top tier permanently empty.
  // Rationale gating happens once, at the ENTER NOW gate in the scanner.

  // ── 2. Extended move warning — don't chase (crypto runs hotter) ──────
  if (historical?.length >= 5) {
    const fiveBack = historical[historical.length - 5];
    const fiveDayMove = ((price - fiveBack.close) / fiveBack.close) * 100;
    const extremeThresh = isCrypto ? 25 : 12;
    const warnThresh    = isCrypto ? 15 : 7;
    if (direction === 'LONG' && fiveDayMove > extremeThresh) {
      issues.push({ severity: 'reject', text: `Already up ${fiveDayMove.toFixed(1)}% in 5 sessions — too extended for fresh long` });
    }
    if (direction === 'SHORT' && fiveDayMove < -extremeThresh) {
      issues.push({ severity: 'reject', text: `Already down ${fiveDayMove.toFixed(1)}% in 5 sessions — too extended for fresh short` });
    }
    if (direction === 'LONG' && fiveDayMove > warnThresh) {
      issues.push({ severity: 'caution', text: `Up ${fiveDayMove.toFixed(1)}% in 5 sessions — wait for pullback to entry zone` });
    }
    if (direction === 'SHORT' && fiveDayMove < -warnThresh) {
      issues.push({ severity: 'caution', text: `Down ${fiveDayMove.toFixed(1)}% in 5 sessions — wait for bounce to entry zone` });
    }
  }

  // ── 2b. Extended-hours gap risk ──────────────────────────────────────
  // A stock already up 4% in pre-market has done much of the move before the
  // bell, and extended-hours prices are thin — the open frequently retraces
  // them. Treated as a real risk rather than confirmation.
  if (card.extendedHours) {
    const e = card.extendedHours;
    const label = e.session === 'pre' ? 'Pre-market' : 'Post-market';
    const withUs = (direction === 'LONG' && e.direction === 'up') ||
                   (direction === 'SHORT' && e.direction === 'down');
    if (e.magnitude === 'large') {
      issues.push({
        severity: withUs ? 'caution' : 'reject',
        text: withUs
          ? `${label} already ${e.direction} ${e.movePct}% — entering after the move; thin-liquidity gaps often retrace at the open`
          : `${label} ${e.direction} ${e.movePct}% against this ${direction} — premise is being invalidated before the open`
      });
    } else if (e.magnitude === 'moderate' && !withUs) {
      issues.push({
        severity: 'caution',
        text: `${label} ${e.direction} ${e.movePct}% runs against this ${direction}`
      });
    } else if (withUs) {
      strengths.push(`${label} ${e.movePct > 0 ? '+' : ''}${e.movePct}% confirms direction ahead of the session`);
    }
  }

  // ── 3. Today's gap risk (crypto often moves 5% — only flag >10%) ─────
  const gapThresh = isCrypto ? 10 : 5;
  if (Math.abs(changePercent || 0) > gapThresh) {
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

  // ── 7. Volatility sanity check (crypto baseline is higher) ────────────
  if (atr && price) {
    const atrPct = (atr / price) * 100;
    const volWarn = isCrypto ? 12 : 6;
    if (atrPct > volWarn) {
      issues.push({ severity: 'caution', text: `High volatility (${atrPct.toFixed(1)}% daily ATR) — size carefully` });
    }
  }

  // ── 9. CRYPTO-SPECIFIC: BTC trend, Fear & Greed, session liquidity ──
  if (isCrypto) {
    const isBTC = card.ticker === 'BTC-USD';
    // BTC sets the regime for every alt — fighting it is a high-loss bet
    if (btcTrend && !isBTC) {
      if (direction === 'LONG' && btcTrend === 'BEARISH') {
        issues.push({ severity: 'reject', text: 'BTC trend is BEARISH — alts bleed when BTC drops; do not long alts' });
      }
      if (direction === 'SHORT' && btcTrend === 'BULLISH') {
        issues.push({ severity: 'caution', text: 'BTC trend is BULLISH — shorting alts into BTC strength is high-risk' });
      }
      if (direction === 'LONG' && btcTrend === 'BULLISH') {
        strengths.push('BTC trend BULLISH — macro tailwind for alts');
      }
      if (direction === 'SHORT' && btcTrend === 'BEARISH') {
        strengths.push('BTC trend BEARISH — alts likely to underperform BTC');
      }
    }
    // Fear & Greed extremes — contrarian flags (well-documented edge in crypto)
    if (fearGreed != null) {
      if (direction === 'LONG' && fearGreed > 80) {
        issues.push({ severity: 'caution', text: `Fear & Greed at ${fearGreed} (Extreme Greed) — historically a top zone for longs` });
      }
      if (direction === 'SHORT' && fearGreed < 20) {
        issues.push({ severity: 'caution', text: `Fear & Greed at ${fearGreed} (Extreme Fear) — historically a bottom zone, shorts get squeezed` });
      }
      if (direction === 'LONG' && fearGreed < 25) {
        strengths.push(`Fear & Greed at ${fearGreed} — contrarian long zone`);
      }
      if (direction === 'SHORT' && fearGreed > 75) {
        strengths.push(`Fear & Greed at ${fearGreed} — late-stage greed favors shorts`);
      }
    }
    // Low-liquidity session caution (alts especially)
    if (cryptoSession?.liquidity === 'LOW' && !isBTC) {
      issues.push({ severity: 'caution', text: `${cryptoSession.activeSession} session — low liquidity, alts prone to wicks and spreads` });
    }
    // VWAP bias — long below VWAP = wind in your face; short above VWAP = same
    // Crypto pros use VWAP both as a bias filter and as a magnet for mean reversion.
    if (card.vwap) {
      const { side, distancePct, vwap: vwapPrice } = card.vwap;
      if (direction === 'LONG' && side === 'BELOW' && distancePct < -1.5) {
        issues.push({ severity: 'caution', text: `Price ${Math.abs(distancePct)}% below session VWAP ($${vwapPrice}) — long fights intraday bias` });
      }
      if (direction === 'SHORT' && side === 'ABOVE' && distancePct > 1.5) {
        issues.push({ severity: 'caution', text: `Price ${distancePct}% above session VWAP ($${vwapPrice}) — short fights intraday bias` });
      }
      if (direction === 'LONG' && side === 'ABOVE' && distancePct > 3) {
        issues.push({ severity: 'caution', text: `Price ${distancePct}% above VWAP — extended, snap-back to VWAP likely` });
      }
      if (direction === 'SHORT' && side === 'BELOW' && distancePct < -3) {
        issues.push({ severity: 'caution', text: `Price ${Math.abs(distancePct)}% below VWAP — extended short, bounce risk` });
      }
      if (direction === 'LONG' && side === 'ABOVE' && distancePct > 0 && distancePct < 1) {
        strengths.push(`Price ${distancePct}% above VWAP — intraday bias supports long`);
      }
      if (direction === 'SHORT' && side === 'BELOW' && distancePct < 0 && distancePct > -1) {
        strengths.push(`Price ${Math.abs(distancePct)}% below VWAP — intraday bias supports short`);
      }
    }

    // Perp funding contrarian flag — crowded positioning predicts squeeze risk
    if (funding != null) {
      const fundingPct = (funding * 100).toFixed(3);
      if (direction === 'LONG' && funding > 0.0005) {
        issues.push({ severity: 'caution', text: `Funding ${fundingPct}%/8h (crowded longs) — squeeze risk against this long` });
      }
      if (direction === 'SHORT' && funding < -0.0003) {
        issues.push({ severity: 'caution', text: `Funding ${fundingPct}%/8h (crowded shorts) — squeeze risk against this short` });
      }
      if (direction === 'LONG' && funding < -0.0002) {
        strengths.push(`Funding ${fundingPct}%/8h — shorts are crowded, contrarian long tailwind`);
      }
      if (direction === 'SHORT' && funding > 0.0004) {
        strengths.push(`Funding ${fundingPct}%/8h — longs are crowded, contrarian short tailwind`);
      }
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
