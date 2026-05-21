export function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (d >= 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function calculateSMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// EMA — exponential moving average
export function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

// MACD — returns { macd, signal, histogram, bullishCross, bearishCross }
export function calculateMACD(prices) {
  if (!prices || prices.length < 35) return null;
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  if (ema12 == null || ema26 == null) return null;
  const macd = ema12 - ema26;

  // Build MACD line over last 30 bars to compute signal line
  const macdSeries = [];
  for (let i = 26; i < prices.length; i++) {
    const slice = prices.slice(0, i + 1);
    const e12 = calculateEMA(slice, 12);
    const e26 = calculateEMA(slice, 26);
    if (e12 != null && e26 != null) macdSeries.push(e12 - e26);
  }
  if (macdSeries.length < 10) return { macd, signal: null, histogram: null };

  const signal = calculateEMA(macdSeries, 9);
  const histogram = macd - signal;

  // Detect cross in the last 2 bars
  const prevMacd = macdSeries[macdSeries.length - 2];
  const prevSignal = calculateEMA(macdSeries.slice(0, -1), 9);
  const bullishCross = prevMacd <= prevSignal && macd > signal;
  const bearishCross = prevMacd >= prevSignal && macd < signal;

  return { macd, signal, histogram, bullishCross, bearishCross };
}

export function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prev = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / period;
}

