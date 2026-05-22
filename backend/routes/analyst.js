import { Router } from 'express';
import { fetchFull, fetchWeekly } from '../lib/yahoo.js';
import { enrichTicker } from '../lib/news.js';
import { fetchNextEarnings, evaluateEarningsRisk } from '../lib/earnings.js';
import { backtestSetup } from '../lib/backtest.js';
import { fetchWallStreetConsensus } from '../lib/wallStreet.js';
import { getMultiTimeframeTrends, scoreTimeframeAlignment } from '../lib/multiTimeframe.js';
import { classifySetup } from '../lib/setupClassifier.js';
import { computeTradeGrade } from '../lib/tradeGrade.js';
import { getPerformanceMetrics } from '../lib/performanceMetrics.js';
import { analyzeSignals, generateTradeSetup, calculateSMA, calculateMACD, TIME_SPANS, getTimespanKey, getExitWindow } from '../utils/signals.js';
import { reviewTrade } from '../utils/reviewer.js';

const router = Router();

// Determine weekly trend (same logic as scanner)
async function getWeeklyTrend(ticker) {
  try {
    const candles = await fetchWeekly(ticker);
    if (candles.length < 21) return 'NEUTRAL';
    const closes = candles.map(c => c.close);
    const price = closes[closes.length - 1];
    const sma20w = calculateSMA(closes, 20);
    if (!sma20w) return 'NEUTRAL';
    const earlier = calculateSMA(closes.slice(0, -4), 20);
    if (!earlier) return 'NEUTRAL';
    const rising = sma20w > earlier;
    if (price > sma20w && rising) return 'UP';
    if (price < sma20w && !rising) return 'DOWN';
    return 'NEUTRAL';
  } catch { return 'NEUTRAL'; }
}

// Round to 2 decimals
const r2 = (n) => Math.round(n * 100) / 100;

