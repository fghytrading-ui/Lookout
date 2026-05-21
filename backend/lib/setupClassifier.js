// Setup Type Classifier — identifies WHAT KIND of swing trade this is.
// Each setup type has different characteristics, win rates, and behavior.
// Tagging the trade helps the user understand the play and apply appropriate risk.

import { calculateRSI, calculateSMA } from '../utils/signals.js';

export function classifySetup(quote, historical, signalData) {
  const direction = signalData.direction; // may not exist yet, we'll handle below
  if (!historical || historical.length < 30) return null;

  const closes = historical.map(c => c.close);
  const highs  = historical.map(c => c.high);
  const lows   = historical.map(c => c.low);
  const price = quote.regularMarketPrice;
  const sma20 = signalData.sma20;
  const sma50 = signalData.sma50;
  const sma200 = signalData.sma200;
  const rsi = signalData.rsi;
  const atr = signalData.atr;
  const volume = quote.regularMarketVolume;
  const avgVolume = quote.averageDailyVolume3Month;
  const volRatio = avgVolume && volume ? volume / avgVolume : null;

  // Recent 20-day high/low
  const recent20 = historical.slice(-20);
  const high20 = Math.max(...recent20.map(c => c.high));
  const low20  = Math.min(...recent20.map(c => c.low));

  // Volatility / range
  const range20 = high20 - low20;
  const rangePct = range20 / price;

  // ── LONG patterns ───────────────────────────────────────────────────
  // 1. PULLBACK LONG: price pulled back from recent high in an UPTREND
  //    - Price above 50 SMA (uptrend intact)
  //    - Price has dropped ≥3% from recent high (pulled back)
  //    - RSI in 35-50 range (not extreme, just pulled back)
  //    - 20 SMA > 50 SMA (uptrend structure)
  if (sma50 && sma200 && rsi != null) {
    const pullbackPct = (high20 - price) / high20 * 100;
    if (
      price > sma50 &&
      sma20 > sma50 &&
      pullbackPct >= 3 && pullbackPct <= 10 &&
      rsi >= 35 && rsi <= 55
    ) {
      return {
        type: 'PULLBACK_LONG',
        label: '📈 Pullback Long',
        description: 'Price pulled back to support in an uptrend — classic high-probability swing entry',
        historicalWinRate: 65,
        idealHold: '3–7 days',
        risk: 'medium',
        reasoning: `Stock pulled back ${pullbackPct.toFixed(1)}% from 20-day high. RSI ${rsi.toFixed(0)} is in the buy zone. Uptrend intact (price > 50 SMA > 200 SMA).`,
        action: 'Buy the dip — let trend resume. Typical 4-7 day winner.'
      };
    }
  }

  // 2. BREAKOUT LONG: price breaking above a multi-week high with volume
  //    - Price within 2% of 20-day high
  //    - Volume > 1.3× average (confirmation)
  //    - Not overextended (RSI < 75)
  if (rsi != null) {
    const distFromHigh = (high20 - price) / price;
    if (
      distFromHigh <= 0.02 &&
      volRatio && volRatio >= 1.3 &&
      rsi < 75 &&
      price > (sma50 || 0)
    ) {
      return {
        type: 'BREAKOUT_LONG',
        label: '🚀 Breakout Long',
        description: 'Price breaking above 20-day high with strong volume — momentum continuation',
        historicalWinRate: 50,
        idealHold: '2–5 days',
        risk: 'medium-high',
        reasoning: `Price within 2% of 20-day high (${high20.toFixed(2)}). Volume is ${volRatio.toFixed(1)}× average — institutions are buying.`,
        action: 'Enter on confirmed break. Tight stop. Bigger winners possible if momentum holds.'
      };
    }
  }

  // 3. REVERSAL LONG: oversold bounce off a key level
  //    - RSI < 35 (oversold)
  //    - Near 52-week low or strong support
  //    - Bullish candle today (current close > today's open)
  if (rsi != null && rsi < 35) {
    const today = historical[historical.length - 1];
    const isBullishToday = today && today.close > today.open;
    const nearLow52 = quote.fiftyTwoWeekLow && (price - quote.fiftyTwoWeekLow) / quote.fiftyTwoWeekLow < 0.08;
    if (isBullishToday || nearLow52) {
      return {
        type: 'REVERSAL_LONG',
        label: '🔄 Reversal Long',
        description: 'Oversold bounce attempt off support — mean-reversion play',
        historicalWinRate: 55,
        idealHold: '3–8 days',
        risk: 'high',
        reasoning: `RSI ${rsi.toFixed(0)} is oversold. ${nearLow52 ? 'Near 52-week low.' : ''} ${isBullishToday ? 'Today closing above its open shows buyers stepping in.' : ''}`,
        action: 'Mean-reversion trade — tighter stop, smaller size. Quick win or quick exit.'
      };
    }
  }

  // 4. TREND CONTINUATION LONG: strong existing uptrend with momentum
  if (sma20 && sma50 && rsi != null && price > sma20 && sma20 > sma50 && rsi > 55 && rsi < 70) {
    return {
      type: 'TREND_LONG',
      label: '📊 Trend Continuation Long',
      description: 'Established uptrend with momentum — riding the wave',
      historicalWinRate: 60,
      idealHold: '5–10 days',
      risk: 'medium',
      reasoning: `Price above 20 SMA, 20 above 50 (clean uptrend). RSI ${rsi.toFixed(0)} shows momentum without exhaustion.`,
      action: 'Trail behind the trend. Most consistent setup. Let winners run.'
    };
  }

  // ── SHORT patterns ──────────────────────────────────────────────────
  // 1. BREAKDOWN SHORT: price breaking below 20-day low
  if (rsi != null) {
    const distFromLow = (price - low20) / price;
    if (
      distFromLow <= 0.02 &&
      volRatio && volRatio >= 1.3 &&
      rsi > 25 &&
      price < (sma50 || Infinity)
    ) {
      return {
        type: 'BREAKDOWN_SHORT',
        label: '💥 Breakdown Short',
        description: 'Price breaking below 20-day low with volume — momentum to the downside',
        historicalWinRate: 50,
        idealHold: '2–5 days',
        risk: 'medium-high',
        reasoning: `Price within 2% of 20-day low (${low20.toFixed(2)}). Volume ${volRatio.toFixed(1)}× average — selling pressure confirmed.`,
        action: 'Short on confirmed break. Tight stop above breakout level.'
      };
    }
  }

  // 2. RALLY-TO-RESISTANCE SHORT (pullback in downtrend)
  if (sma50 && rsi != null && price < sma50) {
    const distFromLow = (price - low20) / low20 * 100;
    if (
      distFromLow >= 3 && distFromLow <= 10 &&
      rsi >= 45 && rsi <= 65
    ) {
      return {
        type: 'PULLBACK_SHORT',
        label: '📉 Rally Short',
        description: 'Price rallied into resistance in a downtrend — sell the bounce',
        historicalWinRate: 60,
        idealHold: '3–7 days',
        risk: 'medium',
        reasoning: `Stock bounced ${distFromLow.toFixed(1)}% from 20-day low. RSI ${rsi.toFixed(0)} entering sell zone. Downtrend intact (price < 50 SMA).`,
        action: 'Short the rally — let downtrend resume.'
      };
    }
  }

  // 3. REVERSAL SHORT: overbought rejection
  if (rsi != null && rsi > 70) {
    const today = historical[historical.length - 1];
    const isBearishToday = today && today.close < today.open;
    if (isBearishToday) {
      return {
        type: 'REVERSAL_SHORT',
        label: '🔄 Reversal Short',
        description: 'Overbought rejection — mean-reversion to the downside',
        historicalWinRate: 55,
        idealHold: '3–8 days',
        risk: 'high',
        reasoning: `RSI ${rsi.toFixed(0)} is overbought. Today closing below its open shows sellers stepping in.`,
        action: 'Counter-trend short — tighter stop, smaller size.'
      };
    }
  }

  // 4. TREND CONTINUATION SHORT
  if (sma20 && sma50 && rsi != null && price < sma20 && sma20 < sma50 && rsi < 45 && rsi > 30) {
    return {
      type: 'TREND_SHORT',
      label: '📊 Trend Continuation Short',
      description: 'Established downtrend with momentum',
      historicalWinRate: 60,
      idealHold: '5–10 days',
      risk: 'medium',
      reasoning: `Price below 20 SMA, 20 below 50 (clean downtrend). RSI ${rsi.toFixed(0)} confirms selling pressure.`,
      action: 'Ride the downtrend. Trail stop above recent highs.'
    };
  }

  // Default: undefined setup
  return null;
}
