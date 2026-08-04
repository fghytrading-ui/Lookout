// Trade thesis — the reason this trade exists, in one line.
//
// A scanner that lists setups without stating WHY is just pattern-matching
// noise. Every card should answer: what is driving this, and is that reason
// good enough to risk money on? This module builds that statement and grades
// how well-supported the trade actually is.

/**
 * Build a plain-language thesis from the catalyst picture and the technicals.
 *
 * Returns { headline, drivers[], quality, tradeable, reason }
 *   quality   — 'catalyst-driven' | 'technical' | 'weak'
 *   tradeable — false when there is no real reason to be in this trade
 */
export function buildThesis({ direction, catalystAnalysis, signalData, setup, extendedHours, sector, market = 'stocks', cryptoContext = null, vwap = null }) {
  const drivers = [];
  const dirWord = direction === 'LONG' ? 'upside' : 'downside';
  const isEquity = market === 'stocks';

  // ── 1. Catalyst — the strongest possible reason ──
  const cat = catalystAnalysis?.primary;
  const catAligned = cat && (
    (direction === 'LONG'  && cat.direction === 'bullish') ||
    (direction === 'SHORT' && cat.direction === 'bearish')
  );
  const catConflicts = cat && (
    (direction === 'LONG'  && cat.direction === 'bearish') ||
    (direction === 'SHORT' && cat.direction === 'bullish')
  );

  if (catAligned && cat.weight >= 1.3) {
    drivers.push({
      kind: 'catalyst',
      weight: cat.impact,
      text: `${cat.label} (${cat.age})`
    });
  }

  // ── 2. Extended-hours confirmation ──
  if (extendedHours) {
    const aligned = (direction === 'LONG'  && extendedHours.direction === 'up') ||
                    (direction === 'SHORT' && extendedHours.direction === 'down');
    if (aligned && Math.abs(extendedHours.movePct) >= 0.5) {
      drivers.push({
        kind: 'extended',
        weight: 3,
        text: `${extendedHours.session === 'pre' ? 'Pre' : 'Post'}-market ${extendedHours.movePct > 0 ? '+' : ''}${extendedHours.movePct}% confirming`
      });
    }
  }

  // ── 3. Technical structure ──
  const { rsi, sma20, sma50, sma200, macd } = signalData || {};
  const price = setup?.entry;
  if (price && sma50 && sma200) {
    const stacked = direction === 'LONG'
      ? (price > sma50 && sma50 > sma200)
      : (price < sma50 && sma50 < sma200);
    if (stacked) drivers.push({ kind: 'trend', weight: 4, text: 'Trend aligned across 50 and 200 SMA' });
  }
  if (rsi != null) {
    if (direction === 'LONG' && rsi < 40) drivers.push({ kind: 'rsi', weight: 3, text: `Oversold RSI ${Math.round(rsi)}` });
    if (direction === 'SHORT' && rsi > 65) drivers.push({ kind: 'rsi', weight: 3, text: `Overbought RSI ${Math.round(rsi)}` });
  }
  if (macd) {
    if (direction === 'LONG' && macd.bullishCross) drivers.push({ kind: 'macd', weight: 3, text: 'MACD turning up' });
    if (direction === 'SHORT' && macd.bearishCross) drivers.push({ kind: 'macd', weight: 3, text: 'MACD turning down' });
  }
  if (setup?.confirmation?.confirmed) {
    drivers.push({ kind: 'confirm', weight: 2, text: 'Candle confirms direction' });
  }

  // ── 4. Market-specific drivers ──
  // Forex, commodities and crypto do not produce company catalysts, so their
  // legitimate reasons come from macro regime and structure instead. Judging
  // them by an equity news bar would reject every valid setup.
  if (market === 'crypto' && cryptoContext) {
    const btc = cryptoContext.btcTrend;
    if (btc === 'BULLISH' && direction === 'LONG')  drivers.push({ kind: 'regime', weight: 4, text: 'BTC trend bullish — macro tailwind' });
    if (btc === 'BEARISH' && direction === 'SHORT') drivers.push({ kind: 'regime', weight: 4, text: 'BTC trend bearish — macro tailwind' });
    const fg = cryptoContext.fearGreed;
    if (fg != null) {
      if (direction === 'LONG'  && fg < 25) drivers.push({ kind: 'sentiment', weight: 3, text: `Fear & Greed ${fg} — contrarian long zone` });
      if (direction === 'SHORT' && fg > 75) drivers.push({ kind: 'sentiment', weight: 3, text: `Fear & Greed ${fg} — late-stage greed` });
    }
  }
  if (vwap) {
    const withBias = (direction === 'LONG'  && vwap.side === 'ABOVE') ||
                     (direction === 'SHORT' && vwap.side === 'BELOW');
    if (withBias && Math.abs(vwap.distancePct) < 2) {
      drivers.push({ kind: 'vwap', weight: 3, text: `Holding ${vwap.side.toLowerCase()} VWAP — intraday bias aligned` });
    }
  }

  drivers.sort((a, b) => b.weight - a.weight);

  // ── Quality assessment ──
  const hasCatalyst = drivers.some(d => d.kind === 'catalyst');
  const technicalWeight = drivers.filter(d => d.kind !== 'catalyst')
                                 .reduce((a, d) => a + d.weight, 0);

  let quality, tradeable = true, reason = null;

  if (catConflicts && cat.weight >= 1.3) {
    quality = 'weak';
    tradeable = false;
    reason = `News conflicts with this ${direction}: ${cat.label} (${cat.age})`;
  } else if (hasCatalyst) {
    quality = 'catalyst-driven';
  } else if (technicalWeight >= (isEquity ? 6 : 4)) {
    // Thresholds are set from expectancy, not taste. Trend alignment plus a
    // confirming candle scores 6 — the tracked win rate for that profile is
    // ~29%, which at the current R:R of ~2.9 returns +0.13R per trade. It is
    // profitable, so it is a legitimate reason to trade and must not be
    // labelled weak. Below this, the edge disappears.
    // Forex, commodities and crypto have no company catalysts at all, so
    // structure and macro regime ARE the reason and the bar sits lower.
    quality = 'technical';
  } else {
    quality = 'weak';
    tradeable = false;
    reason = isEquity
      ? 'No catalyst and only weak technical support — not a reason to risk money'
      : 'Weak structural setup with no clear driver — not a reason to risk money';
  }

  // ── Headline ──
  let headline;
  if (!tradeable) {
    headline = reason;
  } else if (hasCatalyst) {
    const c = drivers.find(d => d.kind === 'catalyst');
    headline = `${c.text} driving ${dirWord}`;
    const support = drivers.filter(d => d.kind !== 'catalyst').slice(0, 2).map(d => d.text);
    if (support.length) headline += `, supported by ${support.join(' and ').toLowerCase()}`;
  } else {
    headline = `Technical ${dirWord}: ${drivers.slice(0, 3).map(d => d.text).join(', ').toLowerCase()}`;
  }

  return {
    headline,
    drivers: drivers.slice(0, 4),
    quality,
    tradeable,
    reason,
    hasCatalyst,
    technicalWeight
  };
}