// ── KEY SUPPORT / RESISTANCE LEVELS ──────────────────────────────────────
// Finds horizontal price levels where the market has reacted multiple times.
// Uses swing-point detection: a high is "key" if it's the highest in its 5-bar window.
function findKeyLevels(candles, currentPrice, atr) {
  if (!candles || candles.length < 30) return { supports: [], resistances: [] };

  const recent = candles.slice(-60); // last ~3 months
  const swings = [];

  // Detect pivot highs and lows (5-bar fractal)
  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i];
    const isHigh = c.high > recent[i-1].high && c.high > recent[i-2].high &&
                   c.high > recent[i+1].high && c.high > recent[i+2].high;
    const isLow  = c.low  < recent[i-1].low  && c.low  < recent[i-2].low  &&
                   c.low  < recent[i+1].low  && c.low  < recent[i+2].low;
    if (isHigh) swings.push({ price: c.high, type: 'high', date: c.date });
    if (isLow)  swings.push({ price: c.low,  type: 'low',  date: c.date });
  }

  // Cluster swings that are within 1 ATR of each other (= same level)
  const clusterTol = atr * 0.7;
  const clustered = [];
  for (const sw of swings) {
    const existing = clustered.find(cl => Math.abs(cl.price - sw.price) <= clusterTol);
    if (existing) {
      existing.hits++;
      existing.price = (existing.price * (existing.hits - 1) + sw.price) / existing.hits; // average
      existing.lastDate = sw.date;
    } else {
      clustered.push({ price: sw.price, type: sw.type, hits: 1, lastDate: sw.date });
    }
  }

  // Separate into supports (below current price) and resistances (above)
  const supports = clustered
    .filter(c => c.price < currentPrice)
    .map(c => ({
      price: r2(c.price),
      hits: c.hits,
      distance: r2(currentPrice - c.price),
      distancePct: r2(((currentPrice - c.price) / currentPrice) * 100),
      lastTouched: c.lastDate,
      strength: c.hits >= 3 ? 'strong' : c.hits === 2 ? 'medium' : 'weak'
    }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 4);

  const resistances = clustered
    .filter(c => c.price > currentPrice)
    .map(c => ({
      price: r2(c.price),
      hits: c.hits,
      distance: r2(c.price - currentPrice),
      distancePct: r2(((c.price - currentPrice) / currentPrice) * 100),
      lastTouched: c.lastDate,
      strength: c.hits >= 3 ? 'strong' : c.hits === 2 ? 'medium' : 'weak'
    }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 4);

  return { supports, resistances };
}

// ── BULLS CASE vs BEARS CASE ─────────────────────────────────────────────
// Forces honest both-sides analysis.
function generateBullsBearsCase(signalData, card, weeklyTrend, levels) {
  const bullPoints = [];
  const bearPoints = [];

  // Technical signals
  signalData.signals.forEach(s => {
    if (s.type === 'bullish') bullPoints.push(`${s.text}`);
    if (s.type === 'bearish') bearPoints.push(`${s.text}`);
  });

  // Weekly trend
  if (weeklyTrend === 'UP')   bullPoints.push('Weekly trend is up — longer-term tailwind');
  if (weeklyTrend === 'DOWN') bearPoints.push('Weekly trend is down — longer-term headwind');

  // News sentiment
  if (card.sentiment?.total >= 2) {
    if (card.sentiment.score >= 60) bullPoints.push(`News sentiment ${card.sentiment.score}% bullish`);
    if (card.sentiment.score <= 40) bearPoints.push(`News sentiment ${card.sentiment.score}% bearish`);
  }

  // Volume
  if (card.volRatio >= 1.5) bullPoints.push(`Strong volume ${card.volRatio.toFixed(1)}× average — institutional buying`);
  if (card.volRatio != null && card.volRatio < 0.6) bearPoints.push(`Weak volume ${card.volRatio.toFixed(1)}× average — no conviction`);

  // 52-week proximity
  const proxHigh = (card.fiftyTwoWeekHigh - card.price) / card.fiftyTwoWeekHigh;
  const proxLow  = (card.price - card.fiftyTwoWeekLow) / card.fiftyTwoWeekLow;
  if (proxHigh < 0.05) bearPoints.push(`Within 5% of 52-week high — strong resistance overhead`);
  if (proxLow < 0.05)  bullPoints.push(`Near 52-week low — strong support, mean-reversion candidate`);

  // Levels
  if (levels.supports?.length) {
    const closestSupport = levels.supports[0];
    if (closestSupport.distancePct < 2) bullPoints.push(`Strong support just ${closestSupport.distancePct}% below at $${closestSupport.price}`);
  }
  if (levels.resistances?.length) {
    const closestResistance = levels.resistances[0];
    if (closestResistance.distancePct < 2) bearPoints.push(`Resistance just ${closestResistance.distancePct}% above at $${closestResistance.price}`);
  }

  // Earnings
  if (card.earnings?.status === 'BLOCK') bearPoints.push(`Earnings in ${card.earnings.daysAway} days — binary event risk`);

  return { bullPoints, bearPoints };
}

// ── INVALIDATION TRIGGERS ────────────────────────────────────────────────
// Explicit rules: if any of these happen, the trade is invalidated.
function generateInvalidationTriggers(setup, signalData, levels) {
  if (!setup) return [];

  const triggers = [];
  const isLong = setup.direction === 'LONG';

  // Hard stop
  triggers.push({
    severity: 'hard',
    text: `Price hits $${setup.sl?.toFixed(2)} (your stop loss) — exit immediately, no questions asked`
  });

  // Below/above SMA50
  if (signalData.sma50) {
    if (isLong && setup.sl < signalData.sma50) {
      triggers.push({
        severity: 'hard',
        text: `Daily close below 50 SMA ($${signalData.sma50.toFixed(2)}) — trend has shifted`
      });
    }
  }

  // MACD reversal
  triggers.push({
    severity: 'medium',
    text: `MACD ${isLong ? 'crosses bearish (signal > MACD line)' : 'crosses bullish (MACD > signal line)'} — momentum has flipped`
  });

  // Volume drop
  triggers.push({
    severity: 'medium',
    text: `Daily volume drops below 70% of 3-month average for 2 consecutive days — conviction gone`
  });

  // Time stop
  triggers.push({
    severity: 'soft',
    text: `Trade hasn't moved 1× ATR in your favour after 5 trading days — exit at break-even, reassess`
  });

  // Reverse momentum
  if (isLong) {
    triggers.push({
      severity: 'medium',
      text: `Stock closes red 3 days in a row while broader market is green — relative weakness, exit`
    });
  } else {
    triggers.push({
      severity: 'medium',
      text: `Stock closes green 3 days in a row while broader market is red — relative strength, cover`
    });
  }

  return triggers;
}

// ── SECTOR CONTEXT (relative strength vs sector ETF) ─────────────────────
const SECTOR_ETF_MAP = {
  'AAPL':'XLK','MSFT':'XLK','NVDA':'XLK','META':'XLC','GOOGL':'XLC','AMZN':'XLY','TSLA':'XLY',
  'AMD':'XLK','INTC':'XLK','QCOM':'XLK','MU':'XLK','SMCI':'XLK','ARM':'XLK','AVGO':'XLK',
  'JPM':'XLF','GS':'XLF','BAC':'XLF','MS':'XLF','WFC':'XLF','C':'XLF','V':'XLF','MA':'XLF',
  'XOM':'XLE','CVX':'XLE','OXY':'XLE','HAL':'XLE','SLB':'XLE','EOG':'XLE',
  'LLY':'XLV','UNH':'XLV','JNJ':'XLV','MRK':'XLV','PFE':'XLV','ABBV':'XLV','MRNA':'XLV',
  'WMT':'XLP','COST':'XLP','NKE':'XLY','SBUX':'XLY','MCD':'XLY','DIS':'XLY','NFLX':'XLC',
  'BA':'XLI','CAT':'XLI','GE':'XLI','RTX':'XLI','LMT':'XLI','DE':'XLI',
  'MSTR':'XLK','COIN':'XLF','PLTR':'XLK','RKLB':'XLI','HOOD':'XLF','SOFI':'XLF'
};

async function getSectorContext(ticker, fetchFullFn) {
  const sector = SECTOR_ETF_MAP[ticker];
  if (!sector) return null;
  try {
    const [stockData, sectorData] = await Promise.all([
      fetchFullFn(ticker, '1mo'),
      fetchFullFn(sector, '1mo')
    ]);
    if (!stockData?.candles?.length || !sectorData?.candles?.length) return null;
    const stockCandles  = stockData.candles;
    const sectorCandles = sectorData.candles;

    // Compute today's change and 5-day return for both
    const stock5Ago   = stockCandles[stockCandles.length - 6]?.close;
    const sector5Ago  = sectorCandles[sectorCandles.length - 6]?.close;
    const stockNow    = stockData.quote.price;
    const sectorNow   = sectorData.quote.price;
    const stockDay    = stockData.quote.changePercent;
    const sectorDay   = sectorData.quote.changePercent;
    const stock5d     = stock5Ago  ? ((stockNow - stock5Ago) / stock5Ago) * 100 : 0;
    const sector5d    = sector5Ago ? ((sectorNow - sector5Ago) / sector5Ago) * 100 : 0;

    const dayDiff = stockDay - sectorDay;
    const fiveDayDiff = stock5d - sector5d;

    let verdict, text;
    if (fiveDayDiff > 2) {
      verdict = 'leader';
      text = `Outperforming ${sector} by ${fiveDayDiff.toFixed(1)}% over 5 days — sector leader`;
    } else if (fiveDayDiff < -2) {
      verdict = 'laggard';
      text = `Underperforming ${sector} by ${Math.abs(fiveDayDiff).toFixed(1)}% over 5 days — sector laggard`;
    } else {
      verdict = 'neutral';
      text = `In line with ${sector} (${fiveDayDiff >= 0 ? '+' : ''}${fiveDayDiff.toFixed(1)}% over 5d)`;
    }

    return {
      sectorETF: sector,
      sectorDay: r2(sectorDay),
      stockDay: r2(stockDay),
      sectorReturn5d: r2(sector5d),
      stockReturn5d: r2(stock5d),
      relativeStrength5d: r2(fiveDayDiff),
      verdict, text
    };
  } catch {
    return null;
  }
}

// ── 5-DAY FORECAST CONE ─────────────────────────────────────────────────
// Combines multiple realistic projection methods:
//   1. SMA20 slope continuation (trend extrapolation)
//   2. Recent average daily change (momentum)
//   3. ATR-based daily range (volatility envelope)
// Returns day-by-day low/expected/high prices
function buildForecastCone(price, atr, sma20, candles) {
  if (!candles || candles.length < 21) return null;

  // SMA20 slope: change per day over last 20 days
  const recent20 = candles.slice(-20);
  const sma20Now = recent20.reduce((s, c) => s + c.close, 0) / 20;
  const sma20Old = candles.slice(-25, -5).reduce((s, c) => s + c.close, 0) / 20;
  const trendPerDay = (sma20Now - sma20Old) / 20;

  // Average absolute daily change in the last 10 days (momentum strength)
  const recent10 = candles.slice(-10);
  let avgAbsChange = 0;
  for (let i = 1; i < recent10.length; i++) {
    avgAbsChange += Math.abs(recent10[i].close - recent10[i - 1].close);
  }
  avgAbsChange /= (recent10.length - 1);

  // Intraday cone — hourly projections within the session (6.5 hours)
  // ATR per hour ≈ ATR / √6.5 ≈ 0.39 × daily ATR
  const hourlyATR = atr / Math.sqrt(6.5);
  const hourlyTrend = trendPerDay / 6.5;
  const slots = [
    { label: '+1 hour', h: 1 },
    { label: '+2 hours', h: 2 },
    { label: '+3 hours', h: 3 },
    { label: '+4 hours', h: 4 },
    { label: 'By close (+6h)', h: 6 }
  ];
  return slots.map(({ label, h }) => {
    const trendProjection = price + hourlyTrend * h;
    const widening = hourlyATR * Math.sqrt(h);
    return {
      label, day: null, hour: h,
      expected: r2(trendProjection),
      low: r2(trendProjection - widening),
      high: r2(trendProjection + widening),
      pctExpected: r2((trendProjection - price) / price * 100),
      pctHigh: r2((trendProjection + widening - price) / price * 100),
      pctLow: r2((trendProjection - widening - price) / price * 100)
    };
  });
}

// ── RELIABILITY SCORE (0–100) ───────────────────────────────────────────
// Cross-validates the trade across independent sources.
// Each component adds points only if it CONFIRMS the same direction.
function computeReliability({ setup, signalData, review, weeklyTrend, sentiment, news, vix, volRatio, changePercent, earnings }) {
  const components = [];
  let score = 0;

  // No setup at all = automatic 0
  if (!setup) {
    return {
      score: 0,
      label: 'No actionable setup',
      components: [{ name: 'Trade setup', verdict: 'fail', text: 'No swing setup found at this price', points: 0, max: 100 }]
    };
  }

  const isLong = setup.direction === 'LONG';

  // 1. Technical confluence (0–25 pts) — how many signals align with direction
  const bullish = signalData.signals.filter(s => s.type === 'bullish').length;
  const bearish = signalData.signals.filter(s => s.type === 'bearish').length;
  const aligned = isLong ? bullish : bearish;
  const opposing = isLong ? bearish : bullish;
  const techPts = Math.max(0, Math.min(25, (aligned - opposing) * 4));
  score += techPts;
  components.push({
    name: 'Technical confluence',
    verdict: techPts >= 18 ? 'pass' : techPts >= 10 ? 'partial' : 'fail',
    text: `${aligned} signals aligned, ${opposing} against`,
    points: techPts, max: 25
  });

  // 2. Weekly trend alignment (0–15 pts)
  let wtPts = 0;
  let wtText = `Weekly trend: ${weeklyTrend}`;
  if ((isLong && weeklyTrend === 'UP') || (!isLong && weeklyTrend === 'DOWN')) {
    wtPts = 15; wtText += ' — confirms direction';
  } else if (weeklyTrend === 'NEUTRAL') {
    wtPts = 7; wtText += ' — neither confirms nor conflicts';
  } else {
    wtPts = 0; wtText += ' — conflicts with trade direction';
  }
  score += wtPts;
  components.push({
    name: 'Weekly trend',
    verdict: wtPts === 15 ? 'pass' : wtPts > 0 ? 'partial' : 'fail',
    text: wtText, points: wtPts, max: 15
  });

  // 3. News sentiment alignment (0–15 pts)
  let sentPts = 0;
  let sentText = 'No news sentiment available';
  if (sentiment && sentiment.total >= 2) {
    if (isLong && sentiment.score >= 60)       { sentPts = 15; sentText = `News bullish (${sentiment.score}%) — confirms long`; }
    else if (!isLong && sentiment.score <= 40) { sentPts = 15; sentText = `News bearish (${sentiment.score}%) — confirms short`; }
    else if (sentiment.score >= 40 && sentiment.score <= 60) { sentPts = 7;  sentText = `News mixed (${sentiment.score}%) — neutral`; }
    else                                       { sentPts = 0;  sentText = `News ${sentiment.label} (${sentiment.score}%) — conflicts with direction`; }
  } else {
    sentPts = 5; sentText = 'Insufficient news data — partial credit';
  }
  score += sentPts;
  components.push({
    name: 'News sentiment',
    verdict: sentPts === 15 ? 'pass' : sentPts > 0 ? 'partial' : 'fail',
    text: sentText, points: sentPts, max: 15
  });

  // 4. Volume confirmation (0–15 pts)
  let volPts = 0;
  let volText = volRatio == null ? 'Volume data unavailable' : `Volume ${volRatio.toFixed(1)}× average`;
  if (volRatio != null) {
    if (volRatio >= 1.5)      { volPts = 15; volText += ' — strong institutional participation'; }
    else if (volRatio >= 1.0) { volPts = 10; volText += ' — normal participation'; }
    else if (volRatio >= 0.7) { volPts = 5;  volText += ' — below average, weaker conviction'; }
    else                       { volPts = 0;  volText += ' — very weak, signal unreliable'; }
  } else {
    volPts = 5;
  }
  score += volPts;
  components.push({
    name: 'Volume conviction',
    verdict: volPts >= 10 ? 'pass' : volPts > 0 ? 'partial' : 'fail',
    text: volText, points: volPts, max: 15
  });

  // 5. Today's intraday confirmation (0–10 pts)
  let dayPts = 0;
  let dayText = `Today ${changePercent >= 0 ? '+' : ''}${changePercent?.toFixed(2)}%`;
  if (changePercent != null) {
    if (isLong  && changePercent > 0.5)   { dayPts = 10; dayText += ' — moving up, confirms long'; }
    else if (!isLong && changePercent < -0.5) { dayPts = 10; dayText += ' — moving down, confirms short'; }
    else if (Math.abs(changePercent) <= 0.5) { dayPts = 5;  dayText += ' — flat, no confirmation'; }
    else                                  { dayPts = 0;  dayText += ' — opposing your trade direction'; }
  }
  score += dayPts;
  components.push({
    name: 'Today\'s direction',
    verdict: dayPts === 10 ? 'pass' : dayPts > 0 ? 'partial' : 'fail',
    text: dayText, points: dayPts, max: 10
  });

  // 6. Market regime / VIX (0–10 pts)
  let vixPts = 5;
  let vixText = 'VIX not available';
  if (vix != null) {
    if (vix < 18)      { vixPts = 10; vixText = `VIX ${vix.toFixed(1)} — low volatility, trend-friendly`; }
    else if (vix < 22) { vixPts = 8;  vixText = `VIX ${vix.toFixed(1)} — normal conditions`; }
    else if (vix < 27) { vixPts = 4;  vixText = `VIX ${vix.toFixed(1)} — elevated, expect chop`; }
    else               { vixPts = 0;  vixText = `VIX ${vix.toFixed(1)} — extreme, signals unreliable`; }
  }
  score += vixPts;
  components.push({
    name: 'Market regime',
    verdict: vixPts >= 8 ? 'pass' : vixPts > 0 ? 'partial' : 'fail',
    text: vixText, points: vixPts, max: 10
  });

  // 7. Earnings risk + reviewer verdict (0–10 pts)
  let safetyPts = 0;
  let safetyText = '';
  if (earnings?.status === 'BLOCK') {
    safetyPts = 0; safetyText = `Earnings in ${earnings.daysAway} days — HIGH risk`;
  } else if (earnings?.status === 'WARN') {
    safetyPts = 4; safetyText = `Earnings in ${earnings.daysAway} days — moderate risk`;
  } else {
    safetyPts = 5; safetyText = 'No earnings risk in next 10 days';
  }
  if (review.verdict === 'PASS') { safetyPts += 5; safetyText += ' · Reviewer PASS'; }
  else if (review.verdict === 'CAUTION') { safetyPts += 2; safetyText += ' · Reviewer CAUTION'; }
  else if (review.verdict === 'REJECT')  { safetyPts = 0; safetyText = 'Reviewer REJECTED'; }
  score += safetyPts;
  components.push({
    name: 'Safety checks',
    verdict: safetyPts >= 8 ? 'pass' : safetyPts > 0 ? 'partial' : 'fail',
    text: safetyText, points: safetyPts, max: 10
  });

  // Final label
  const label = score >= 80 ? 'HIGH RELIABILITY'
              : score >= 65 ? 'MODERATE RELIABILITY'
              : score >= 50 ? 'LOW RELIABILITY'
              : 'UNRELIABLE — DO NOT TRADE';

  return { score, label, components };
}

// ── BEST PLAY synthesis — one clear actionable recommendation ─────────
function generateBestPlay({ setup, review, weeklyTrend, reliability, price, verdict, targets, earnings, vix }) {
  // Strong reject conditions first
  if (vix && vix > 30) {
    return {
      headline: '🛑 SIT THIS ONE OUT',
      action: 'VIX is extreme — even high-quality setups fail in this environment. Wait for VIX < 22.',
      timeframe: 'Re-evaluate when VIX drops below 22'
    };
  }
  if (earnings?.status === 'BLOCK') {
    return {
      headline: '🚫 AVOID — EARNINGS RISK',
      action: `Earnings in ${earnings.daysAway} days. Any signal here is overshadowed by binary event risk. Wait until after the report.`,
      timeframe: 'After earnings + 1 day'
    };
  }
  if (reliability.score < 45) {
    return {
      headline: '⏳ NO TRADE — WAIT',
      action: `Reliability ${reliability.score}/100. Too many conflicting signals. Wait for cleaner conditions.`,
      timeframe: 'Re-check in 1–2 days'
    };
  }
  if (reliability.score < 55) {
    return {
      headline: '👀 WATCH — small position only',
      action: `Reliability ${reliability.score}/100. Borderline. If you take it, size at ¼ position.`,
      timeframe: '1–3 days'
    };
  }

  if (!setup) {
    if (weeklyTrend === 'UP') {
      return {
        headline: '👀 WATCH FOR PULLBACK',
        action: `${price < (targets?.bullish?.price || 0) ? 'Weekly trend up but no clean entry now.' : ''} Wait for a 3–5% pullback to add to your watchlist.`,
        timeframe: '3–7 days'
      };
    }
    return {
      headline: '❌ NO ACTIONABLE SETUP',
      action: 'No clean swing-trade pattern at this price. Move on to higher-conviction names.',
      timeframe: 'Re-scan next week'
    };
  }

  // Setup exists — build the actionable instruction
  const dir = setup.direction;
  const isLong = dir === 'LONG';
  const targetPrice = isLong ? targets.bullish.price : targets.bearish.price;
  const targetPct = isLong ? targets.bullish.pct : targets.bearish.pct;
  const conviction = reliability.score >= 80 ? 'HIGH conviction'
                   : reliability.score >= 65 ? 'MODERATE conviction'
                   : 'LOW conviction';

  let headline;
  if (verdict === 'STRONG BUY' || verdict === 'STRONG SELL') headline = `🚀 ${verdict} — ${conviction}`;
  else if (verdict === 'BUY' || verdict === 'SELL')           headline = `✅ ${verdict} — ${conviction}`;
  else                                                          headline = `⏸ ${verdict} — ${conviction}`;

  const action = `${isLong ? 'BUY' : 'SHORT'} between $${setup.entryLow?.toFixed(2)}–$${setup.entryHigh?.toFixed(2)}. Target $${setup.tp?.toFixed(2)} (~${targetPct >= 0 ? '+' : ''}${targetPct}%). Stop at $${setup.sl?.toFixed(2)}. R:R ${setup.rrRatio}:1.`;

  return {
    headline, action,
    timeframe: 'Same session — exit by 9pm UK',
    sizing: reliability.score >= 75 ? 'Full position (1% risk)' :
            reliability.score >= 60 ? 'Half position (0.5% risk)' :
            'Quarter position (0.25% risk)'
  };
}

// INDEPENDENCE MODE — Analyst is intentionally MORE skeptical than the Dashboard.
// Defaults to HOLD/WAIT. Only flashes BUY/SELL when sources overwhelmingly agree.
function deriveVerdict(setup, review, weeklyTrend, reliability) {
  if (!setup) {
    if (weeklyTrend === 'UP')   return { action: 'HOLD',  tone: 'neutral', detail: 'No setup. Weekly trend up — wait for clean pullback before considering.' };
    if (weeklyTrend === 'DOWN') return { action: 'AVOID', tone: 'bearish', detail: 'No setup. Weekly trend down — avoid long exposure.' };
    return { action: 'WAIT', tone: 'neutral', detail: 'No clear setup. Sit in cash until clarity emerges.' };
  }
  if (review.verdict === 'REJECT') {
    return { action: 'AVOID', tone: 'bearish', detail: review.summary };
  }

  const isPass = review.verdict === 'PASS';
  const isHighProb = setup.probability === 'HIGH';
  const direction = setup.direction;
  const score = reliability?.score || 0;

  // ── BALANCED THRESHOLDS — gives BUY/SELL more readily, still safe ──
  // STRONG BUY/SELL: high confluence
  if (isPass && isHighProb && setup.rrRatio >= 2.2 && score >= 75) {
    return {
      action: direction === 'LONG' ? 'STRONG BUY' : 'STRONG SELL',
      tone: direction === 'LONG' ? 'bullish' : 'bearish',
      detail: `Reliability ${score}/100 · ${setup.confirming} signals aligned · R:R ${setup.rrRatio}:1 · cleared every stress test.`
    };
  }

  // BUY/SELL: solid confluence (≥ 60 reliability, was 75)
  if (isPass && score >= 60) {
    return {
      action: direction === 'LONG' ? 'BUY' : 'SELL',
      tone: direction === 'LONG' ? 'bullish' : 'bearish',
      detail: `Reliability ${score}/100 · sources support direction · R:R ${setup.rrRatio}:1. Take with discipline.`
    };
  }

  // BUY/SELL with caveats: CAUTION review but decent reliability
  if (review.verdict === 'CAUTION' && score >= 55 && setup.rrRatio >= 1.8) {
    return {
      action: direction === 'LONG' ? 'BUY' : 'SELL',
      tone: direction === 'LONG' ? 'bullish' : 'bearish',
      detail: `Reliability ${score}/100 with one caveat: ${review.issues[0]?.text || 'minor warning'}. Smaller size advised.`
    };
  }

  // HOLD: middling reliability
  if (score >= 45) {
    return {
      action: 'HOLD',
      tone: 'neutral',
      detail: `Reliability ${score}/100 — borderline. Wait for stronger confluence or smaller position.`
    };
  }

  return { action: 'WAIT', tone: 'neutral', detail: `Reliability ${score}/100 — too many conflicts. Wait for a cleaner setup.` };
}

// INTRADAY price targets — bullish/bearish scenarios reachable WITHIN ONE SESSION.
// Uses ~1.5 ATR (full session move) capped at ±5% (realistic intraday extreme).
function priceTargets(price, atr, sma200, fiftyTwoWeekHigh, fiftyTwoWeekLow, candles) {
  const recent5 = candles.slice(-5);
  const high5 = Math.max(...recent5.map(c => c.high));
  const low5  = Math.min(...recent5.map(c => c.low));

  // Bullish: ~1.5 ATR up, or 5-day high if closer (intraday-reachable)
  const bullCandidate = Math.min(high5 * 1.003, price + atr * 1.5);
  const bullishTarget = r2(Math.min(bullCandidate, price * 1.05));

  // Bearish: ~1.5 ATR down, or 5-day low if closer
  const bearCandidate = Math.max(low5 * 0.997, price - atr * 1.5);
  const bearishTarget = r2(Math.max(bearCandidate, price * 0.95));

  const bullReasoning = bullishTarget >= high5 * 0.997
    ? 'Test of 5-day high — recent intraday resistance'
    : 'Intraday ATR projection — typical full-session move';
  const bearReasoning = bearishTarget <= low5 * 1.003
    ? 'Test of 5-day low — recent intraday support'
    : 'Intraday ATR projection — typical full-session move';

  return {
    bullish: {
      price: bullishTarget,
      pct: r2((bullishTarget - price) / price * 100),
      timeframe: 'Same session',
      reasoning: bullReasoning
    },
    bearish: {
      price: bearishTarget,
      pct: r2((bearishTarget - price) / price * 100),
      timeframe: 'Same session',
      reasoning: bearReasoning
    },
    key52WeekHigh: fiftyTwoWeekHigh,
    key52WeekLow: fiftyTwoWeekLow
  };
}

// Adapter for analyzeSignals to expect Yahoo-shape quote
function adaptQuote(raw) {
  return {
    regularMarketPrice: raw.price,
    regularMarketChange: raw.change,
    regularMarketChangePercent: raw.changePercent,
    regularMarketVolume: raw.volume,
    averageDailyVolume3Month: raw.averageDailyVolume3Month,
    fiftyTwoWeekHigh: raw.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: raw.fiftyTwoWeekLow,
    fullExchangeName: raw.exchangeName,
    longName: raw.longName,
    marketState: raw.marketState
  };
}

// Fetch VIX as market regime indicator
async function getVIX() {
  try {
    const { quote } = await fetchFull('^VIX', '1d');
    return quote.price;
  } catch { return null; }
}

// GET /api/analyst/:ticker
router.get('/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  try {
    // Parallel fetch of all data sources
    const [full, weeklyTrend, news, earningsRaw, vix, wallStreet, fullForBacktest] = await Promise.all([
      fetchFull(ticker, '3mo'),
      getWeeklyTrend(ticker),
      enrichTicker(ticker),
      fetchNextEarnings(ticker),
      getVIX(),
      fetchWallStreetConsensus(ticker),
      fetchFull(ticker, '6mo')   // 6 months of candles for backtest
    ]);

    if (!full.candles || full.candles.length < 30) {
      return res.status(404).json({ error: `Insufficient historical data for ${ticker}` });
    }

    const raw = full.quote;
    const candles = full.candles;
    const quote = adaptQuote(raw);
    const signalData = analyzeSignals(quote, candles, null);
    const setup = generateTradeSetup(quote, candles, signalData, { tradeStyle: 'sameDay' });

    // Build a synthetic card so reviewer can score it
    const card = {
      ticker, name: raw.longName, direction: setup?.direction,
      price: raw.price, changePercent: raw.changePercent,
      rsi: signalData.rsi, atr: signalData.atr,
      news: news.news, sentiment: news.sentiment,
      earnings: evaluateEarningsRisk(earningsRaw),
      fiftyTwoWeekHigh: raw.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: raw.fiftyTwoWeekLow,
      volRatio: raw.averageDailyVolume3Month && raw.volume ? raw.volume / raw.averageDailyVolume3Month : null
    };
    const review = setup ? reviewTrade(card, candles, signalData, { weeklyTrend, vix }) : { verdict: 'NO_SETUP', summary: 'No setup found', issues: [], strengths: [] };
    const atrSafe = signalData.atr || raw.price * 0.02;
    const targets = priceTargets(raw.price, atrSafe, signalData.sma200, raw.fiftyTwoWeekHigh, raw.fiftyTwoWeekLow, candles);
    const forecast = buildForecastCone(raw.price, atrSafe, signalData.sma20, candles);

    // Compute reliability FIRST — Independence Mode verdict depends on it
    const reliability = computeReliability({
      setup, signalData, review, weeklyTrend,
      sentiment: news.sentiment, news: news.news,
      vix, volRatio: card.volRatio,
      changePercent: raw.changePercent,
      earnings: card.earnings
    });

    // Now derive verdict using reliability score (Independence Mode)
    const verdict = deriveVerdict(setup, review, weeklyTrend, reliability);

    const bestPlay = generateBestPlay({
      setup, review, weeklyTrend, reliability,
      price: raw.price, verdict: verdict.action, targets,
      earnings: card.earnings, vix
    });

    // Support/resistance, bulls/bears, invalidation triggers, sector context
    const keyLevels = findKeyLevels(candles, raw.price, atrSafe);
    const bullsBears = generateBullsBearsCase(signalData, card, weeklyTrend, keyLevels);
    const invalidation = setup ? generateInvalidationTriggers(setup, signalData, keyLevels) : [];
    const sectorContext = await getSectorContext(ticker, fetchFull);

    // Backtest: run only if we have a setup direction
    const backtest = setup ? backtestSetup(fullForBacktest.candles, setup.direction) : null;

    // Classify setup type
    const setupType = setup ? classifySetup(quote, candles, { ...signalData, direction: setup.direction }) : null;

    // Multi-timeframe alignment (4h / daily / weekly / monthly)
    let mtfTrends = null, mtfAlignment = null;
    try {
      mtfTrends = await getMultiTimeframeTrends(ticker);
      if (setup) mtfAlignment = scoreTimeframeAlignment(mtfTrends, setup.direction);
    } catch {}

    // Performance metrics — YTD/MTD/WTD + beta
    let performance = null;
    try { performance = await getPerformanceMetrics(ticker, candles); } catch {}

    // Trade quality grade (synthesis of everything)
    const tradeGrade = computeTradeGrade({
      setup, review, reliability, mtfAlignment, backtest,
      weeklyTrend, sentiment: news.sentiment
    });

    res.json({
      ticker,
      name: raw.longName,
      exchange: raw.exchangeName,
      price: raw.price,
      change: raw.change,
      changePercent: raw.changePercent,
      open: raw.dayHigh, dayHigh: raw.dayHigh, dayLow: raw.dayLow,
      preMarketPrice: raw.preMarketPrice,
      postMarketPrice: raw.postMarketPrice,
      fiftyTwoWeekHigh: raw.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: raw.fiftyTwoWeekLow,
      volume: raw.volume,
      avgVolume: raw.averageDailyVolume3Month,
      volRatio: card.volRatio,

      verdict: verdict.action,
      verdictTone: verdict.tone,
      verdictDetail: verdict.detail,

      bestPlay,
      reliability,
      forecast,
      keyLevels,
      bullsBears,
      invalidation,
      sectorContext,
      backtest,
      wallStreet,
      mtfTrends,
      mtfAlignment,
      performance,
      tradeGrade,
      setupType,

      vix,
      targets,
      setup: setup ? {
        direction: setup.direction,
        entryLow: setup.entryLow,
        entryHigh: setup.entryHigh,
        entry: setup.entry,
        tp: setup.tp,
        tp2: setup.tp2,
        sl: setup.sl,
        rrRatio: setup.rrRatio,
        rrRatio2: setup.rrRatio2,
        probability: setup.probability,
        confidence: setup.confidence,
        confirming: setup.confirming,
        signals: setup.signals,
        expectedDays: setup.expectedDays,
        expectedDays2: setup.expectedDays2,
        trendStrength: setup.trendStrength,
        trendStrengthLabel: setup.trendStrengthLabel,
        timeSpan: TIME_SPANS[getTimespanKey(setup.atr, raw.price)].label,
        exitWindow: getExitWindow(getTimespanKey(setup.atr, raw.price))
      } : null,

      review,
      weeklyTrend,
      news: news.news,
      sentiment: news.sentiment,
      earnings: card.earnings,

      technicals: {
        rsi: signalData.rsi ? Math.round(signalData.rsi) : null,
        atr: signalData.atr ? r2(signalData.atr) : null,
        sma20: signalData.sma20 ? r2(signalData.sma20) : null,
        sma50: signalData.sma50 ? r2(signalData.sma50) : null,
        sma200: signalData.sma200 ? r2(signalData.sma200) : null,
        macd: signalData.macd ? {
          line: r2(signalData.macd.macd || 0),
          signal: r2(signalData.macd.signal || 0),
          histogram: r2(signalData.macd.histogram || 0),
          bullishCross: !!signalData.macd.bullishCross,
          bearishCross: !!signalData.macd.bearishCross
        } : null
      },

      sparkline: candles.slice(-30).map(c => c.close),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Analyst error:', err);
    res.status(500).json({ error: `Analyst failed for ${ticker}`, details: err.message });
  }
});

export default router;