export function analyzeSignals(quote, historical, marketRegime = null) {
  const signals = [];
  const warnings = [];

  if (!quote || !historical || historical.length < 30) {
    return { signals, warnings, rsi: null, atr: null, sma20: null, sma50: null, sma200: null };
  }

  const closes = historical.map(d => d.close);
  const highs  = historical.map(d => d.high);
  const lows   = historical.map(d => d.low);
  const price = quote.regularMarketPrice;
  const rsi = calculateRSI(closes);
  const atr = calculateATR(historical.map(d => ({ high: d.high, low: d.low, close: d.close })));
  const sma20  = calculateSMA(closes, Math.min(20, closes.length));
  const sma50  = calculateSMA(closes, Math.min(50, closes.length));
  const sma200 = calculateSMA(closes, Math.min(200, closes.length));

  // Recent swing high/low (last 5 sessions) for structure-based stops
  const recent5 = historical.slice(-5);
  const swingHigh = Math.max(...recent5.map(c => c.high));
  const swingLow  = Math.min(...recent5.map(c => c.low));
  const high20 = Math.max(...historical.slice(-20).map(c => c.high));
  const low20  = Math.min(...historical.slice(-20).map(c => c.low));
  const chgPct = quote.regularMarketChangePercent || 0;
  const vol = quote.regularMarketVolume;
  const avgVol = quote.averageDailyVolume3Month || quote.averageDailyVolume10Day;
  const high52 = quote.fiftyTwoWeekHigh;
  const low52 = quote.fiftyTwoWeekLow;

  if (rsi !== null) {
    if (rsi < 28)      signals.push({ type: 'bullish', text: `Severely oversold RSI ${rsi.toFixed(0)} — snap-back likely` });
    else if (rsi < 38) signals.push({ type: 'bullish', text: `Oversold RSI ${rsi.toFixed(0)} — reversal zone` });
    else if (rsi > 72) signals.push({ type: 'bearish', text: `Overbought RSI ${rsi.toFixed(0)} — exhaustion risk` });
    else if (rsi > 62) signals.push({ type: 'bearish', text: `RSI ${rsi.toFixed(0)} approaching overbought` });
  }

  if (vol && avgVol) {
    const vr = vol / avgVol;
    if (vr > 2.5)      signals.push({ type: chgPct >= 0 ? 'bullish' : 'bearish', text: `Massive volume spike ${vr.toFixed(1)}x avg` });
    else if (vr > 1.5) signals.push({ type: 'neutral', text: `Above-avg volume ${vr.toFixed(1)}x` });
    else if (vr < 0.5) warnings.push({ type: 'warning', text: 'Low volume — weak conviction signal' });
  }

  if (sma20) {
    if (price > sma20) signals.push({ type: 'bullish', text: 'Price above 20 SMA (uptrend support)' });
    else               signals.push({ type: 'bearish', text: 'Price below 20 SMA (downtrend resistance)' });
  }
  if (sma50) {
    if (price > sma50) signals.push({ type: 'bullish', text: 'Price above 50 SMA (mid-term uptrend)' });
    else               signals.push({ type: 'bearish', text: 'Price below 50 SMA (mid-term downtrend)' });
  }
  if (sma20 && sma50) {
    if (sma20 > sma50) signals.push({ type: 'bullish', text: '20 SMA > 50 SMA — bullish alignment' });
    else               signals.push({ type: 'bearish', text: '20 SMA < 50 SMA — bearish alignment' });
  }

  if (high52 && low52) {
    const rangeToHigh  = (high52 - price) / high52;
    const rangeFromLow = (price - low52) / (high52 - low52 || 1);
    if (rangeToHigh < 0.03)  signals.push({ type: 'bearish', text: 'Within 3% of 52-week high — heavy resistance' });
    else if (rangeToHigh < 0.07) signals.push({ type: 'bearish', text: 'Near 52-week high — potential distribution zone' });
    if (rangeFromLow < 0.05) {
      warnings.push({ type: 'skip-short', text: 'SKIP SHORT: On 52-week low — extreme squeeze risk' });
    } else if (rangeFromLow < 0.12) {
      signals.push({ type: 'bullish', text: 'Bouncing near 52-week low — strong support zone' });
    }
  }

  if (historical.length >= 2) {
    const prev    = historical[historical.length - 2].close;
    const todOpen = historical[historical.length - 1].open;
    const gap = (todOpen - prev) / prev * 100;
    if (gap > 3)       warnings.push({ type: 'warning', text: `Gap-up open ${gap.toFixed(1)}% — wait for dip entry` });
    else if (gap > 1.5) warnings.push({ type: 'warning', text: `Moderate gap-up ${gap.toFixed(1)}% — check dip` });
    else if (gap < -3)  signals.push({ type: 'bearish', text: `Gap-down open ${gap.toFixed(1)}% — bearish momentum` });
  }

  if (chgPct > 6)       signals.push({ type: 'bullish', text: `Strong daily momentum +${chgPct.toFixed(1)}%` });
  else if (chgPct > 3)  signals.push({ type: 'bullish', text: `Positive momentum +${chgPct.toFixed(1)}%` });
  else if (chgPct < -6) signals.push({ type: 'bearish', text: `Sharp sell-off ${chgPct.toFixed(1)}% — bounce candidate` });
  else if (chgPct < -3) signals.push({ type: 'bearish', text: `Significant decline ${chgPct.toFixed(1)}%` });

  if (atr && price) {
    const atrPct = (atr / price) * 100;
    if (atrPct < 0.8) warnings.push({ type: 'warning', text: 'Low volatility squeeze — await breakout' });
  }

  // MACD momentum confirmation
  const macd = calculateMACD(closes);
  if (macd) {
    if (macd.bullishCross) signals.push({ type: 'bullish', text: 'MACD bullish cross — momentum turning up' });
    else if (macd.bearishCross) signals.push({ type: 'bearish', text: 'MACD bearish cross — momentum turning down' });
    else if (macd.histogram > 0 && macd.macd > 0) signals.push({ type: 'bullish', text: 'MACD positive & above signal line' });
    else if (macd.histogram < 0 && macd.macd < 0) signals.push({ type: 'bearish', text: 'MACD negative & below signal line' });
  }

  // 200 SMA — major trend filter (most important signal)
  if (sma200) {
    if (price > sma200) signals.push({ type: 'bullish', text: 'Price above 200 SMA — major uptrend' });
    else signals.push({ type: 'bearish', text: 'Price below 200 SMA — major downtrend' });
  }

  // Market regime alignment (SPY context)
  if (marketRegime) {
    if (marketRegime === 'BULLISH') signals.push({ type: 'bullish', text: 'SPY in uptrend — broad market tailwind' });
    else if (marketRegime === 'BEARISH') signals.push({ type: 'bearish', text: 'SPY in downtrend — broad market pressure' });
  }

  // Pullback in uptrend / rally in downtrend (highest win-rate pattern)
  if (sma20 && sma50 && rsi != null) {
    if (price > sma50 && price > sma20 && rsi < 45) {
      signals.push({ type: 'bullish', text: 'Pullback to support in uptrend — A+ setup' });
    }
    if (price < sma50 && price < sma20 && rsi > 55) {
      signals.push({ type: 'bearish', text: 'Rally to resistance in downtrend — A+ setup' });
    }
  }

  return { signals, warnings, rsi, atr, sma20, sma50, sma200, macd, swingHigh, swingLow, high20, low20 };
}

