import { Router } from 'express';
import { fetchFull, fetchWeekly, fetchExtendedHours } from '../lib/yahoo.js';
import { withLiveBar } from '../lib/liveBar.js';
import { enrichTicker } from '../lib/news.js';
import { fetchNextEarnings, evaluateEarningsRisk } from '../lib/earnings.js';
import { backtestSetup } from '../lib/backtest.js';
import { fetchRecommendationTrend } from '../lib/finnhubData.js';
import { getTrendsFromCandles, scoreTimeframeAlignment } from '../lib/multiTimeframe.js';
import { fetchIntradayCandles } from '../lib/intradayCandles.js';
import { fetchDailyBars, ALPACA_ENABLED } from '../lib/alpaca.js';
import { classifySetup } from '../lib/setupClassifier.js';
import { computeTradeGrade } from '../lib/tradeGrade.js';
import { getPerformanceMetrics } from '../lib/performanceMetrics.js';
import { ukTimeForET, volumeVsExpected, raisedAfterClose, stockEntryWindow } from '../utils/market.js';
import { getLearnedParams } from '../lib/learning.js';
import { getMarketRegime, shortAllowed, hourlyRefinement, stockEntryStatus } from '../lib/boardSetup.js';
import { getSetupTypeStats, sessionRecord } from '../lib/signalLog.js';
import { assessSetupExpectancy } from '../lib/evidence.js';
import { marketPause } from '../lib/marketPause.js';
import { analyzeSignals, generateTradeSetup, calculateSMA, calculateMACD, TIME_SPANS, getTimespanKey, getExitWindow } from '../utils/signals.js';
import { reviewTrade } from '../utils/reviewer.js';
import { fetchCryptoCandles, computeSessionVWAP } from '../lib/cryptoCandles.js';
import { getCryptoContext, tickerToBinanceSymbol } from '../lib/cryptoContext.js';
import { enrichCryptoTicker } from '../lib/news.js';

// Crypto names + categories from scanner watchlist
const CRYPTO_MAP = {
  'BTC-USD': 'Bitcoin', 'ETH-USD': 'Ethereum', 'SOL-USD': 'Solana',
  'XRP-USD': 'Ripple', 'BNB-USD': 'Binance Coin', 'ADA-USD': 'Cardano',
  'DOGE-USD': 'Dogecoin', 'AVAX-USD': 'Avalanche', 'MATIC-USD': 'Polygon',
  'DOT-USD': 'Polkadot', 'LINK-USD': 'Chainlink', 'ATOM-USD': 'Cosmos',
  'UNI-USD': 'Uniswap', 'LTC-USD': 'Litecoin', 'BCH-USD': 'Bitcoin Cash',
  'ARB-USD': 'Arbitrum', 'OP-USD': 'Optimism', 'NEAR-USD': 'NEAR Protocol',
  'APT-USD': 'Aptos', 'INJ-USD': 'Injective', 'SHIB-USD': 'Shiba Inu',
  'PEPE-USD': 'Pepe', 'TRX-USD': 'TRON', 'TON11419-USD': 'Toncoin'
};
const isCryptoTicker = (t) => !!CRYPTO_MAP[t];

// BTC trend computed from BTC-USD daily candles
async function getBTCTrendForAnalyst() {
  try {
    const btc = await fetchFull('BTC-USD', '3mo');
    const closes = btc.candles.map(c => c.close);
    const price = btc.quote.price;
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    if (!sma20 || !sma50) return 'NEUTRAL';
    if (price > sma20 && sma20 > sma50) return 'BULLISH';
    if (price < sma20 && sma20 < sma50) return 'BEARISH';
    return 'NEUTRAL';
  } catch { return 'NEUTRAL'; }
}

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
// The exit plan, and the warning signs worth watching.
//
// This used to list six "exit if ANY of these happen" rules — a close under
// the 50-day, a MACD cross, two days of thin volume, three red days, and "exit
// at break-even" after five days. Only the stop is part of the plan the cards
// are graded on, the breakeven exit was tested on the record and did worse,
// and stock trades expire before five days anyway. Exiting on an untested rule
// turns a measured plan into an unmeasured one, so the plan is stated first
// and the rest are shown as what they are.
function generateInvalidationTriggers(setup, signalData, levels, { horizonText = '5 days' } = {}) {
  if (!setup) return [];
  const isLong = setup.direction === 'LONG';
  const triggers = [
    { severity: 'hard', text: `Price hits $${setup.sl?.toFixed(2)} (your stop loss) — exit immediately, no questions asked` },
    { severity: 'target', text: `Price reaches $${setup.tp?.toFixed(2)} — close the whole position. There is one exit, at the target` },
    { severity: 'time', text: `Neither level hit ${horizonText} after the card — the trade has expired; close at market` }
  ];
  const watch = (text) => triggers.push({ severity: 'watch', text: `${text} — a warning sign, not tested as an exit rule` });
  if (signalData.sma50 && isLong && setup.sl < signalData.sma50) watch(`Daily close below the 50-day average ($${signalData.sma50.toFixed(2)})`);
  watch(`MACD ${isLong ? 'crosses bearish (signal above the MACD line)' : 'crosses bullish (MACD above the signal line)'}`);
  watch(isLong ? 'Three red closes in a row while the market is green' : 'Three green closes in a row while the market is red');
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

  return { score, label: checklistLabel(score), components, note: CHECKLIST_NOTE };
}

