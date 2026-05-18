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

export function generateTradeSetup(quote, historical, signalData) {
  const { signals, warnings, rsi, atr, sma20, sma50, sma200, swingHigh, swingLow, high20, low20 } = signalData;
  const price = quote.regularMarketPrice;
  if (!price || !atr || atr <= 0) return null;

  // ── Liquidity gates ─────────────────────────────────────────────────
  if (price < 5) return null;                        // No penny stocks
  const avgVol = quote.averageDailyVolume3Month;
  if (avgVol && avgVol < 500_000) return null;       // Min 500k daily share volume
  const dollarVolume = (avgVol || 0) * price;
  if (dollarVolume && dollarVolume < 10_000_000) return null; // Min $10M daily $-volume

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
  if (confirming < 3) return null;                   // 3+ confirming signals
  if (opposing >= confirming) return null;           // Edge required

  const probability = confirming >= 6 ? 'HIGH' : confirming >= 4 ? 'MEDIUM' : null;
  if (!probability) return null;

  const round = (n) => Math.round(n * 100) / 100;
  let entry, tp, sl;

  // ── Detect key support/resistance levels (5-bar pivots, clustered) ──
  const swingPivots = [];
  for (let i = 2; i < historical.length - 2; i++) {
    const c = historical[i];
    if (c.high > historical[i-1].high && c.high > historical[i-2].high &&
        c.high > historical[i+1].high && c.high > historical[i+2].high) {
      swingPivots.push({ price: c.high, type: 'high' });
    }
    if (c.low < historical[i-1].low && c.low < historical[i-2].low &&
        c.low < historical[i+1].low && c.low < historical[i+2].low) {
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
  // Keep only "reactive" levels (hit ≥ 2×)
  const strongLevels = clusters.filter(c => c.hits >= 2);

  if (direction === 'LONG') {
    // Entry: light dip from current price (more reachable, but not chasing)
    const dipFactor = (rsi && rsi > 55) ? 0.993 : 1.001;
    entry = round(price * dipFactor);

    // Nearest support BELOW entry (for tighter, structure-based SL)
    const supports = strongLevels.filter(l => l.price < entry).sort((a, b) => b.price - a.price);
    // Nearest resistance ABOVE entry (for realistic, reachable TP)
    const resistances = strongLevels.filter(l => l.price > entry).sort((a, b) => a.price - b.price);

    // ── STOP LOSS: structure-aware ──
    // Default = 1.5 × ATR. Use support-based ONLY if it sits within 1–2 ATR (sensible distance).
    const slDefault = entry - atr * 1.5;
    let slCandidate = slDefault;
    if (supports.length > 0) {
      const supportBased = supports[0].price - atr * 0.25;
      const dist = entry - supportBased;
      if (dist >= atr * 1.0 && dist <= atr * 2.0) {
        slCandidate = supportBased;
      }
    }
    sl = round(Math.max(slCandidate, entry * 0.95));   // cap loss at 5% (prevent reckless SLs)
    sl = round(Math.min(sl, entry - atr * 0.8));        // never tighter than 0.8 ATR

    // ── TAKE PROFIT: realistic, reachable in 3–10 days ──
    // Default = 2.5 × ATR. Use resistance-based when it's the more achievable target.
    const tpDefault = entry + atr * 2.5;
    let tpCandidate = tpDefault;
    if (resistances.length > 0) {
      const resBased = resistances[0].price - atr * 0.15;  // exit just before resistance
      const dist = resBased - entry;
      if (dist >= atr * 1.5 && dist <= atr * 4.0) {
        tpCandidate = resBased;                            // realistic, structure-aware target
      }
    }
    tp = round(Math.min(tpCandidate, entry * 1.10));     // cap gain at 10% (realistic for swing)
  } else {
    // SHORT — mirror of long logic
    const bounceFactor = (rsi && rsi > 45) ? 1.005 : 0.999;
    entry = round(price * bounceFactor);

    const resistances = strongLevels.filter(l => l.price > entry).sort((a, b) => a.price - b.price);
    const supports    = strongLevels.filter(l => l.price < entry).sort((a, b) => b.price - a.price);

    const slDefault = entry + atr * 1.5;
    let slCandidate = slDefault;
    if (resistances.length > 0) {
      const resBased = resistances[0].price + atr * 0.25;
      const dist = resBased - entry;
      if (dist >= atr * 1.0 && dist <= atr * 2.0) slCandidate = resBased;
    }
    sl = round(Math.min(slCandidate, entry * 1.05));
    sl = round(Math.max(sl, entry + atr * 0.8));

    const tpDefault = entry - atr * 2.5;
    let tpCandidate = tpDefault;
    if (supports.length > 0) {
      const supBased = supports[0].price + atr * 0.15;
      const dist = entry - supBased;
      if (dist >= atr * 1.5 && dist <= atr * 4.0) tpCandidate = supBased;
    }
    tp = round(Math.max(tpCandidate, entry * 0.90));
  }

  const risk   = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk <= 0) return null;
  const rrRatio = Math.round((reward / risk) * 10) / 10;
  if (rrRatio < 2.0) return null;                   // Asymmetric R:R required
  if (rrRatio > 10.0) return null;                  // Unrealistic — bad data

  // ── Confidence score 0–100 ──────────────────────────────────────────
  let confidence = 50;
  confidence += confirming * 6;                     // each confirming signal +6
  confidence -= opposing * 8;                       // each opposing signal -8
  if (rrRatio >= 3)    confidence += 8;
  if (rrRatio >= 2.5)  confidence += 4;
  if (probability === 'HIGH') confidence += 10;
  // Trend alignment bonus
  if (direction === 'LONG' && sma20 && sma50 && price > sma20 && sma20 > sma50)  confidence += 6;
  if (direction === 'SHORT' && sma20 && sma50 && price < sma20 && sma20 < sma50) confidence += 6;
  confidence = Math.max(30, Math.min(99, Math.round(confidence)));

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

  return {
    direction, entry, entryLow, entryHigh,
    tp, sl, rrRatio, probability, confirming, confidence,
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