// Confirmation candle check — pros NEVER enter without the bar confirming direction
// Returns: { confirmed: bool, type: string, reasoning: string }
function checkConfirmationCandle(historical, direction) {
  if (!historical || historical.length < 3) return { confirmed: false, type: 'no-data', reasoning: 'Insufficient candle history' };
  const today  = historical[historical.length - 1];
  const yesterday = historical[historical.length - 2];
  const day3  = historical[historical.length - 3];
  if (!today || !yesterday) return { confirmed: false, type: 'no-data', reasoning: 'Missing candle data' };

  const todayBody = Math.abs(today.close - today.open);
  const todayRange = today.high - today.low;
  const bodyRatio = todayRange > 0 ? todayBody / todayRange : 0;
  const isBullishCandle = today.close > today.open;
  const isBearishCandle = today.close < today.open;
  const closedAboveYday = today.close > yesterday.close;
  const closedBelowYday = today.close < yesterday.close;

  if (direction === 'LONG') {
    // STRONG confirmation: bullish candle, close above yesterday, healthy body
    if (isBullishCandle && closedAboveYday && bodyRatio > 0.5) {
      return { confirmed: true, type: 'strong-bullish', reasoning: 'Strong bullish candle close above yesterday — momentum confirmed' };
    }
    // BOUNCE confirmation: today's low rejected support, closed above open
    const lowerWick = (today.open < today.close ? today.open : today.close) - today.low;
    const wickRatio = todayRange > 0 ? lowerWick / todayRange : 0;
    if (isBullishCandle && wickRatio > 0.4) {
      return { confirmed: true, type: 'bounce', reasoning: 'Long lower wick — buyers stepped in at the low' };
    }
    // WEAK confirmation: at least closed green
    if (isBullishCandle) {
      return { confirmed: true, type: 'weak-bullish', reasoning: 'Closed green but weak body — proceed with caution' };
    }
    return { confirmed: false, type: 'no-confirmation', reasoning: 'Today is a red candle — no bullish confirmation yet' };
  } else {
    if (isBearishCandle && closedBelowYday && bodyRatio > 0.5) {
      return { confirmed: true, type: 'strong-bearish', reasoning: 'Strong bearish candle close below yesterday — selling confirmed' };
    }
    const upperWick = today.high - (today.open > today.close ? today.open : today.close);
    const wickRatio = todayRange > 0 ? upperWick / todayRange : 0;
    if (isBearishCandle && wickRatio > 0.4) {
      return { confirmed: true, type: 'rejection', reasoning: 'Long upper wick — sellers rejected the high' };
    }
    if (isBearishCandle) {
      return { confirmed: true, type: 'weak-bearish', reasoning: 'Closed red but weak body — proceed with caution' };
    }
    return { confirmed: false, type: 'no-confirmation', reasoning: 'Today is a green candle — no bearish confirmation yet' };
  }
}