// What the score is. It was labelled "HIGH RELIABILITY" down to "UNRELIABLE —
// DO NOT TRADE" and set the position size, but replayed on 325 tracked stock
// cards under the current entry rules none of its parts predicted the result:
// weekly trend z=0.45, news sentiment z=0.33, volume z=-0.35, today's move
// z=0.68, VIX z=0.00, reviewer z=-0.05, analyst ratings z=0.51, signal count
// z=0.17, and the total z=0.81. It describes the setup; it does not forecast it.
const CHECKLIST_NOTE = 'Tested on 325 tracked stock cards: neither this score nor any of its checks predicted '
                     + 'results (all within chance). It describes the setup; it is not a forecast.';
function checklistLabel(score) {
  return score >= 80 ? 'MOST CHECKS AGREE'
       : score >= 65 ? 'MORE AGREE THAN NOT'
       : score >= 50 ? 'MIXED'
       : 'MOST CHECKS DISAGREE';
}

// ── INDEPENDENT CORROBORATION ─────────────────────────────────────────
// The analyst already gathered a backtest of this pattern, Wall Street price
// targets, and multi-timeframe trend alignment — and then formed its verdict
// without looking at any of them. Because the SETUP itself comes from the same
// engine the dashboard uses, that made agreement with the dashboard structural
// rather than earned: same code, same data, same answer.
//
// These three are genuinely independent of that engine. Backtest is this
// pattern's own history on this instrument, Wall Street is outside human
// analysts, and timeframe alignment is measured on bars the setup logic never
// looks at. They are scored here as a modifier so the analyst can DISAGREE
// with a technically clean setup when the outside evidence does not support
// it — and when it agrees, it agrees for a reason.
//
// Deliberately a modifier rather than more points in the reliability score:
// the score measures setup quality, this measures whether anything outside the
// setup backs it up. Absent evidence is neutral, never a penalty.
export function assessCorroboration({ setup, backtest, wallStreet, analystRatings, mtfAlignment, price }) {
  if (!setup) return null;
  const isLong = setup.direction === 'LONG';
  const items = [];
  let adj = 0;

  // 1. This pattern's own record on this instrument (-10 .. +8)
  // Scored on what the comparable sessions RETURNED, under this trade's own
  // geometry and the single exit at the target — the same measure the scanner
  // and the goal tracker use, so the two pages can be compared.
  if (backtest && backtest.expectancy != null && backtest.sampleSize >= 5) {
    const e = backtest.expectancy;
    const pts = e >= 0.30 ? 8 : e >= 0.10 ? 4 : e >= -0.10 ? 0 : e >= -0.30 ? -4 : -10;
    adj += pts;
    items.push({ name: 'Historical backtest',
      verdict: pts > 0 ? 'pass' : pts === 0 ? 'partial' : 'fail',
      text: `${backtest.sampleSize} comparable sessions on this instrument returned ${e >= 0 ? '+' : ''}${e.toFixed(2)}R on average · ${backtest.greenRate}% finished green`,
      points: pts });
  } else {
    items.push({ name: 'Historical backtest', verdict: 'partial',
      text: 'Not enough similar setups to judge — no weight applied', points: 0 });
  }

  // 2. Outside analysts (-8 .. +7).
  //
  // Yahoo's quoteSummary endpoint, which supplied price targets, now answers
  // 429 for everything — so wallStreet is null on every ticker and that input
  // was silently dead. Finnhub's recommendation trend is live and is the real
  // source of outside human opinion here.
  if (analystRatings?.total >= 5) {
    const bull = analystRatings.bullPct ?? 0;
    const bear = analystRatings.bearPct ?? 0;
    const agrees = isLong ? bull >= 60 : bear >= 40;
    const conflicts = isLong ? bull <= 30 : bull >= 70;
    const pts = agrees ? 7 : conflicts ? -8 : 0;
    adj += pts;
    items.push({ name: 'Analyst consensus',
      verdict: agrees ? 'pass' : conflicts ? 'fail' : 'partial',
      text: `${bull}% buy / ${bear}% sell across ${analystRatings.total} analysts (${analystRatings.consensus})`
          + (conflicts ? ' — points the other way' : agrees ? ' — agrees with this direction' : ' — no clear lean'),
      points: pts });
  } else {
    items.push({ name: 'Analyst consensus', verdict: 'partial',
      text: 'No analyst coverage for this instrument — no weight applied', points: 0 });
  }

  // 3. Trend agreement across 4h/daily/weekly/monthly (-10 .. +8)
  if (mtfAlignment && typeof mtfAlignment.aligned === 'number') {
    const { aligned, opposing, total } = mtfAlignment;
    // Scored on the share of timeframes that could be judged, since the
    // intraday read is not always available and a missing one should not
    // count against the trade.
    const share = total ? aligned / total : 0;
    const against = total ? opposing / total : 0;
    const pts = share === 1 ? 8 : share >= 0.66 ? 5 : against >= 0.66 ? -10 : against >= 0.5 ? -5 : 0;
    adj += pts;
    items.push({ name: 'Multi-timeframe trend',
      verdict: pts > 0 ? 'pass' : pts === 0 ? 'partial' : 'fail',
      text: aligned === 0 && opposing === 0
        ? 'All four timeframes are neutral — no directional signal either way'
        : `${aligned}/4 timeframes agree with ${setup.direction}`
          + (opposing ? `, ${opposing} against` : '') + ` — ${mtfAlignment.label}`,
      points: pts });
  }

  const counted = items.filter(i => i.points !== 0).length;
  const verdict = adj >= 10 ? 'CORROBORATED'
                : adj >= 3  ? 'PARTIALLY CORROBORATED'
                : adj > -5  ? 'UNCORROBORATED'
                             : 'CONTRADICTED';
  return {
    adjustment: adj,
    verdict,
    counted,
    items,
    summary: counted === 0
      ? 'No independent evidence available — verdict rests on the technical setup alone'
      : verdict === 'CONTRADICTED'
        ? 'Independent sources point against this setup'
        : verdict === 'CORROBORATED'
          ? 'Independent sources back this setup'
          : verdict === 'PARTIALLY CORROBORATED'
            ? 'Some independent support'
            : 'Independent sources neither back nor contradict this setup'
  };
}