export function generateTradeSetup(quote, historical, signalData, opts = {}) {
  const { signals, warnings, rsi, atr, sma20, sma50, sma200, swingHigh, swingLow, high20, low20 } = signalData;
  const price = quote.regularMarketPrice;
  if (!price || !atr || atr <= 0) return null;

  // ── Liquidity gates (skip for forex / commodities — different price scales) ──
  const market = opts.market || 'stocks';
  if (market === 'stocks') {
    if (price < 5) return null;                        // No penny stocks
    const avgVol = quote.averageDailyVolume3Month;
    if (avgVol && avgVol < 500_000) return null;       // Min 500k daily share volume
    const dollarVolume = (avgVol || 0) * price;
    if (dollarVolume && dollarVolume < 10_000_000) return null; // Min $10M daily $-volume
  }

  // ── Volatility band: not too dead, not too crazy ────────────────────
  const atrPct = (atr / price) * 100;
  if (atrPct < 0.7) return null;                     // Too quiet
  if (atrPct > 10.0) return null;                    // Too erratic

  const hasSkipShort = warnings.some(w => w.type === 'skip-short');
  const bullish = signals.filter(s => s.type === 'bullish').length;
  const bearish = signals.filter(s => s.type === 'bearish').length;

  let direction = bullish >= bearish ? 'LONG' : 'SHORT';
  if (hasSkipShort && direction === 'SHORT') return null;

  const confirming = direction === 'LONG' ? bullish : bearish;
  const opposing   = direction === 'LONG' ? bearish : bullish;
  if (confirming < 2) return null;                   // 2+ confirming signals (was 3)
  if (opposing >= confirming + 1) return null;       // Allow tied signals (was: required edge)

  const probability = confirming >= 5 ? 'HIGH' : confirming >= 3 ? 'MEDIUM' : 'LOW';
  // We accept LOW probability now if everything else passes — more action

  const round = (n) => Math.round(n * 100) / 100;
  let entry, tp, sl;

  // ── Detect key support/resistance levels — RECENT history only (last 30 days) ──
  // Why: older levels are less relevant for 3-10 day swing horizon
  const recentHistory = historical.slice(-30);
  const swingPivots = [];
  for (let i = 2; i < recentHistory.length - 2; i++) {
    const c = recentHistory[i];
    if (c.high > recentHistory[i-1].high && c.high > recentHistory[i-2].high &&
        c.high > recentHistory[i+1].high && c.high > recentHistory[i+2].high) {
      swingPivots.push({ price: c.high, type: 'high' });
    }
    if (c.low < recentHistory[i-1].low && c.low < recentHistory[i-2].low &&
        c.low < recentHistory[i+1].low && c.low < recentHistory[i+2].low) {
      swingPivots.push({ price: c.low, type: 'low' });
    }
  }
  // Cluster within 0.5 ATR
  const clusters = [];
  for (const p of swingPivots) {
    const e = clusters.find(c => Math.abs(c.price - p.price) <= atr * 0.5);
    if (e) { e.hits++; e.price = (e.price * (e.hits - 1) + p.price) / e.hits; }
    else { clusters.push({ price: p.price, hits: 1 }); }
  }
  // Keep levels hit at least once recently — more relevant than older 2x-hit levels
  const strongLevels = clusters;

  // Round-number snap — if a major psych level is within 0.5 ATR of TP, prefer it
  function snapToPsychLevel(price, direction) {
    // Find round numbers near the price
    const candidates = [];
    const order = price >= 100 ? 10 : price >= 10 ? 5 : 1;
    for (let mult = -5; mult <= 5; mult++) {
      const candidate = Math.round(price / order) * order + mult * order;
      if (Math.abs(candidate - price) < atr * 0.5) candidates.push(candidate);
    }
    if (direction === 'LONG') {
      // Find nearest round number BELOW the candidate TP (exit just before it)
      const below = candidates.filter(c => c < price).sort((a, b) => b - a);
      return below[0] || price;
    } else {
      const above = candidates.filter(c => c > price).sort((a, b) => a - b);
      return above[0] || price;
    }
  }

  // Realistic swing-trade horizon assumptions (3–7 days):
  // Expected price travel = ATR × √days. For 5 days → ~2.2 × ATR is the natural reach.
  // TP target should sit within that envelope to be achievable.

  let tp2;

  // ── Compute TREND STRENGTH (0–3) to scale TP multipliers dynamically ──
  // Stronger trend = bigger realistic move = higher targets
  function computeTrendStrength() {
    let s = 0;
    if (confirming >= 8)      s = 3;
    else if (confirming >= 6) s = 2;
    else if (confirming >= 4) s = 1;
    // Multi-timeframe trend bonus
    if (sma200 && sma50) {
      if (direction === 'LONG'  && price > sma50 && sma50 > sma200) s += 0.5;
      if (direction === 'SHORT' && price < sma50 && sma50 < sma200) s += 0.5;
    }
    // Strong daily momentum bonus
    const chg = quote.regularMarketChangePercent || 0;
    if (Math.abs(chg) > 3) s += 0.25;
    return Math.min(3, s);
  }
  const trendStrength = computeTrendStrength();

  // ── TRADE STYLE: 'sameDay' (intraday) or 'swing' (multi-day) ──
  const tradeStyle = opts.tradeStyle || 'sameDay';

  // DYNAMIC TP multipliers based on trend strength AND trade style
  // SAME-DAY: targets must be reachable within one session (6.5 hours)
  //   1 trading day ≈ ATR of movement, so targets stay tight
  // SWING: multi-day targets
  let tp1Mult, tp2Mult, slMult;
  if (tradeStyle === 'sameDay') {
    tp1Mult = 0.65 + (trendStrength * 0.20);  // 0.65 → 1.25 × ATR (≤ same day)
    tp2Mult = 1.15 + (trendStrength * 0.30);  // 1.15 → 2.05 × ATR (≤ next day)
    slMult  = 0.7;                             // tight intraday stop
  } else {
    tp1Mult = 1.6 + (trendStrength * 0.4);    // 1.6 → 2.8 × ATR  (3–10 days)
    tp2Mult = 2.8 + (trendStrength * 0.4);    // 2.8 → 4.0 × ATR  (8–16 days)
    slMult  = 1.4;
  }

  if (direction === 'LONG') {
    const dipFactor = (rsi && rsi > 55) ? 0.994 : 1.001;
    entry = round(price * dipFactor);

    const supports    = strongLevels.filter(l => l.price < entry).sort((a, b) => b.price - a.price);
    const resistances = strongLevels.filter(l => l.price > entry).sort((a, b) => a.price - b.price);

    // ── STOP LOSS — tighter for same-day trades ──
    const slDefault = entry - atr * slMult;
    let slCandidate = slDefault;
    if (supports.length > 0) {
      const supportBased = supports[0].price - atr * 0.15;
      const dist = entry - supportBased;
      const slRangeMin = tradeStyle === 'sameDay' ? atr * 0.4 : atr * 1.0;
      const slRangeMax = tradeStyle === 'sameDay' ? atr * 1.0 : atr * 1.8;
      if (dist >= slRangeMin && dist <= slRangeMax) slCandidate = supportBased;
    }
    const slCapPct = tradeStyle === 'sameDay' ? 0.025 : 0.04; // 2.5% intraday vs 4% swing
    sl = round(Math.max(slCandidate, entry * (1 - slCapPct)));
    sl = round(Math.min(sl, entry - atr * (tradeStyle === 'sameDay' ? 0.4 : 0.9)));

    // ── TP1: REALISTIC ──
    // Default = trend-scaled ATR. Use resistance if within sensible range.
    const tpDefault = entry + atr * tp1Mult;
    let tpCandidate = tpDefault;
    if (resistances.length > 0) {
      const resBased = resistances[0].price - atr * 0.15;
      const dist = resBased - entry;
      // Accept resistance-based TP if reasonable distance
      if (dist >= atr * 1.3 && dist <= atr * (tp1Mult + 2)) tpCandidate = resBased;
    }
    // Psych-level snap
    const psychSnap1 = snapToPsychLevel(tpCandidate, 'LONG');
    if (psychSnap1 < tpCandidate && (tpCandidate - psychSnap1) <= atr * 0.4) {
      tpCandidate = psychSnap1 - 0.05;
    }
    // Floor: must be at least 3% from entry (meaningful gain)
    tpCandidate = Math.max(tpCandidate, entry * 1.03);
    // Cap: 52-week high (structural — beyond is "blue sky")
    if (quote.fiftyTwoWeekHigh && tpCandidate > quote.fiftyTwoWeekHigh * 0.998) {
      tpCandidate = quote.fiftyTwoWeekHigh * 0.998;
    }
    tp = round(tpCandidate);

    // ── TP2: EXTENDED (momentum target) ──
    const tp2Default = entry + atr * tp2Mult;
    let tp2Candidate = tp2Default;
    // Look for resistance further out
    const resistancesBeyondTp1 = resistances.filter(r => r.price > tp);
    if (resistancesBeyondTp1.length > 0) {
      const res2Based = resistancesBeyondTp1[0].price - atr * 0.15;
      const dist = res2Based - entry;
      if (dist >= atr * (tp1Mult + 0.5) && dist <= atr * (tp2Mult + 2)) {
        tp2Candidate = res2Based;
      }
    }
    const psychSnap2 = snapToPsychLevel(tp2Candidate, 'LONG');
    if (psychSnap2 < tp2Candidate && (psychSnap2 > tp) && (tp2Candidate - psychSnap2) <= atr * 0.5) {
      tp2Candidate = psychSnap2 - 0.05;
    }
    // Floor: TP2 must be meaningfully beyond TP1 (at least 1.5 ATR or 2.5% more)
    tp2Candidate = Math.max(tp2Candidate, tp + atr * 1.5, entry * 1.05);
    // Cap: 52-week high (no blue-sky targets without precedent)
    if (quote.fiftyTwoWeekHigh && tp2Candidate > quote.fiftyTwoWeekHigh * 0.998) {
      tp2Candidate = quote.fiftyTwoWeekHigh * 0.998;
    }
    tp2 = round(tp2Candidate);
    if (tp2 <= tp + atr * 0.5) tp2 = round(tp + atr * 1.5);

  } else {
    // SHORT mirror
    const bounceFactor = (rsi && rsi > 45) ? 1.006 : 0.999;
    entry = round(price * bounceFactor);

    const resistances = strongLevels.filter(l => l.price > entry).sort((a, b) => a.price - b.price);
    const supports    = strongLevels.filter(l => l.price < entry).sort((a, b) => b.price - a.price);

    const slDefault = entry + atr * slMult;
    let slCandidate = slDefault;
    if (resistances.length > 0) {
      const resBased = resistances[0].price + atr * 0.15;
      const dist = resBased - entry;
      const slRangeMin = tradeStyle === 'sameDay' ? atr * 0.4 : atr * 1.0;
      const slRangeMax = tradeStyle === 'sameDay' ? atr * 1.0 : atr * 1.8;
      if (dist >= slRangeMin && dist <= slRangeMax) slCandidate = resBased;
    }
    const slCapPct = tradeStyle === 'sameDay' ? 0.025 : 0.04;
    sl = round(Math.min(slCandidate, entry * (1 + slCapPct)));
    sl = round(Math.max(sl, entry + atr * (tradeStyle === 'sameDay' ? 0.4 : 0.9)));

    // TP1
    const tpDefault = entry - atr * tp1Mult;
    let tpCandidate = tpDefault;
    if (supports.length > 0) {
      const supBased = supports[0].price + atr * 0.15;
      const dist = entry - supBased;
      if (dist >= atr * 1.3 && dist <= atr * (tp1Mult + 2)) tpCandidate = supBased;
    }
    const psychSnap1 = snapToPsychLevel(tpCandidate, 'SHORT');
    if (psychSnap1 > tpCandidate && (psychSnap1 - tpCandidate) <= atr * 0.4) {
      tpCandidate = psychSnap1 + 0.05;
    }
    tpCandidate = Math.min(tpCandidate, entry * 0.97);
    if (quote.fiftyTwoWeekLow && tpCandidate < quote.fiftyTwoWeekLow * 1.002) {
      tpCandidate = quote.fiftyTwoWeekLow * 1.002;
    }
    tp = round(tpCandidate);

    // TP2
    const tp2Default = entry - atr * tp2Mult;
    let tp2Candidate = tp2Default;
    const supportsBeyondTp1 = supports.filter(s => s.price < tp);
    if (supportsBeyondTp1.length > 0) {
      const sup2Based = supportsBeyondTp1[0].price + atr * 0.15;
      const dist = entry - sup2Based;
      if (dist >= atr * (tp1Mult + 0.5) && dist <= atr * (tp2Mult + 2)) {
        tp2Candidate = sup2Based;
      }
    }
    const psychSnap2 = snapToPsychLevel(tp2Candidate, 'SHORT');
    if (psychSnap2 > tp2Candidate && (psychSnap2 < tp) && (psychSnap2 - tp2Candidate) <= atr * 0.5) {
      tp2Candidate = psychSnap2 + 0.05;
    }
    tp2Candidate = Math.min(tp2Candidate, tp - atr * 1.5, entry * 0.95);
    if (quote.fiftyTwoWeekLow && tp2Candidate < quote.fiftyTwoWeekLow * 1.002) {
      tp2Candidate = quote.fiftyTwoWeekLow * 1.002;
    }
    tp2 = round(tp2Candidate);
    if (tp2 >= tp - atr * 0.5) tp2 = round(tp - atr * 1.5);
  }

  // ── TIME CEILINGS by trade style ─────────────────────────────────────
  // SAME-DAY: targets must reach within one trading session (1 day max)
  // SWING: multi-day window
  const MAX_DAYS_TP1 = tradeStyle === 'sameDay' ? 1  : 10;
  const MAX_DAYS_TP2 = tradeStyle === 'sameDay' ? 2  : 16;
  const MAX_DIST_TP1 = atr * Math.sqrt(MAX_DAYS_TP1);
  const MAX_DIST_TP2 = atr * Math.sqrt(MAX_DAYS_TP2);

  if (direction === 'LONG') {
    // If TP exceeds time envelope, cap it to fit
    if ((tp - entry) > MAX_DIST_TP1) tp = round(entry + MAX_DIST_TP1);
    if ((tp2 - entry) > MAX_DIST_TP2) tp2 = round(entry + MAX_DIST_TP2);
    // Ensure TP2 remains meaningfully beyond TP1
    if (tp2 - tp < atr * 0.8) tp2 = round(Math.min(tp + atr * 1.0, entry + MAX_DIST_TP2));
  } else {
    if ((entry - tp) > MAX_DIST_TP1) tp = round(entry - MAX_DIST_TP1);
    if ((entry - tp2) > MAX_DIST_TP2) tp2 = round(entry - MAX_DIST_TP2);
    if (tp - tp2 < atr * 0.8) tp2 = round(Math.max(tp - atr * 1.0, entry - MAX_DIST_TP2));
  }

  // Recompute days-to-target after caps
  const tpDistance  = Math.abs(tp - entry);
  const tp2Distance = Math.abs(tp2 - entry);
  const expectedDays  = Math.max(1, Math.round((tpDistance  / atr) ** 2));
  const expectedDays2 = Math.max(2, Math.round((tp2Distance / atr) ** 2));

  // ── Reject if targets are now so close they're not meaningful ──
  // Same-day: smaller targets allowed (0.5 ATR TP1, 0.9 ATR TP2)
  // Swing: bigger floors (1.2 ATR TP1, 2.0 ATR TP2)
  const minTP1 = tradeStyle === 'sameDay' ? atr * 0.5 : atr * 1.2;
  const minTP2 = tradeStyle === 'sameDay' ? atr * 0.9 : atr * 2.0;
  if (tpDistance  < minTP1) return null;
  if (tp2Distance < minTP2) return null;

  const risk   = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk <= 0) return null;
  const rrRatio = Math.round((reward / risk) * 10) / 10;
  const minRR = (opts.tradeStyle === 'sameDay') ? 1.2 : 1.3;
  if (rrRatio < minRR) return null;                 // Min R:R — math must still be positive
  if (rrRatio > 6.0) return null;                   // Unrealistically wide

  // ── CONFIDENCE = "Same-Day Execution Probability" (0–99) ────────────
  // Calibrated for intraday execution when tradeStyle='sameDay'
  let confidence = 50;

  // 1. Setup quality (technical signals)
  confidence += confirming * 5;                     // each confirming +5
  confidence -= opposing * 7;                       // each opposing -7
  if (probability === 'HIGH') confidence += 8;
  if (rrRatio >= 2.5) confidence += 5;
  if (rrRatio >= 2.0) confidence += 2;

  // 2. Trend alignment (helps any trade)
  if (direction === 'LONG'  && sma20 && sma50 && price > sma20 && sma20 > sma50) confidence += 5;
  if (direction === 'SHORT' && sma20 && sma50 && price < sma20 && sma20 < sma50) confidence += 5;

  // ── SAME-DAY SPECIFIC ADJUSTMENTS ──
  if (tradeStyle === 'sameDay') {
    // a) TP proximity — closer TP = higher chance of hitting within session
    const tpDistATR = Math.abs(tp - entry) / atr;
    if (tpDistATR < 0.8)      confidence += 10;  // very reachable in hours
    else if (tpDistATR < 1.2) confidence += 5;   // reachable in session
    else if (tpDistATR < 1.6) confidence += 0;   // borderline
    else                       confidence -= 8;   // unlikely intraday

    // b) Today's intraday momentum alignment
    const chg = quote.regularMarketChangePercent || 0;
    if (direction === 'LONG') {
      if (chg > 1.5)  confidence += 10;  // strong same-direction move today
      else if (chg > 0.3) confidence += 5;
      else if (chg < -1.5) confidence -= 12; // bad — moving against you
    } else {
      if (chg < -1.5) confidence += 10;
      else if (chg < -0.3) confidence += 5;
      else if (chg > 1.5)  confidence -= 12;
    }

    // c) TODAY's volume conviction (not just average)
    const vol = quote.regularMarketVolume;
    const avgVol = quote.averageDailyVolume3Month;
    if (vol && avgVol) {
      const vr = vol / avgVol;
      if (vr > 1.5)      confidence += 8;   // institutional participation
      else if (vr > 1.0) confidence += 3;
      else if (vr < 0.5) confidence -= 10;  // weak volume kills intraday moves
    }

    // d) Confirmation candle strength
    const conf = checkConfirmationCandle(historical, direction);
    if (conf.confirmed && conf.type?.includes('strong')) confidence += 8;
    else if (conf.confirmed && conf.type?.includes('bounce')) confidence += 5;
    else if (conf.confirmed) confidence += 2;
    else                      confidence -= 15;  // no confirmation = no edge intraday
  }

  confidence = Math.max(15, Math.min(95, Math.round(confidence)));

  // Build a REACHABLE entry zone — wide enough to actually fill, tight enough to stay disciplined
  //   • Width scales with stock volatility (0.3 × ATR)
  //   • Floor: 0.4% of price (small stocks still get a usable range)
  //   • Cap: 1.5% of price (never wider than that — keeps discipline)
  const rangeWidth = Math.min(
    Math.max(atr * 0.3, price * 0.004),
    price * 0.015
  );
  const entryLow  = round(entry - rangeWidth / 2);
  const entryHigh = round(entry + rangeWidth / 2);

  // R:R for the extended target
  const reward2 = Math.abs(tp2 - entry);
  const rrRatio2 = risk > 0 ? Math.round((reward2 / risk) * 10) / 10 : null;

  const trendStrengthLabel = trendStrength >= 2.5 ? 'Very Strong'
                          : trendStrength >= 1.5 ? 'Strong'
                          : trendStrength >= 0.5 ? 'Moderate'
                                                  : 'Weak';

  // Confirmation candle — last piece of edge
  const confirmation = checkConfirmationCandle(historical, direction);

  // Convert expected days → expected hours for same-day trades
  // (intraday session is ~6.5 hours)
  const expectedHours  = tradeStyle === 'sameDay' ? Math.max(1, Math.round(expectedDays  * 6.5)) : null;
  const expectedHours2 = tradeStyle === 'sameDay' ? Math.max(2, Math.round(expectedDays2 * 6.5)) : null;

  return {
    direction, entry, entryLow, entryHigh,
    tp, tp2, sl,
    rrRatio, rrRatio2,
    probability, confirming, confidence,
    expectedDays, expectedDays2,
    expectedHours, expectedHours2,
    trendStrength, trendStrengthLabel,
    confirmation,
    tradeStyle,
    signals: [...signals, ...warnings], warnings, rsi, atr
  };
}