// ── BEST PLAY — the trade in one instruction ─────────────────────────
// It used to say "BUY between X and Y" (the limit entry stocks dropped on
// 2026-10-05), "same session — exit by the close" (trades run several sessions
// to one target), quote the target's distance from a different, generic
// projection, and size from the checklist score ("full position" at 75+),
// which predicts nothing. It now says what the board says.
function generateBestPlay({ setup, review, weeklyTrend, price, verdict, targets, earnings, vix, entryPlan, paused, boardNote, blocked }) {
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

  if (paused) {
    return { headline: '⏸ PAUSED ON THE BOARD',
             action: `${paused.reason}${setup ? ' The levels below are for information, not a trade.' : ''}`,
             timeframe: paused.progress };
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
  if (verdict === 'AVOID') {
    return { headline: '🚫 AVOID', action: blocked || review?.summary || 'The reviewer rejected this setup.', timeframe: 'Wait for a fresh setup' };
  }
  if (boardNote) return { headline: '⏸ NOT ON THE BOARD', action: boardNote, timeframe: 'Re-check next session' };
  if (entryPlan?.type === 'missed') return { headline: '⏭ MISSED', action: entryPlan.text, timeframe: 'Wait for a fresh setup' };

  const isLong = setup.direction === 'LONG';
  const from = (x) => {
    const pct = (x - price) / price * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% from here`;
  };
  const how = entryPlan?.type === 'sessionClose' ? 'near the next close'
            : entryPlan?.type === 'limit' ? 'on a limit' : 'at market';
  return {
    headline: `${isLong ? '📈' : '📉'} ${verdict} — ${how}`,
    action: `${isLong ? 'BUY' : 'SHORT'}: ${entryPlan?.text || 'enter at market'}. Target $${setup.tp?.toFixed(2)} (${from(setup.tp)}). `
          + `Stop $${setup.sl?.toFixed(2)} (${from(setup.sl)}).`,
    timeframe: setup.expectedDays
      ? `Close the whole position at the target — usually within ~${setup.expectedDays} session${setup.expectedDays === 1 ? '' : 's'}`
      : 'Close the whole position at the target',
    sizing: 'Your normal risk per trade. Nothing on this page has been shown to pick bigger winners, so size every trade the same.'
  };
}

// ── THE VERDICT ──────────────────────────────────────────────────────
// This used to grade the setup STRONG BUY to WAIT on the checklist score and
// the outside-opinion modifier, with thresholds from the old 2:1 targets
// (STRONG needed R:R 2.2 against today's ~1.25). None of those inputs has
// predicted a result on the tracked record (see CHECKLIST_NOTE), so the grade
// was noise with a confident label, and it could disagree with the board on
// the same stock. It now says what the board would do and why: the same
// trade, the same entry rule, the setup type's own track record, and every
// reason the board would hold it back. The context panels stay below it.
function deriveVerdict(setup, review, weeklyTrend, { entryPlan = null, paused = null, boardNote = null,
                                                    blocked = null, trackRecord = null, corroboration = null } = {}) {
  // A paused market is paused whatever this one chart looks like.
  if (paused) {
    return { action: 'PAUSED', tone: 'neutral',
             detail: `${paused.reason} ${paused.progress}${setup ? '' : ' No setup on this chart right now either.'}` };
  }
  if (!setup) {
    if (weeklyTrend === 'UP')   return { action: 'HOLD',  tone: 'neutral', detail: 'No setup. Weekly trend up — wait for clean pullback before considering.' };
    if (weeklyTrend === 'DOWN') return { action: 'AVOID', tone: 'bearish', detail: 'No setup. Weekly trend down — avoid long exposure.' };
    return { action: 'WAIT', tone: 'neutral', detail: 'No clear setup. Sit in cash until clarity emerges.' };
  }
  if (review.verdict === 'REJECT') return { action: 'AVOID', tone: 'bearish', detail: review.summary };
  if (blocked) return { action: 'AVOID', tone: 'bearish', detail: blocked };
  if (boardNote) return { action: 'WAIT', tone: 'neutral', detail: boardNote };
  if (entryPlan?.type === 'missed') return { action: 'MISSED', tone: 'neutral', detail: entryPlan.text };

  const long = setup.direction === 'LONG';
  // When to enter is shown once, in its own live box (crypto, with no window,
  // keeps it here).
  const parts = ['The same trade the board offers', entryPlan?.window ? null : entryPlan?.text];
  if (trackRecord) parts.push(trackRecord.text);
  if (corroboration?.verdict === 'CONTRADICTED') {
    parts.push('Outside sources lean the other way (below) — on the tracked record they have not predicted results');
  }
  return {
    action: long ? 'BUY' : 'SELL',
    tone: long ? 'bullish' : 'bearish',
    detail: parts.filter(Boolean).join('. ') + '.'
  };
}

// The board's record for this setup type, and whether the board holds the
// type back as a proven loser — the same test, the same window.
function boardEvidence(setupType, market) {
  const label = setupType?.label;
  const hist = label ? getSetupTypeStats(label, { market, lookbackDays: 90, minSamples: 8 }) : null;
  if (!hist) return { trackRecord: null, blocked: null };
  const evidence = assessSetupExpectancy({ trades: hist.trades || [] });
  const exp = hist.expectancy;
  const trackRecord = {
    label, sampleSize: hist.sampleSize, greenRate: hist.greenRate, expectancy: exp,
    text: `On the board, ${label} has ended in profit ${Math.round((hist.greenRate || 0) * 100)}% of the time over `
        + `${hist.sampleSize} tracked trades${exp != null ? ` (${exp >= 0 ? '+' : ''}${exp.toFixed(2)}R per trade)` : ''}`
  };
  const blocked = evidence.proven
    ? `The board holds ${label} back: its tracked record is proven to lose (${exp.toFixed(2)}R per trade over ${hist.sampleSize}).`
    : null;
  return { trackRecord, blocked };
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

  // ── CRYPTO BRANCH ─────────────────────────────────────────────────────
  // Crypto tickers use Binance 4h klines, crypto news, crypto context,
  // and the 'crypto' tradeStyle calibration. Skips earnings + wallStreet +
  // sector + weeklyTrend which don't apply.
  if (isCryptoTicker(ticker)) {
    try {
      const coinName = CRYPTO_MAP[ticker];
      const [full, candles4h, news, btcTrend, cryptoContext] = await Promise.all([
        fetchFull(ticker, '3mo'),                              // for live quote + 52w high/low
        fetchCryptoCandles(ticker, { interval: '4h', limit: 200 }),
        enrichCryptoTicker(coinName),
        getBTCTrendForAnalyst(),
        getCryptoContext().catch(() => null)
      ]);

      const candles = candles4h && candles4h.length >= 30 ? candles4h : full.candles;
      if (!candles || candles.length < 30) {
        return res.status(404).json({ error: `Insufficient data for ${ticker}` });
      }

      const raw = full.quote;
      const quote = adaptQuote(raw);
      const signalData = analyzeSignals(quote, candles, null);
      const learnedC = getLearnedParams('crypto');
      const setup = generateTradeSetup(quote, candles, signalData,
        { market: 'crypto', tradeStyle: 'crypto', targetR: learnedC.targetR, maxStopPct: learnedC.maxStopPct });
      const paused = marketPause('crypto');
      // Crypto keeps its limit entry and the 10-hour time stop, as on its cards.
      const entryPlan = setup ? { type: 'limit',
        text: `Limit order between $${setup.entryLow?.toFixed(2)} and $${setup.entryHigh?.toFixed(2)}; close it if it has `
            + 'not gone a fifth of the way to target 10 hours after it fills' } : null;
      const vwap = computeSessionVWAP(candles);
      const fundingRate = cryptoContext?.funding?.rates?.[tickerToBinanceSymbol(ticker)] ?? null;

      const card = {
        ticker, name: coinName, direction: setup?.direction,
        price: raw.price, changePercent: raw.changePercent,
        rsi: signalData.rsi, atr: signalData.atr,
        news: news.news, sentiment: news.sentiment,
        earnings: null,
        fiftyTwoWeekHigh: raw.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: raw.fiftyTwoWeekLow,
        // Against the pace normal by this point in the session — crypto never
        // being partway through one. Raw against a full day, this read every
        // instrument as thin in the morning.
        volRatio: volumeVsExpected(raw.volume, raw.averageDailyVolume3Month,
          undefined, { alwaysOpen: true }),
        vwap
      };
      const review = setup ? reviewTrade(card, candles, signalData, {
        market: 'crypto',
        btcTrend,
        fearGreed: cryptoContext?.fearGreed?.value || null,
        cryptoSession: cryptoContext?.session || null,
        funding: fundingRate
      }) : { verdict: 'NO_SETUP', summary: 'No setup found', issues: [], strengths: [] };

      const atrSafe = signalData.atr || raw.price * 0.02;
      const targets = priceTargets(raw.price, atrSafe, signalData.sma200, raw.fiftyTwoWeekHigh, raw.fiftyTwoWeekLow, candles);
      const forecast = buildForecastCone(raw.price, atrSafe, signalData.sma20, candles);
      const reliability = computeReliability({
        setup, signalData, review,
        weeklyTrend: 'NEUTRAL',
        sentiment: news.sentiment, news: news.news,
        vix: null, volRatio: card.volRatio,
        changePercent: raw.changePercent,
        earnings: null
      });
      // Crypto has no Wall Street coverage and no equity backtest here, so
      // multi-timeframe agreement is the independent input available.
      const cryptoCorroboration = assessCorroboration({
        setup, backtest: null, wallStreet: null,
        mtfAlignment: null, price: raw.price
      });
      const setupType = setup ? classifySetup(quote, candles, { ...signalData, direction: setup.direction }) : null;
      const { trackRecord, blocked } = boardEvidence(setupType, 'crypto');
      const verdict = deriveVerdict(setup, review, 'NEUTRAL',
        { entryPlan, paused, blocked, trackRecord, corroboration: cryptoCorroboration });
      const bestPlay = generateBestPlay({
        setup, review, weeklyTrend: 'NEUTRAL',
        price: raw.price, verdict: verdict.action, targets,
        earnings: null, vix: null, entryPlan, paused, blocked
      });
      const keyLevels = findKeyLevels(candles, raw.price, atrSafe);
      const bullsBears = generateBullsBearsCase(signalData, card, 'NEUTRAL', keyLevels);
      const invalidation = setup ? generateInvalidationTriggers(setup, signalData, keyLevels, { horizonText: '48 hours' }) : [];

      return res.json({
        market: 'crypto',
        ticker, name: coinName,
        exchange: 'CRYPTO',
        price: raw.price, change: raw.change, changePercent: raw.changePercent,
        dayHigh: raw.dayHigh, dayLow: raw.dayLow,
        fiftyTwoWeekHigh: raw.fiftyTwoWeekHigh, fiftyTwoWeekLow: raw.fiftyTwoWeekLow,
        volume: raw.volume, avgVolume: raw.averageDailyVolume3Month, volRatio: card.volRatio,
        verdict: verdict.action, verdictTone: verdict.tone, verdictDetail: verdict.detail,
        bestPlay, reliability, forecast, keyLevels, bullsBears, invalidation,
        sectorContext: null, backtest: null, wallStreet: null,
        mtfTrends: null, mtfAlignment: null, performance: null,
        tradeGrade: (() => { const g = computeTradeGrade({ setup, review, reliability, mtfAlignment: null, backtest: null, weeklyTrend: 'NEUTRAL', sentiment: news.sentiment });
                             return g ? { ...g, note: 'Built from the checklist — not shown to predict results' } : null; })(),
        setupType, entryPlan, trackRecord, paused,
        // Crypto-specific extras
        cryptoContext: { btcTrend, fearGreed: cryptoContext?.fearGreed || null, session: cryptoContext?.session || null, btcDominance: cryptoContext?.global?.btcDominance || null, funding: fundingRate, fundingTier: cryptoContext?.funding?.tier || null },
        vwap,
        vix: null,
        targets,
        setup: setup ? {
          direction: setup.direction, entryLow: setup.entryLow, entryHigh: setup.entryHigh, entry: setup.entry,
          tp: setup.tp, tp2: setup.tp2, sl: setup.sl,
          rrRatio: setup.rrRatio, rrRatio2: setup.rrRatio2,
          probability: setup.probability, confidence: setup.confidence,
          confirming: setup.confirming, signals: setup.signals,
          expectedDays: setup.expectedDays, expectedDays2: setup.expectedDays2,
          expectedHours: setup.expectedHours, expectedHours2: setup.expectedHours2,
          trendStrength: setup.trendStrength, trendStrengthLabel: setup.trendStrengthLabel,
          // As the crypto cards say it.
          timeSpan: 'Short-term — 1 to 3 sessions (12–60h)',
          exitWindow: 'Close the whole position at the target — within the next 1–3 active sessions'
        } : null,
        review, weeklyTrend: null,
        news: news.news, sentiment: news.sentiment, earnings: null,
        technicals: {
          rsi: signalData.rsi ? Math.round(signalData.rsi) : null,
          atr: signalData.atr ? r2(signalData.atr) : null,
          sma20: signalData.sma20 ? r2(signalData.sma20) : null,
          sma50: signalData.sma50 ? r2(signalData.sma50) : null,
          sma200: signalData.sma200 ? r2(signalData.sma200) : null,
          macd: signalData.macd ? {
            line: r2(signalData.macd.macd || 0), signal: r2(signalData.macd.signal || 0),
            histogram: r2(signalData.macd.histogram || 0),
            bullishCross: !!signalData.macd.bullishCross, bearishCross: !!signalData.macd.bearishCross
          } : null
        },
        sparkline: candles.slice(-30).map(c => c.close),
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('Crypto analyst error:', err);
      return res.status(500).json({ error: `Analyst failed for ${ticker}`, details: err.message });
    }
  }

  // ── STOCK / FOREX / COMMODITY BRANCH (existing logic, unchanged) ──────
  try {
    // Parallel fetch of all data sources
    const [full, weeklyTrend, news, earningsRaw, vix, wallStreet, fullForBacktest, analystConsensus, extendedHours, hourlyCandles, marketRegime, alpacaDaily] = await Promise.all([
      fetchFull(ticker, '3mo'),
      getWeeklyTrend(ticker),
      enrichTicker(ticker),
      fetchNextEarnings(ticker),
      getVIX(),
      // Yahoo's quoteSummary is gone — it answers 429 for every ticker without
      // an authenticated crumb — so this returned null on every request and the
      // "Wall Street" panel it fed never once rendered. The live source for
      // outside opinion is Finnhub's recommendation trend, fetched below, and
      // the panel is built from that instead.
      Promise.resolve(null),
      // Two years for the analogue search. Six months leaves roughly 65
      // testable bars once the indicator warm-up and the forward horizon are
      // taken out, which produced samples of one or two — too thin to weigh.
      fetchFull(ticker, '2y'),
      // Real analyst ratings — same feed the scanner uses, so both pages agree
      fetchRecommendationTrend(ticker).catch(() => null),
      // Pre/post-market action. The scanner has always spliced this into its
      // indicators; the analyst did not, so the same stock read differently on
      // the two pages — SMCI showed -1.98% pre-market on the board while the
      // analyst was still working from the previous close.
      fetchExtendedHours(ticker).catch(() => null),
      // Hourly bars for the 4h trend read. Through the shared cached client
      // the scanner already warms, so this is usually free — and on a 24-48h
      // hold the 4h trend is the most relevant of the four timeframes, which
      // is exactly the one that was missing.
      fetchIntradayCandles(ticker, { interval: '60m', range: '3mo' }).catch(() => null),
      // The board reads every stock against the market's last few sessions;
      // without it the same stock could come out in a different direction here.
      getMarketRegime(),
      // The board builds its setups on 200 days of Alpaca bars where it has
      // them; three months of Yahoo cannot even form a 200-day average, which
      // was enough to give SNOW a setup on the board and none here.
      ALPACA_ENABLED ? fetchDailyBars(ticker, { days: 200 }).catch(() => null) : Promise.resolve(null)
    ]);

    if (!full.candles || full.candles.length < 30) {
      return res.status(404).json({ error: `Insufficient historical data for ${ticker}` });
    }

    const raw = full.quote;
    // Indicators read the forming bar, not just completed sessions, so RSI,
    // MACD and ATR reflect where the stock is trading now — including before
    // the open. This is the same treatment the scanner gives every card.
    const candles = withLiveBar(full.candles, raw, extendedHours);
    const quote = adaptQuote(raw);
    // The setup the board would build for this stock: same market regime,
    // same learned stop ceiling and target, same hourly refinement, same rule
    // on shorts (lib/boardSetup.js). This page used to build its own, so the
    // same name could show different levels here and on the board.
    const setupSeries = alpacaDaily?.length >= full.candles.length ? alpacaDaily : full.candles;
    const setupCandles = withLiveBar(setupSeries, raw, extendedHours);
    const signalData = analyzeSignals(quote, setupCandles, marketRegime);
    const learned = getLearnedParams('stocks');
    let setup = generateTradeSetup(quote, setupCandles, signalData,
      { market: 'stocks', tradeStyle: 'sameDay', targetR: learned.targetR, maxStopPct: learned.maxStopPct });
    let boardNote = null;
    if (setup?.direction === 'SHORT' && !shortAllowed({ changePercent: raw.changePercent, price: raw.price, signalData, marketRegime }).allowed) {
      boardNote = 'The board would not offer this short: the market is not risk-off and the stock is not breaking down '
                + 'on its own (down 1.5–3% today under its 20 and 50-day averages).';
    }
    if (setup) {
      const h = hourlyRefinement(quote, hourlyCandles, {
        direction: setup.direction, market: 'stocks', marketRegime, dailyAtr: signalData.atr, maxStopPct: learned.maxStopPct
      });
      if (h) {
        setup = { ...setup,
          entry: h.entry, entryLow: h.entryLow, entryHigh: h.entryHigh, tp: h.tp, tp2: h.tp2, tp0: h.tp0, sl: h.sl,
          rrRatio: h.rrRatio, rrRatio2: h.rrRatio2, expectedDays: h.expectedDays, expectedDays2: h.expectedDays2,
          expectedHours: h.expectedHours, expectedHours2: h.expectedHours2, confirmation: h.confirmation,
          timingSource: 'hourly' };
      }
    }
    // How to enter, exactly as the board's card would say it.
    let entryPlan = null;
    if (setup) {
      const closeEntry = raisedAfterClose()
        || sessionRecord(ticker, setup.direction, 'stocks')?.entryType === 'sessionClose';
      const st = stockEntryStatus({ direction: setup.direction, price: raw.price, sl: setup.sl, tp: setup.tp,
                                    closeEntry, dayHigh: raw.dayHigh, dayLow: raw.dayLow });
      // The same window the board's card carries, so the page can count down to it.
      const window = stockEntryWindow({ closeEntry });
      entryPlan = st.entryStatus === 'MISSED' ? { type: 'missed', text: st.entryStatusText, window, touchedToday: st.touchedToday }
        : st.entryStatus === 'WAIT_CLOSE'
          ? { type: 'sessionClose', window, text: `Raised after the close — enter in the last 30 minutes of the session `
              + `(from ${ukTimeForET(new Date(), 15, 30)}), not at the open. Skip it if the stop or target trades first` }
          : { type: closeEntry ? 'sessionClose' : 'market', window, text: st.entryStatusText };
    }

    // Build a synthetic card so reviewer can score it
    const card = {
      ticker, name: raw.longName, direction: setup?.direction,
      price: raw.price, changePercent: raw.changePercent,
      rsi: signalData.rsi, atr: signalData.atr,
      news: news.news, sentiment: news.sentiment,
      earnings: evaluateEarningsRisk(earningsRaw),
      fiftyTwoWeekHigh: raw.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: raw.fiftyTwoWeekLow,
      volRatio: volumeVsExpected(raw.volume, raw.averageDailyVolume3Month)
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

    // Verdict is derived further down, once the independent evidence
    // (backtest, Wall Street, multi-timeframe) has been gathered — it used to
    // be decided here, before any of it existed.

    // Support/resistance, bulls/bears, invalidation triggers, sector context
    const keyLevels = findKeyLevels(candles, raw.price, atrSafe);
    const bullsBears = generateBullsBearsCase(signalData, card, weeklyTrend, keyLevels);
    const invalidation = setup ? generateInvalidationTriggers(setup, signalData, keyLevels, { horizonText: '5 days' }) : [];
    const sectorContext = await getSectorContext(ticker, fetchFull);

    // Backtest: run only if we have a setup direction
    // Six years of daily bars from Alpaca where available, against Yahoo's
    // two. The analogue search compares today's reading to every past session
    // that resembled it, so its whole worth is how many comparable sessions it
    // has to draw on — two years left it reporting samples of one or two on
    // instruments whose current state is at all unusual. Daily bars are the
    // safe kind from that feed: measured at 0.03% to 0.16% against Yahoo,
    // unlike the hourly ones, whose ranges are a quarter off.
    let backtestCandles = fullForBacktest?.candles;
    if (ALPACA_ENABLED) {
      try {
        const deep = await fetchDailyBars(ticker, { days: 1500 });
        if (deep && deep.length > (backtestCandles?.length || 0)) backtestCandles = deep;
      } catch { /* Yahoo's two years stand */ }
    }

    // Test the trade actually being proposed — its own stop and target
    // distances and its own horizon — rather than a generic ATR template.
    const backtest = setup
      ? backtestSetup(backtestCandles, setup.direction, {
          stopDist:    Math.abs(setup.entry - setup.sl),
          targetDist:  Math.abs(setup.tp - setup.entry),
          horizonBars: Math.max(2, Math.min(8, Math.round(setup.expectedDays || 3)))
        })
      : null;

    // Classify setup type
    const setupType = setup ? classifySetup(quote, setupCandles, { ...signalData, direction: setup.direction }) : null;

    // Multi-timeframe alignment (4h / daily / weekly / monthly)
    let mtfTrends = null, mtfAlignment = null;
    try {
      // Derived from the two-year daily series already fetched for the
      // backtest — no extra requests, and nothing left to be rate-limited.
      mtfTrends = getTrendsFromCandles(backtestCandles || full.candles, hourlyCandles);
      if (setup) mtfAlignment = scoreTimeframeAlignment(mtfTrends, setup.direction);
    } catch {}

    // Performance metrics — YTD/MTD/WTD + beta
    let performance = null;
    try { performance = await getPerformanceMetrics(ticker, candles); } catch {}

    // ── Independent corroboration, then the verdict ────────────────────
    // Everything above this point that is NOT the signal engine — the
    // pattern's own backtest, outside analyst targets, and trend agreement
    // across timeframes — is weighed here and allowed to move the call.
    const corroboration = assessCorroboration({
      setup, backtest, wallStreet, analystRatings: analystConsensus,
      mtfAlignment, price: raw.price
    });
    if (corroboration && setup) {
      reliability.score = Math.max(0, Math.min(100, reliability.score + corroboration.adjustment));
      reliability.components = [...(reliability.components || []), ...corroboration.items.map(i => ({
        name: i.name, verdict: i.verdict, text: i.text, points: i.points, max: 8, independent: true
      }))];
      reliability.label = checklistLabel(reliability.score);
    }

    const { trackRecord, blocked } = boardEvidence(setupType, 'stocks');
    const verdict = deriveVerdict(setup, review, weeklyTrend, { entryPlan, boardNote, blocked, trackRecord, corroboration });

    const bestPlay = generateBestPlay({
      setup, review, weeklyTrend,
      price: raw.price, verdict: verdict.action, targets,
      earnings: card.earnings, vix, entryPlan, boardNote, blocked
    });

    // Trade quality grade (synthesis of everything)
    const tradeGrade = computeTradeGrade({
      setup, review, reliability, mtfAlignment, backtest,
      weeklyTrend, sentiment: news.sentiment
    });

    res.json({
      corroboration,
      ticker,
      name: raw.longName,
      exchange: raw.exchangeName,
      price: raw.price,
      change: raw.change,
      changePercent: raw.changePercent,
      // This was raw.dayHigh. The forming bar carries the session's real open.
      open: candles[candles.length - 1]?.open ?? null, dayHigh: raw.dayHigh, dayLow: raw.dayLow,
      // raw.preMarketPrice is always null — the daily chart meta does not carry
      // it, which is why fetchExtendedHours exists. Report the real thing.
      preMarketPrice: extendedHours?.session === 'pre' ? extendedHours.price : null,
      extendedHours: extendedHours ? {
        ...extendedHours,
        direction: extendedHours.movePct > 0 ? 'up' : 'down',
        magnitude: Math.abs(extendedHours.movePct) >= 3 ? 'large'
                 : Math.abs(extendedHours.movePct) >= 1.5 ? 'moderate' : 'small'
      } : null,
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
      // Rebuilt from the feed that actually answers. Price targets are not
      // available on the free Finnhub tier, so the panel shows the rating
      // breakdown and omits targets rather than rendering empty ones.
      wallStreet: analystConsensus?.total >= 1 ? {
        analystCount: analystConsensus.total,
        recommendationLabel: analystConsensus.consensus === 'BULLISH' ? 'BUY'
                           : analystConsensus.consensus === 'BEARISH' ? 'SELL' : 'HOLD',
        strongBuy: analystConsensus.strongBuy, buy: analystConsensus.buy,
        hold: analystConsensus.hold, sell: analystConsensus.sell,
        strongSell: analystConsensus.strongSell,
        bullPct: analystConsensus.bullPct, bearPct: analystConsensus.bearPct,
        period: analystConsensus.period, shift: analystConsensus.shift,
        targetLow: null, targetMean: null, targetHigh: null,
        source: 'Finnhub'
      } : null,
      mtfTrends,
      mtfAlignment,
      performance,
      tradeGrade: tradeGrade ? { ...tradeGrade, note: 'Built from the checklist — not shown to predict results' } : null,
      setupType,
      entryPlan,
      trackRecord,
      boardNote,
      marketRegime,

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
        timingSource: setup.timingSource || 'daily',
        // The board's wording: one exit, at the target, on the setup's own estimate.
        timeSpan: setup.expectedDays != null
          ? `Short-term — about ${setup.expectedDays} session${setup.expectedDays === 1 ? '' : 's'}`
          : TIME_SPANS[getTimespanKey(setup.atr, raw.price)].label,
        exitWindow: setup.expectedDays != null
          ? `Close the whole position at the target — usually within ~${setup.expectedDays} session${setup.expectedDays === 1 ? '' : 's'}`
          : getExitWindow(getTimespanKey(setup.atr, raw.price))
      } : null,

      review,
      analystConsensus,
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