export const TIME_SPANS = {
  scalp:  { label: '4–8 Hours',  days: 0.5 },
  short:  { label: '24–48 Hours', days: 2 },
  swing:  { label: '3–5 Days',   days: 4 },
  medium: { label: '1–2 Weeks',  days: 10 }
};

export function getTimespanKey(atr, price) {
  const pct = atr / price;
  if (pct > 0.05)  return 'scalp';
  if (pct > 0.03)  return 'short';
  if (pct > 0.015) return 'swing';
  return 'medium';
}

export function getExitWindow(key) {
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const start  = new Date();
  start.setDate(start.getDate() + Math.round(TIME_SPANS[key].days));
  while (start.getDay() === 0 || start.getDay() === 6) start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  while (end.getDay() === 0 || end.getDay() === 6) end.setDate(end.getDate() + 1);
  return `${days[start.getDay()]}–${days[end.getDay()]} ${start.getDate()}–${end.getDate()} ${months[start.getMonth()]}`;
}

export function generateAnalystNotes(direction, ticker, signals, rsi, atr, price) {
  const bullCount  = signals.filter(s => s.type === 'bullish').length;
  const bearCount  = signals.filter(s => s.type === 'bearish').length;
  const volSignal  = signals.find(s => s.text.toLowerCase().includes('volume'));
  const rsiText    = rsi
    ? (rsi < 35 ? 'deeply oversold RSI reading' : rsi > 65 ? 'overbought RSI reading' : `neutral RSI at ${rsi.toFixed(0)}`)
    : 'RSI data unavailable';
  const atrPct = atr && price ? ((atr / price) * 100).toFixed(2) : null;

  if (direction === 'LONG') {
    return [
      `${ticker} presents a bullish swing setup with ${bullCount} confirming technical signals aligned to the upside.`,
      `The ${rsiText} supports a mean-reversion or continuation trade depending on the broader trend structure.`,
      `${volSignal ? volSignal.text + ' adds conviction to the move.' : 'Monitor volume on the entry candle — a surge above the open adds significant conviction.'}`,
      `ATR of $${atr?.toFixed(2) || 'N/A'} (${atrPct ? atrPct + '% daily range' : 'N/A'}) — size your position accordingly. Do not risk more than 1–2% of capital.`,
      `Honor your stop loss. A daily close below SL is an exit signal — do not average down.`
    ];
  } else {
    return [
      `${ticker} shows a bearish setup with ${bearCount} confirming signals pointing to further downside.`,
      `The ${rsiText} ${rsi && rsi > 60 ? 'confirms exhaustion of buying pressure.' : 'suggests selling momentum is building.'}`,
      `${volSignal ? 'Volume confirms distribution pressure: ' + volSignal.text + '.' : 'Watch for volume confirmation on the break — low-volume moves can reverse quickly.'}`,
      `ATR of $${atr?.toFixed(2) || 'N/A'} informs both position sizing and realistic target setting. Do not over-lever.`,
      `Never short a dead-cat bounce bottom. Wait for the bounce to fade before entering this short.`
    ];
  }
}
