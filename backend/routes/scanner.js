import { Router } from 'express';
import { fetchFullBatch, fetchFull, fetchWeekly, fetchExtendedHours } from '../lib/yahoo.js';
import { classifySetup } from '../lib/setupClassifier.js';
import { getMarketChoppiness } from '../lib/marketChoppiness.js';
import { enrichTicker, enrichCryptoTicker } from '../lib/news.js';
import { fetchNextEarnings, evaluateEarningsRisk } from '../lib/earnings.js';
import { reviewTrade } from '../utils/reviewer.js';
import { getCryptoContext, tickerToBinanceSymbol, getCryptoEntryTiming } from '../lib/cryptoContext.js';
import { fetchCryptoCandlesBatch, computeSessionVWAP } from '../lib/cryptoCandles.js';
import { getInventoryReleases, evaluateInventoryRisk } from '../lib/inventoryReleases.js';
import { logSignal, getSetupTypeStats } from '../lib/signalLog.js';
import { withLiveBar } from '../lib/liveBar.js';
import { fetchIntradayBatch } from '../lib/intradayCandles.js';
import { analyseCatalysts, catalystSignals } from '../lib/catalystEngine.js';
import { fetchRecommendationTrend } from '../lib/finnhubData.js';
import { buildThesis } from '../lib/thesis.js';
import { getUpcomingMacro, buildEventTimeline } from '../lib/upcomingEvents.js';
import { getMarketUniverse } from '../lib/marketUniverse.js';
import {
  analyzeSignals, generateTradeSetup, calculateSMA, calculateATR,
  TIME_SPANS, getTimespanKey, getExitWindow, generateAnalystNotes
} from '../utils/signals.js';
import { getEntryTiming } from '../utils/market.js';

// Determine broad market regime from SPY's trend
async function getMarketRegime() {
  try {
    const spy = await fetchFull('SPY', '6mo');
    const closes = spy.candles.map(c => c.close);
    const price  = spy.quote.price;
    const sma50  = calculateSMA(closes, 50);
    const sma200 = calculateSMA(closes, 200);
    if (sma50 && sma200) {
      if (price > sma50 && sma50 > sma200) return 'BULLISH';
      if (price < sma50 && sma50 < sma200) return 'BEARISH';
    }
    return 'NEUTRAL';
  } catch { return 'NEUTRAL'; }
}

// Fetch current VIX value for market volatility context
async function getVIX() {
  try {
    const { quote } = await fetchFull('^VIX', '1d');
    return quote.price;
  } catch { return null; }
}

// Determine BTC's medium-term trend — primary regime filter for crypto alts
async function getBTCTrend() {
  try {
    const btc = await fetchFull('BTC-USD', '3mo');
    const closes = btc.candles.map(c => c.close);
    const price  = btc.quote.price;
    const sma20  = calculateSMA(closes, 20);
    const sma50  = calculateSMA(closes, 50);
    if (!sma20 || !sma50) return 'NEUTRAL';
    if (price > sma20 && sma20 > sma50) return 'BULLISH';
    if (price < sma20 && sma20 < sma50) return 'BEARISH';
    return 'NEUTRAL';
  } catch { return 'NEUTRAL'; }
}

// Determine weekly trend for a ticker — UP / DOWN / NEUTRAL
async function getWeeklyTrend(ticker) {
  try {
    const candles = await fetchWeekly(ticker);
    if (candles.length < 21) return 'NEUTRAL';
    const closes = candles.map(c => c.close);
    const price = closes[closes.length - 1];
    const sma20w = calculateSMA(closes, 20);  // ~5 months
    if (!sma20w) return 'NEUTRAL';
    // Also check if SMA is rising or falling
    const closesEarlier = closes.slice(0, -4);
    const sma20wEarlier = calculateSMA(closesEarlier, 20);
    if (!sma20wEarlier) return 'NEUTRAL';
    const slopeUp = sma20w > sma20wEarlier;
    if (price > sma20w && slopeUp) return 'UP';
    if (price < sma20w && !slopeUp) return 'DOWN';
    return 'NEUTRAL';
  } catch { return 'NEUTRAL'; }
}

const router = Router();

// Crypto watchlist — top liquidity coins on Yahoo
const CRYPTO_WATCHLIST = [
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'BNB-USD',
  'ADA-USD', 'DOGE-USD', 'AVAX-USD', 'MATIC-USD', 'DOT-USD',
  'LINK-USD', 'ATOM-USD', 'UNI-USD', 'LTC-USD', 'BCH-USD',
  'ARB-USD', 'OP-USD', 'NEAR-USD', 'APT-USD', 'INJ-USD',
  'SHIB-USD', 'PEPE-USD', 'TRX-USD', 'TON11419-USD'
];
const CRYPTO_NAMES = {
  'BTC-USD': 'Bitcoin', 'ETH-USD': 'Ethereum', 'SOL-USD': 'Solana',
  'XRP-USD': 'Ripple', 'BNB-USD': 'Binance Coin', 'ADA-USD': 'Cardano',
  'DOGE-USD': 'Dogecoin', 'AVAX-USD': 'Avalanche', 'MATIC-USD': 'Polygon',
  'DOT-USD': 'Polkadot', 'LINK-USD': 'Chainlink', 'ATOM-USD': 'Cosmos',
  'UNI-USD': 'Uniswap', 'LTC-USD': 'Litecoin', 'BCH-USD': 'Bitcoin Cash',
  'ARB-USD': 'Arbitrum', 'OP-USD': 'Optimism', 'NEAR-USD': 'NEAR Protocol',
  'APT-USD': 'Aptos', 'INJ-USD': 'Injective', 'SHIB-USD': 'Shiba Inu',
  'PEPE-USD': 'Pepe', 'TRX-USD': 'TRON', 'TON11419-USD': 'Toncoin'
};
const CRYPTO_CATEGORIES = {
  'BTC-USD': 'Large Cap', 'ETH-USD': 'Large Cap', 'BNB-USD': 'Large Cap',
  'SOL-USD': 'Layer 1', 'ADA-USD': 'Layer 1', 'AVAX-USD': 'Layer 1',
  'DOT-USD': 'Layer 1', 'NEAR-USD': 'Layer 1', 'APT-USD': 'Layer 1', 'ATOM-USD': 'Layer 1',
  'MATIC-USD': 'Layer 2', 'ARB-USD': 'Layer 2', 'OP-USD': 'Layer 2',
  'LINK-USD': 'Oracle', 'UNI-USD': 'DeFi', 'INJ-USD': 'DeFi',
  'XRP-USD': 'Payments', 'LTC-USD': 'Payments', 'BCH-USD': 'Payments', 'TRX-USD': 'Payments',
  'DOGE-USD': 'Meme', 'SHIB-USD': 'Meme', 'PEPE-USD': 'Meme', 'TON11419-USD': 'Layer 1'
};

// Major forex pairs (Yahoo format)
const FOREX_WATCHLIST = [
  'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'USDCHF=X', 'AUDUSD=X', 'NZDUSD=X', 'USDCAD=X',
  'EURGBP=X', 'EURJPY=X', 'GBPJPY=X', 'EURCHF=X', 'AUDJPY=X', 'CADJPY=X',
  'USDCNY=X', 'USDMXN=X', 'USDZAR=X', 'USDTRY=X',
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD'
];

// Commodities & futures (Yahoo format)
const COMMODITIES_WATCHLIST = [
  // Precious metals
  'GC=F', 'SI=F', 'PL=F', 'PA=F',
  // Industrial metals
  'HG=F',
  // Energy
  'CL=F', 'BZ=F', 'NG=F', 'HO=F', 'RB=F',
  // Agriculture
  'ZC=F', 'ZS=F', 'ZW=F', 'KC=F', 'SB=F', 'CC=F', 'CT=F', 'OJ=F',
  // ETF proxies (more reliable data)
  'GLD', 'SLV', 'USO', 'UNG', 'DBA', 'GDX', 'PPLT', 'CPER'
];

// Display names for non-stock symbols
const FOREX_NAMES = {
  'EURUSD=X': 'Euro / US Dollar',
  'GBPUSD=X': 'British Pound / US Dollar',
  'USDJPY=X': 'US Dollar / Japanese Yen',
  'USDCHF=X': 'US Dollar / Swiss Franc',
  'AUDUSD=X': 'Australian Dollar / US Dollar',
  'NZDUSD=X': 'New Zealand Dollar / US Dollar',
  'USDCAD=X': 'US Dollar / Canadian Dollar',
  'EURGBP=X': 'Euro / British Pound',
  'EURJPY=X': 'Euro / Japanese Yen',
  'GBPJPY=X': 'British Pound / Japanese Yen',
  'EURCHF=X': 'Euro / Swiss Franc',
  'AUDJPY=X': 'Australian Dollar / Japanese Yen',
  'CADJPY=X': 'Canadian Dollar / Japanese Yen',
  'USDCNY=X': 'US Dollar / Chinese Yuan',
  'USDMXN=X': 'US Dollar / Mexican Peso',
  'USDZAR=X': 'US Dollar / South African Rand',
  'USDTRY=X': 'US Dollar / Turkish Lira',
  'BTC-USD': 'Bitcoin',
  'ETH-USD': 'Ethereum',
  'SOL-USD': 'Solana',
  'XRP-USD': 'Ripple'
};
const COMMODITIES_NAMES = {
  'GC=F': 'Gold Futures', 'SI=F': 'Silver Futures', 'PL=F': 'Platinum Futures', 'PA=F': 'Palladium Futures',
  'HG=F': 'Copper Futures',
  'CL=F': 'WTI Crude Oil', 'BZ=F': 'Brent Crude Oil', 'NG=F': 'Natural Gas', 'HO=F': 'Heating Oil', 'RB=F': 'RBOB Gasoline',
  'ZC=F': 'Corn Futures', 'ZS=F': 'Soybean Futures', 'ZW=F': 'Wheat Futures',
  'KC=F': 'Coffee Futures', 'SB=F': 'Sugar Futures', 'CC=F': 'Cocoa Futures', 'CT=F': 'Cotton Futures', 'OJ=F': 'Orange Juice Futures',
  'GLD': 'SPDR Gold Trust ETF', 'SLV': 'iShares Silver Trust', 'USO': 'United States Oil Fund',
  'UNG': 'United States Natural Gas Fund', 'DBA': 'Invesco DB Agriculture', 'GDX': 'VanEck Gold Miners',
  'PPLT': 'abrdn Platinum ETF', 'CPER': 'United States Copper Index'
};
const FOREX_CATEGORIES = {
  'EURUSD=X':'Major','GBPUSD=X':'Major','USDJPY=X':'Major','USDCHF=X':'Major',
  'AUDUSD=X':'Major','NZDUSD=X':'Major','USDCAD=X':'Major',
  'EURGBP=X':'Cross','EURJPY=X':'Cross','GBPJPY=X':'Cross','EURCHF=X':'Cross','AUDJPY=X':'Cross','CADJPY=X':'Cross',
  'USDCNY=X':'Emerging','USDMXN=X':'Emerging','USDZAR=X':'Emerging','USDTRY=X':'Emerging',
  'BTC-USD':'Crypto','ETH-USD':'Crypto','SOL-USD':'Crypto','XRP-USD':'Crypto'
};
const COMMODITIES_CATEGORIES = {
  'GC=F':'Precious Metal','SI=F':'Precious Metal','PL=F':'Precious Metal','PA=F':'Precious Metal',
  'HG=F':'Industrial Metal',
  'CL=F':'Energy','BZ=F':'Energy','NG=F':'Energy','HO=F':'Energy','RB=F':'Energy',
  'ZC=F':'Grain','ZS=F':'Grain','ZW=F':'Grain',
  'KC=F':'Soft','SB=F':'Soft','CC=F':'Soft','CT=F':'Soft','OJ=F':'Soft',
  'GLD':'ETF / Precious Metal','SLV':'ETF / Precious Metal','USO':'ETF / Energy',
  'UNG':'ETF / Energy','DBA':'ETF / Agriculture','GDX':'ETF / Mining',
  'PPLT':'ETF / Precious Metal','CPER':'ETF / Industrial Metal'
};

const WATCHLIST = [
  // Mega cap tech (highest liquidity, cleanest charts)
  'AAPL','MSFT','NVDA','META','GOOGL','AMZN','TSLA',
  // Semis (volatile, swing-friendly)
  'AMD','INTC','QCOM','MU','SMCI','ARM','AVGO','TSM','LRCX','AMAT','KLAC',
  // Software / cloud
  'ORCL','CRM','ADBE','NOW','SNOW','CRWD','PANW','DDOG','NET','ZS',
  // Finance
  'JPM','GS','BAC','MS','WFC','C','V','MA','BX',
  // Energy
  'XOM','CVX','OXY','HAL','SLB','EOG',
  // Healthcare
  'LLY','UNH','JNJ','MRK','PFE','ABBV','MRNA','AMGN',
  // Consumer
  'WMT','COST','NKE','SBUX','MCD','DIS','NFLX','HD','LOW',
  // Industrials
  'BA','CAT','GE','RTX','LMT','DE',
  // Crypto / fintech / momentum
  'MSTR','COIN','MARA','RIOT','HOOD','SOFI','PLTR','RKLB',
  // Index & sector ETFs
  'SPY','QQQ','IWM','DIA','XLF','XLE','XLK','XLV','XLI','XBI',
  // Commodity ETFs
  'GLD','SLV','USO','GDX',
  // Inverse hedges
  'SQQQ','SOXS'
];

const SECTOR_MAP = {
  AAPL:'Technology', MSFT:'Technology', NVDA:'Technology', META:'Comm. Services',
  GOOGL:'Comm. Services', AMZN:'Cons. Discretionary', TSLA:'Cons. Discretionary',
  AMD:'Technology', INTC:'Technology', QCOM:'Technology', MU:'Technology',
  SMCI:'Technology', ARM:'Technology', AVGO:'Technology',
  JPM:'Financials', GS:'Financials', BAC:'Financials', MS:'Financials', WFC:'Financials',
  XOM:'Energy', CVX:'Energy', OXY:'Energy', HAL:'Energy',
  LLY:'Healthcare', UNH:'Healthcare', MRNA:'Healthcare', PFE:'Healthcare', ABBV:'Healthcare',
  WMT:'Cons. Staples', COST:'Cons. Staples', NKE:'Cons. Discretionary', SBUX:'Cons. Discretionary',
  SPY:'ETF', QQQ:'ETF', IWM:'ETF',
  MSTR:'Technology', COIN:'Financials', RKLB:'Industrials', PLTR:'Technology', HOOD:'Financials',
  GLD:'ETF / Commodities', SLV:'ETF / Commodities', USO:'ETF / Energy', GDX:'ETF / Mining'
};

// Adapt raw Yahoo data to the shape analyzeSignals expects
function adaptQuote(raw) {
  return {
    regularMarketPrice:      raw.price,
    regularMarketChange:     raw.change,
    regularMarketChangePercent: raw.changePercent,
    regularMarketVolume:     raw.volume,
    averageDailyVolume3Month: raw.averageDailyVolume3Month,
    fiftyTwoWeekHigh:        raw.fiftyTwoWeekHigh,
    fiftyTwoWeekLow:         raw.fiftyTwoWeekLow,
    fullExchangeName:        raw.exchangeName,
    longName:                raw.longName,
    marketState:             raw.marketState,
    sector:                  null
  };
}

function buildCard(ticker, raw, quote, setup, signalData, historical, market = 'stocks') {
  const price = raw.price;
  const { direction, entry, entryLow, entryHigh, tp, tp0, rrRatio0, scalePlan, tp2, sl, rrRatio, rrRatio2, probability, confirming, confidence, expectedDays, expectedDays2, expectedHours, expectedHours2, trendStrength, trendStrengthLabel, confirmation, tradeStyle } = setup;
  const tpPct  = parseFloat(Math.abs((tp - entry)  / entry * 100).toFixed(1));
  const tp2Pct = tp2 != null ? parseFloat(Math.abs((tp2 - entry) / entry * 100).toFixed(1)) : null;
  const slPct  = parseFloat(Math.abs((sl - entry)  / entry * 100).toFixed(1));
  const tsKey = getTimespanKey(setup.atr, price);

  // ── Entry validity status ───────────────────────────────────────────
  // For LONG: zone is between entryLow and entryHigh; bad if price >> entryHigh
  // For SHORT: zone is between entryLow and entryHigh; bad if price << entryLow
  let entryStatus = 'IN_ZONE';
  let entryStatusText = 'Price is in the entry zone — ready to enter';
  if (direction === 'LONG') {
    if (price > entryHigh * 1.015) {
      entryStatus = 'MISSED';
      entryStatusText = `Price drifted ${((price - entryHigh) / entryHigh * 100).toFixed(1)}% above zone — wait for pullback`;
    } else if (price > entryHigh) {
      entryStatus = 'ABOVE_ZONE';
      entryStatusText = 'Just above zone — wait for small dip';
    } else if (price < entryLow * 0.985) {
      entryStatus = 'BELOW_ZONE';
      entryStatusText = `Price ${((entryLow - price) / entryLow * 100).toFixed(1)}% below zone — even better entry available`;
    }
  } else {
    if (price < entryLow * 0.985) {
      entryStatus = 'MISSED';
      entryStatusText = `Price drifted ${((entryLow - price) / entryLow * 100).toFixed(1)}% below zone — wait for bounce`;
    } else if (price < entryLow) {
      entryStatus = 'BELOW_ZONE';
      entryStatusText = 'Just below zone — wait for small bounce';
    } else if (price > entryHigh * 1.015) {
      entryStatus = 'ABOVE_ZONE';
      entryStatusText = `Price ${((price - entryHigh) / entryHigh * 100).toFixed(1)}% above zone — even better short entry available`;
    }
  }

  // ── Volume context ──────────────────────────────────────────────────
  const volRatio = raw.averageDailyVolume3Month && raw.volume
    ? raw.volume / raw.averageDailyVolume3Month
    : null;

  // Sparkline = last 20 daily closes
  const sparkline = (historical || []).slice(-20).map(c => c.close);

  // Choose name + category based on market
  const customName = market === 'forex' ? FOREX_NAMES[ticker]
                   : market === 'commodities' ? COMMODITIES_NAMES[ticker]
                   : market === 'crypto' ? CRYPTO_NAMES[ticker]
                   : null;
  const category = market === 'forex' ? FOREX_CATEGORIES[ticker]
                 : market === 'commodities' ? COMMODITIES_CATEGORIES[ticker]
                 : market === 'crypto' ? CRYPTO_CATEGORIES[ticker]
                 : SECTOR_MAP[ticker] || 'N/A';

  return {
    ticker,
    name:        customName || raw.longName || ticker,
    exchange:    raw.exchangeName || (market === 'forex' ? 'FX' : market === 'commodities' ? 'CME' : market === 'crypto' ? 'CRYPTO' : 'NYSE'),
    sector:      category,
    direction, probability, confirming, confidence,
    price, entry, entryLow, entryHigh, entryStatus, entryStatusText,
    tp, tpPct, tp2, tp2Pct,
    tp0, rrRatio0, scalePlan,
    sl, slPct,
    // Horizon labels now reflect the recalibrated targets. The old copy said
    // "same day / no overnight risk", but targets wide enough to be profitable
    // take ~1-2 sessions to reach — claiming otherwise would have had users
    // closing winners early or being surprised by an overnight hold.
    // Horizon is stated from the computed estimate rather than a fixed phrase.
    // With a 2.2% minimum stop and a 2:1 floor, targets land at 5-9% of price,
    // which genuinely takes several sessions — and the tracked data agrees:
    // trades held 24-48h won 50% while those resolving inside six hours won
    // 10%. Claiming "1 to 2 sessions" would understate the hold and push the
    // user to close winners early.
    timeSpan: tradeStyle === 'crypto' ? 'Short-term — 1 to 3 sessions (12–60h)'
            : (expectedDays != null)
              ? `Short-term — about ${expectedDays} session${expectedDays === 1 ? '' : 's'}`
            : tradeStyle === 'sameDay' ? 'Short-term — 1 to 2 sessions'
            : TIME_SPANS[tsKey].label,
    exitWindow: tradeStyle === 'crypto' ? 'Within the next 1–3 active sessions — 24/7 market'
              : (expectedDays2 != null)
                ? `Scale at target 1 within ~${expectedDays} session${expectedDays === 1 ? '' : 's'}; runner up to ~${expectedDays2}`
              : tradeStyle === 'sameDay' ? 'Typically next session; hard exit after 2 sessions'
              : getExitWindow(tsKey),
    // Intraday-specific timing windows (UK time)
    intradayTiming: tradeStyle === 'crypto' ? {
      entryFrom: '13:30 UK',
      entryUntil: '20:00 UK',
      mustExitBy: 'Within ~24h (no hard close — close on TP/SL or next peak)',
      totalSession: '24/7 (peak ~6.5h)',
      bestEntryWindow: '14:30 – 18:00 UK (NY equity open + ETF inflows + CME futures volume)',
      avoidWindow: '20:00 – 08:00 UK + all weekend (US-close drainage, Asia thin, weekend wicks)'
    } : tradeStyle === 'sameDay' ? {
      entryFrom: '2:30 PM UK',
      entryUntil: '7:00 PM UK',
      mustExitBy: 'End of next session (may hold overnight)',
      totalSession: '1–2 sessions',
      bestEntryWindow: '2:30 – 4:30 PM UK',
      avoidWindow: '7:00 – 9:00 PM UK'
    } : null,
    rrRatio, rrRatio2,
    volRatio, expectedDays, expectedDays2,
    expectedHours, expectedHours2,
    trendStrength, trendStrengthLabel,
    confirmation,
    tradeStyle,
    signals:     setup.signals,
    warnings:    setup.warnings,
    analystNotes: generateAnalystNotes(direction, ticker, setup.signals, signalData.rsi, setup.atr, price),
    rsi:         signalData.rsi ? Math.round(signalData.rsi) : null,
    changePercent: raw.changePercent,
    sparkline,
    isTopPick:   false, // set later
    hardCoverDate: null,
    timestamp:   new Date().toISOString()
  };
}

// Ranking rebuilt from tracked outcomes. The previous order sorted by
// probability tier first, then confidence, with reward-to-risk only as a
// tiebreaker — and both leading keys turned out to be inverted against
// reality: HIGH probability won 24% while MEDIUM won 39%, and signals scoring
// 85+ won 26% while those under 65 won 38%. Since this ordering also decided
// which candidates survived truncation, the system was discarding better
// setups and keeping worse ones.
//
// Reward-to-risk leads now because it is the term that actually drives
// expectancy: at a ~30% win rate, R:R is what separates a profitable trade
// from a losing one. Confidence is kept only as a tiebreaker.
function sortTrades(arr) {
  return arr.sort((a, b) => {
    const rrDiff = (b.rrRatio || 0) - (a.rrRatio || 0);
    if (Math.abs(rrDiff) > 0.15) return rrDiff;     // meaningful R:R edge wins
    return (b.confidence || 0) - (a.confidence || 0);
  });
}

router.get('/scan', async (req, res) => {
  try {
    const market = (req.query.market || 'stocks').toLowerCase();
    const watchlist = market === 'forex' ? FOREX_WATCHLIST
                    : market === 'commodities' ? COMMODITIES_WATCHLIST
                    : market === 'crypto' ? CRYPTO_WATCHLIST
                    : WATCHLIST;

    // ── SCAN UNIVERSE ───────────────────────────────────────────────
    // Stocks are scanned against a universe rebuilt from the live market each
    // session — today's most active names, biggest gainers and losers, and the
    // growth/value screens — rather than a fixed list. A hardcoded watchlist
    // guarantees the same names recur regardless of what is actually moving;
    // this way a stock appears because it is doing something today. The
    // curated list stays in as a quality floor.
    let universeMeta = null;
    let dynamicList = null;
    if (market === 'stocks' && !req.query.tickers) {
      try {
        universeMeta = await getMarketUniverse(WATCHLIST, { max: 150 });
        if (universeMeta?.tickers?.length) dynamicList = universeMeta.tickers;
      } catch { /* fall back to the curated watchlist */ }
    }

    const tickerList = req.query.tickers
      ? req.query.tickers.split(',').map(t => t.trim().toUpperCase())
      : dynamicList ? dynamicList
      // Fallback: the full curated watchlist (all 90, not a slice of it).
      : watchlist;

    const isCrypto = market === 'crypto';
    const isCommodities = market === 'commodities';
    const tradeStyle = isCrypto ? 'crypto' : 'sameDay';

    // Fetch macro context — crypto uses BTC trend + Fear&Greed, not VIX/SPY
    // Commodities adds inventory release awareness (EIA crude/NG)
    const [marketRegime, vix, choppiness, btcTrend, cryptoContext, inventoryReleases] = await Promise.all([
      isCrypto ? Promise.resolve('NEUTRAL') : getMarketRegime(),
      isCrypto ? Promise.resolve(null)      : getVIX(),
      isCrypto ? Promise.resolve(null)      : getMarketChoppiness(),
      isCrypto ? getBTCTrend()              : Promise.resolve(null),
      isCrypto ? getCryptoContext().catch(() => null) : Promise.resolve(null),
      isCommodities ? getInventoryReleases().catch(() => null) : Promise.resolve(null)
    ]);

    // Single call per ticker: quote + 3mo candles (Yahoo for everything)
    const fullMap = await fetchFullBatch(tickerList);

    // Equities move to hourly bars. Daily candles give one price per session,
    // which is enough to read trend but blind for timing an entry — and the
    // outcome data put 62% of losses inside six hours having travelled only
    // 24% toward target, the signature of a badly-timed entry rather than a
    // bad target. Hourly bars let RSI, MACD and support/resistance respond
    // within the session. Daily candles are kept for the duration estimate,
    // where hourly ATR does not scale correctly.
    const dailyAtrMap = {};

    // For crypto: replace daily Yahoo candles with intraday 4h Binance klines.
    // Quote (price/52w/avgVol) stays from Yahoo — works fine.
    // Candles drive ATR/RSI/MACD/SMA which now operate at 4h resolution.
    let cryptoCandlesMap = {};
    if (isCrypto) {
      cryptoCandlesMap = await fetchCryptoCandlesBatch(tickerList, { interval: '4h', limit: 200 });
      for (const t of tickerList) {
        const c = cryptoCandlesMap[t];
        if (c && c.length >= 30 && fullMap[t]) {
          fullMap[t].candles = c;
        }
      }
    }

    // Extended-hours prices for the live bar. Fetched only outside regular
    // trading hours — during the session the regular quote is already current,
    // and this costs one extra request per ticker.
    const extMap = {};
    if (!isCrypto) {
      const { getSession } = await import('../utils/market.js');
      const sess = getSession();
      if (sess === 'PRE_MARKET' || sess === 'AFTER_HOURS') {
        const chunk = 6;
        for (let i = 0; i < tickerList.length; i += chunk) {
          const slice = tickerList.slice(i, i + chunk);
          const got = await Promise.allSettled(slice.map(t => fetchExtendedHours(t)));
          slice.forEach((t, j) => {
            if (got[j].status === 'fulfilled' && got[j].value) extMap[t] = got[j].value;
          });
        }
      }
    }

    // Scheduled events landing inside the trade window. Fetched once and
    // shared across every card — a setup can look perfect and still be a bad
    // trade because CPI drops in six hours.
    const upcomingMacro = await getUpcomingMacro({ windowHours: 48 }).catch(() => []);

    // MACRO BLACKOUT — a top-tier release inside six hours. Stops and position
    // sizing mean little through a CPI or FOMC print: price gaps straight
    // through the level. New entries are barred until it clears, while the
    // candidates remain visible so the user can prepare rather than face an
    // unexplained empty board.
    const blackoutEvent = (upcomingMacro || [])
      .filter(e => e.impact >= 9 && e.hoursUntil <= 6 && e.hoursUntil > -1)
      .sort((a, b) => b.impact - a.impact)[0] || null;
    const macroBlackout = blackoutEvent ? {
      event: blackoutEvent.label,
      when: blackoutEvent.when,
      hoursUntil: blackoutEvent.hoursUntil,
      message: `${blackoutEvent.label} ${blackoutEvent.when} — no new entries until it clears. Price gaps through stops on these releases.`
    } : null;

    const trades = { enterNow: [], waitForBounce: [], carryForward: [] };

    for (const ticker of tickerList) {
      const entry = fullMap[ticker];
      if (!entry || entry.error) continue;

      const raw = entry.quote;
      if (!raw.price || entry.candles.length < 30) continue;  // Need 30+ for 200 SMA

      // Indicators previously ran on completed daily bars only, so during a
      // live session (and all through pre/post market) they ignored everything
      // price had done since yesterday's close. Splicing the forming bar in
      // makes RSI/MACD/ATR/SMA reflect current action. Crypto already has
      // genuine intraday candles and is left alone.
      const historical = isCrypto ? entry.candles : withLiveBar(entry.candles, raw, extMap[ticker]);

      const quote = adaptQuote(raw);
      const signalData = analyzeSignals(quote, historical, marketRegime);

      // Extended-hours data is fetched per-card in the enrichment pass below
      // (it needs a separate intraday request, so it is limited to the cards
      // that actually survive filtering rather than the whole watchlist).
      const setup      = generateTradeSetup(quote, historical, signalData, { market, tradeStyle });
      if (!setup) continue;

      // ── SHORTS REQUIRE A BEARISH MARKET ─────────────────────────────
      // Across 164 resolved signals, longs won 31% while shorts won 15% —
      // and every short category was negative: Trend Continuation Short went
      // 0 for 22, Rally Short 1 for 8. The pattern is consistent with
      // shorting into a market that keeps rising, where a falling stock is
      // usually a pullback inside an uptrend rather than the start of a
      // decline. Shorts are now only generated when the broad market is
      // genuinely bearish, which is the regime where they historically work.
      //
      // Crypto is exempt: it has its own BTC-trend gate, and crypto shorts
      // have actually been the better side there.
      if (setup.direction === 'SHORT' && !isCrypto && marketRegime !== 'BEARISH') {
        continue;
      }

      // Regime filter is now a confidence-boost signal (added in analyzeSignals),
      // not a hard reject — we still allow counter-trend setups if they are strong.

      const card = buildCard(ticker, raw, quote, setup, signalData, historical, market);
      // VWAP — crypto-only, intraday level pros use as bias filter and magnet
      if (isCrypto) {
        const vwap = computeSessionVWAP(historical);
        if (vwap) card.vwap = vwap;
      }
      // Classify the setup type — tells user WHAT KIND of trade this is
      card.setupType = classifySetup(quote, historical, { ...signalData, direction: setup.direction });

      // ── RETIRED SETUPS ──────────────────────────────────────────────
      // Patterns with no wins at a meaningful sample size are not shown at
      // all. Reversal Long is 0 for 10 — catching a falling knife — and the
      // automatic block only engages at 15 samples, so it kept appearing
      // while never once working. Blocking these from ENTER NOW was not
      // enough: they stayed visible and could still be taken.
      const RETIRED_SETUPS = ['🔄 Reversal Long'];
      if (RETIRED_SETUPS.includes(card.setupType?.label)) continue;
      // Flag whether indicators included a live forming bar, so the UI can be
      // honest about how current the analysis is
      card.liveBar = historical[historical.length - 1]?.isLive === true
        ? { session: historical[historical.length - 1].liveSession }
        : null;
      // Stash for the reviewer pass (stripped before sending to client)
      card._historical = historical;
      card._signalData = signalData;
      card._quote = quote;                         // reused by hourly refinement
      card._dailyAtr = signalData.atr;             // duration maths stays in sessions
      const chg  = raw.changePercent || 0;
      const hasGap = setup.warnings.some(w => w.text?.includes('Gap-up'));

      if (hasGap || (chg < -4 && setup.direction === 'SHORT')) {
        trades.waitForBounce.push(card);
      } else if (Math.abs(chg) > 2 && setup.probability === 'HIGH') {
        trades.enterNow.push(card);
      } else {
        trades.carryForward.push(card);
      }
    }

    // Candidates kept for full examination. This was 6/4/6 — sixteen out of
    // roughly fifty-five valid setups — so about forty were discarded before
    // their news, catalysts, analyst ratings or reviewer checks ever ran, on
    // the strength of a ranking that was itself inverted. Widening the funnel
    // means the reviewer chooses from what the market actually offered rather
    // than from a poorly-chosen shortlist. Final display limits still apply
    // further down, so the user still sees a focused list.
    trades.enterNow      = sortTrades(trades.enterNow).slice(0, 14);
    trades.waitForBounce = sortTrades(trades.waitForBounce).slice(0, 8);
    trades.carryForward  = sortTrades(trades.carryForward).slice(0, 13);

    // ── Enrich ONLY the most important cards (saves API calls) ─────────────
    // ── HOURLY REFINEMENT ───────────────────────────────────────────
    // Screening runs on daily bars because it is cheap and cached, but daily
    // bars are blind for timing an entry: 62% of tracked losses resolved
    // inside six hours having travelled only 24% toward target, which is an
    // entry-timing failure rather than a bad target.
    //
    // Fetching hourly bars for the whole 150-name universe was the obvious
    // approach and it broke everything — request volume doubled, Yahoo
    // returned 267 rate-limit retries, and BOTH series started failing, so a
    // scan produced zero setups and took five minutes. Refinement is
    // therefore limited to the candidates that already survived screening:
    // roughly 35 requests instead of 150, on exactly the names where entry
    // precision actually matters.
    //
    // Levels are only replaced when the hourly setup agrees on direction and
    // still clears every gate; otherwise the daily setup stands.
    if (market === 'stocks') {
      const refineTargets = [...trades.enterNow, ...trades.waitForBounce, ...trades.carryForward];
      const hourlyMap = await fetchIntradayBatch(refineTargets.map(c => c.ticker)).catch(() => ({}));
      let refined = 0;
      for (const card of refineTargets) {
        const hourly = hourlyMap[card.ticker];
        if (!hourly || hourly.length < 120) continue;
        try {
          const quote = card._quote;
          if (!quote) continue;
          const hSignals = analyzeSignals(quote, hourly, marketRegime);
          const hSetup = generateTradeSetup(quote, hourly, hSignals, {
            market, tradeStyle: 'intradayStock', dailyAtr: card._dailyAtr
          });
          if (!hSetup || hSetup.direction !== card.direction) continue;
          // Reject a refinement that turns a short-term trade into a
          // multi-week hold. Hourly bars can place a target far enough out
          // that the duration estimate runs to 20+ sessions — accurate, but
          // no longer the trade being offered. Keep the daily setup instead.
          if (!(hSetup.expectedDays > 0) || hSetup.expectedDays > 8) continue;
          card.entry = hSetup.entry;   card.entryLow = hSetup.entryLow; card.entryHigh = hSetup.entryHigh;
          card.tp = hSetup.tp;         card.tp2 = hSetup.tp2;           card.tp0 = hSetup.tp0;
          card.sl = hSetup.sl;         card.rrRatio = hSetup.rrRatio;   card.rrRatio2 = hSetup.rrRatio2;
          card.rrRatio0 = hSetup.rrRatio0; card.scalePlan = hSetup.scalePlan;
          card.tpPct  = parseFloat(Math.abs((hSetup.tp  - hSetup.entry) / hSetup.entry * 100).toFixed(1));
          card.tp2Pct = parseFloat(Math.abs((hSetup.tp2 - hSetup.entry) / hSetup.entry * 100).toFixed(1));
          card.slPct  = parseFloat(Math.abs((hSetup.sl  - hSetup.entry) / hSetup.entry * 100).toFixed(1));
          card.expectedDays = hSetup.expectedDays; card.expectedDays2 = hSetup.expectedDays2;
          card.expectedHours = hSetup.expectedHours; card.expectedHours2 = hSetup.expectedHours2;
          card.confirmation = hSetup.confirmation;
          card.timeSpan = `Short-term — about ${hSetup.expectedDays} session${hSetup.expectedDays === 1 ? '' : 's'}`;
          card.exitWindow = `Scale at target 1 within ~${hSetup.expectedDays} session${hSetup.expectedDays === 1 ? '' : 's'}; runner up to ~${hSetup.expectedDays2}`;
          card.timingSource = 'hourly';
          // Deliberately NOT swapping _signalData/_historical. The reviewer's
          // thresholds — five-bar extended move, today's range against ATR,
          // volatility limits — are all calibrated against daily bars. Handing
          // it the hourly series made "five days" mean five hours and rejected
          // every candidate. Hourly improves WHERE the levels sit; the daily
          // series still governs whether the trade is sane.
          refined++;
        } catch { /* keep the daily setup */ }
      }
      if (refined) console.log(`  ✓ Refined ${refined}/${refineTargets.length} setups on hourly bars`);
    }

    // Enrich EVERY surviving card. Enrichment used to be limited to a
    // handful to save API calls, but the catalyst analysis and trade thesis
    // are now the core of the decision — a card with no reason attached
    // cannot be judged, and half the list was appearing without one.
    const priorityCards = [
      ...trades.enterNow,
      ...trades.waitForBounce,
      ...trades.carryForward
    ];
    // Enrichment runs in parallel batches. Enriching every card sequentially,
    // with three chained requests each and a sleep between cards, pushed a
    // scan to 88 seconds — longer than the 60s refresh interval, so scans
    // overlapped and the page never settled. Batching concurrently brings it
    // back under control while still pacing requests.
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // Raised 5 -> 9. Widening the review funnel from 16 to 35 candidates
    // tripled the enrichment work and pushed a cold scan to ~79s. Each card's
    // four lookups already run in parallel; batching more cards alongside them
    // brings it back under control. Finnhub's own limiter still paces its
    // share, and analyst data caches for 12h so repeat scans barely touch it.
    const ENRICH_CONCURRENCY = 9;

    const enrichCard = async (card) => {
      try {
        // The three lookups are independent — run them together rather than
        // chained, which was tripling each card's latency.
        const [enrichRes, extRes, earnRes, recRes] = await Promise.allSettled([
          isCrypto
            ? enrichCryptoTicker(CRYPTO_NAMES[card.ticker] || card.ticker.replace('-USD', ''))
            : enrichTicker(card.ticker),
          isCrypto ? Promise.resolve(null) : fetchExtendedHours(card.ticker),
          isCrypto ? Promise.resolve(null) : fetchNextEarnings(card.ticker),
          // Analyst consensus. A wave of upgrades or downgrades is a genuine,
          // measurable catalyst that the chart alone cannot show.
          isCrypto ? Promise.resolve(null) : fetchRecommendationTrend(card.ticker)
        ]);

        const enrichment = enrichRes.status === 'fulfilled' ? enrichRes.value : null;
        card.news      = enrichment?.news || [];
        card.sentiment = enrichment?.sentiment || null;

        const ext = extRes.status === 'fulfilled' ? extRes.value : null;
        if (ext && Math.abs(ext.movePct) >= 0.25) {
          card.extendedHours = {
            ...ext,
            direction: ext.movePct > 0 ? 'up' : 'down',
            magnitude: Math.abs(ext.movePct) >= 3 ? 'large'
                     : Math.abs(ext.movePct) >= 1.5 ? 'moderate' : 'small'
          };
        }

        card.earnings = isCrypto ? null
          : (earnRes.status === 'fulfilled' ? evaluateEarningsRisk(earnRes.value) : null);

        const recs = recRes.status === 'fulfilled' ? recRes.value : null;
        if (recs) card.analystConsensus = recs;

        // ── CATALYST ANALYSIS ──────────────────────────────────────────
        // Identify the actual event moving this name (M&A, guidance change,
        // FDA decision, deal collapse, short report...) rather than counting
        // sentiment words. Recency-weighted, so fresh news dominates.
        const catalystAnalysis = analyseCatalysts(card.news);
        card.catalysts = catalystAnalysis.catalysts;
        card.primaryCatalyst = catalystAnalysis.primary;
        card.catalystDirection = catalystAnalysis.netDirection;
        card.catalystBreaking = catalystAnalysis.breaking;
        card.catalystBurst = catalystAnalysis.burst;
        card.blockingCatalyst = catalystAnalysis.blocking;
        card._catalystAnalysis = catalystAnalysis;

        // Fold catalysts into the signal list so they are visible alongside
        // the technical reasons on the card.
        const cs = catalystSignals(catalystAnalysis);
        if (cs.signals.length || cs.warnings.length) {
          card.signals = [...(card.signals || []), ...cs.signals, ...cs.warnings];
        }

        // ── UPCOMING EVENTS ────────────────────────────────────────────
        // What is still to come inside the holding window — this name's
        // earnings plus any market-moving macro release.
        card.eventTimeline = buildEventTimeline({
          ticker: card.ticker,
          macro: upcomingMacro,
          earnings: card.earnings,
          market
        });

        // ── TRADE THESIS ───────────────────────────────────────────────
        // One line stating why this trade exists. Trades with no catalyst and
        // only weak technicals are marked untradeable — a setup with no reason
        // behind it is not worth risking money on.
        card.thesis = buildThesis({
          direction: card.direction,
          catalystAnalysis,
          signalData: card._signalData,
          setup: { entry: card.entry, confirmation: card.confirmation },
          extendedHours: card.extendedHours,
          sector: card.sector,
          market,
          cryptoContext: isCrypto ? {
            btcTrend,
            fearGreed: cryptoContext?.fearGreed?.value ?? null
          } : null,
          vwap: card.vwap || null
        });
      } catch {
        card.news = []; card.sentiment = null; card.earnings = null;
      }
    };

    for (let i = 0; i < priorityCards.length; i += ENRICH_CONCURRENCY) {
      const batch = priorityCards.slice(i, i + ENRICH_CONCURRENCY);
      await Promise.allSettled(batch.map(enrichCard));
      if (i + ENRICH_CONCURRENCY < priorityCards.length) await sleep(200);
    }
    // Cards that didn't get enriched get empty defaults
    [...trades.enterNow, ...trades.waitForBounce, ...trades.carryForward].forEach(c => {
      if (c.news === undefined) c.news = [];
      if (c.sentiment === undefined) c.sentiment = null;
    });

    // ── Fetch weekly trends in parallel for the surviving candidates ───
    const reviewCandidates = [...trades.enterNow, ...trades.waitForBounce, ...trades.carryForward];
    const weeklyTrendMap = {};
    // Weekly trend not used for crypto (BTC trend covers macro role instead)
    if (!isCrypto) {
      // Every reviewed card, not the first twelve. The weekly-trend check is a
      // hard reject rule ("do not long against the weekly chart"), so applying
      // it to only part of the list meant cards ranked lower silently skipped
      // a safety check the others had to pass.
      const topForWeekly = reviewCandidates;
      await Promise.allSettled(topForWeekly.map(async (c) => {
        weeklyTrendMap[c.ticker] = await getWeeklyTrend(c.ticker);
      }));
    }

    // ── Derive BTC.D direction from data we already have (BTC outperforming → BTC.D rising) ──
    if (isCrypto && cryptoContext) {
      const btcEntry = fullMap['BTC-USD'];
      const btc24h = btcEntry?.quote?.changePercent;
      const total24h = cryptoContext.global?.marketCapChange24h;
      if (btc24h != null && total24h != null) {
        const diff = btc24h - total24h;
        cryptoContext.btcDominanceDirection = diff > 0.5 ? 'RISING'
                                            : diff < -0.5 ? 'FALLING'
                                            : 'FLAT';
        cryptoContext.btcDominanceDelta = parseFloat(diff.toFixed(2));
      }
    }

    // ── REVIEWER PASS: stress-test each card, drop REJECTs ─────────────
    const filterCategory = (cards) => {
      const kept = [];
      for (const card of cards) {
        const cardFunding = isCrypto && cryptoContext?.funding?.rates
          ? cryptoContext.funding.rates[tickerToBinanceSymbol(card.ticker)] ?? null
          : null;
        const inventoryRisk = isCommodities ? evaluateInventoryRisk(inventoryReleases, card.ticker) : null;
        const review = reviewTrade(card, card._historical, card._signalData, {
          vix,
          weeklyTrend: weeklyTrendMap[card.ticker] || null,
          market,
          btcTrend,
          fearGreed: cryptoContext?.fearGreed?.value || null,
          cryptoSession: cryptoContext?.session || null,
          funding: cardFunding,
          inventoryRisk
        });
        // Surface the next release on every commodities card so UI can show it
        if (isCommodities && inventoryReleases) {
          const next = Object.values(inventoryReleases).find(r => r.tickers.includes(card.ticker));
          if (next) card.inventoryRelease = next;
        }
        // Strip internal fields before sending
        delete card._historical;
        delete card._signalData;
        delete card._catalystAnalysis;
        delete card._quote;
        delete card._dailyAtr;
        card.review = review;
        card.weeklyTrend = weeklyTrendMap[card.ticker] || null;

        if (review.verdict === 'REJECT') continue;  // Drop bad trades entirely
        kept.push(card);
      }
      return kept;
    };
    trades.enterNow      = filterCategory(trades.enterNow);
    trades.waitForBounce = filterCategory(trades.waitForBounce);
    trades.carryForward  = filterCategory(trades.carryForward);

    // ── INTELLIGENT ENTER-NOW GATE ─────────────────────────────────────
    // Requires:
    //   • Confirmation candle (today's bar confirms direction) — pro best practice
    //   • Quality signals (HIGH/MED prob with PASS or strong CAUTION)
    //   • In CHOPPY markets, raise the bar substantially
    const isChoppy = !isCrypto && choppiness?.regime === 'CHOPPY';
    const isMixed  = !isCrypto && choppiness?.regime === 'MIXED';

    const demoted = [];
    trades.enterNow = trades.enterNow.filter(card => {
      const rr = card.rrRatio || 0;
      // Crypto: 24/7 means daily candles are arbitrary cuts — confirmation candle isn't a hard gate
      const hasConfirmation = isCrypto ? true : card.confirmation?.confirmed === true;
      // Choppy market: only the gold-standard setups (HIGH+PASS+confirmation+R:R≥2.0)
      if (isChoppy) {
        const passes = card.probability === 'HIGH' && card.review?.verdict === 'PASS' && rr >= 2.0 && hasConfirmation;
        if (passes) return true;
        demoted.push(card);
        return false;
      }
      // Mixed market: tighter than normal — PASS only (CAUTION dropped from
      // eligibility since it wins at the same rate as PASS in tracked data).
      if (isMixed) {
        if (macroBlackout) { demoted.push(card); return false; }
      if (card.setupBlocked) { demoted.push(card); return false; }
        const passes = card.probability === 'HIGH' && card.review?.verdict === 'PASS' && rr >= 1.7 && hasConfirmation;
        if (passes) return true;
        demoted.push(card);
        return false;
      }
      // FEEDBACK LOOP v2 tightening: data showed PASS and CAUTION win at the
      // same 31% rate, so CAUTION no longer earns the ENTER NOW slot. Blocked
      // setups (auto-flagged by historical <25% win rate) are also barred.
      if (macroBlackout) { demoted.push(card); return false; }
      if (card.setupBlocked) { demoted.push(card); return false; }
      // Negative expectancy = a trade that loses money if repeated. Never a
      // top pick, however clean the chart looks.
      if (card.negativeExpectancy) { demoted.push(card); return false; }
      // No stated reason = not a trade. ENTER NOW is reserved for setups with
      // either a real catalyst or genuinely strong technical confluence.
      if (card.thesis && card.thesis.tradeable === false) { demoted.push(card); return false; }
      // R:R floors raised to 2.0 — tracked data showed 81% of signals sat
      // below that, and at a ~30% win rate every one of them was a loser.
      const isHighPass = card.probability === 'HIGH'   && card.review?.verdict === 'PASS' && rr >= 2.0;
      const isMedPass  = card.probability === 'MEDIUM' && card.review?.verdict === 'PASS' && rr >= 2.3;
      const qualifies = (isHighPass || isMedPass) && hasConfirmation;
      if (qualifies) return true;
      demoted.push(card);
      return false;
    });
    // When nothing clears the bar, say why. An empty ENTER NOW with no
    // explanation reads as a broken scanner; the actual reason ("everything
    // failed on expectancy", "no confirming candles yet") is information the
    // trader can act on.
    let enterNowEmptyReason = null;
    if (trades.enterNow.length === 0 && demoted.length > 0) {
      const tally = {};
      for (const c of demoted) {
        if (c.negativeExpectancy) tally['negative expectancy'] = (tally['negative expectancy'] || 0) + 1;
        else if (c.setupBlocked) tally['setup type blocked on poor track record'] = (tally['setup type blocked on poor track record'] || 0) + 1;
        else if (c.thesis?.tradeable === false) tally['no clear driver behind the setup'] = (tally['no clear driver behind the setup'] || 0) + 1;
        else if (!(isCrypto || c.confirmation?.confirmed)) tally['no confirming candle yet'] = (tally['no confirming candle yet'] || 0) + 1;
        else if (c.review?.verdict !== 'PASS') tally['reviewer flagged risks'] = (tally['reviewer flagged risks'] || 0) + 1;
        else tally['reward-to-risk below threshold'] = (tally['reward-to-risk below threshold'] || 0) + 1;
      }
      const parts = Object.entries(tally).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${k}`);
      enterNowEmptyReason = `${demoted.length} setup${demoted.length === 1 ? '' : 's'} reviewed, none qualified — ${parts.join('; ')}.`;
    }

    trades.enterNow = sortTrades(trades.enterNow).slice(0, 6);  // 6 best max — quality not quantity
    trades.carryForward = [...trades.carryForward, ...demoted]
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 8);

    // Build the entry timing context — crypto uses its own session-aware function,
    // others use the US stock market entryTiming.
    const entryTiming = isCrypto ? getCryptoEntryTiming() : getEntryTiming();

    // Log every surviving signal + attach historical setup-type stats for feedback loop.
    // The monitor (lib/signalMonitor.js) tracks each from here to its outcome.
    // FEEDBACK LOOP v2 — data-driven tunings:
    //  • minSamples 10 → 8 so more setups get auto-adjusted
    //  • New "block" tier: <25% win rate over n≥15 hard-caps confidence + tags
    //    the card so it can never reach ENTER NOW
    for (const card of [...trades.enterNow, ...trades.waitForBounce, ...trades.carryForward]) {
      if (card.review?.verdict === 'REJECT') continue;
      const setupKey = card.setupType?.label || null;
      // 90-day window: a 60-day lookback was discarding ~40% of resolved
      // signals, leaving every setup type below the minimum sample size so
      // the loop never fired. Setup-pattern edge is stable enough over a
      // quarter for this to be safe.
      const hist = setupKey ? getSetupTypeStats(setupKey, { market, lookbackDays: 90, minSamples: 8 }) : null;
      if (hist) {
        card.historicalStats = hist;
        let adj = 0;
        // "Block" tier — statistically bad setup, quarantine it
        if (hist.winRate < 0.25 && hist.sampleSize >= 15) {
          adj = -25;
          card.setupBlocked = true;  // barred from ENTER NOW below
        } else if (hist.winRate < 0.35) adj = -15;
        else if (hist.winRate < 0.45) adj = -8;
        else if (hist.winRate > 0.60) adj = 8;
        else if (hist.winRate > 0.55) adj = 4;
        if (adj !== 0) {
          card.confidence = Math.max(15, Math.min(95, card.confidence + adj));
          card.confidenceAdjustment = adj;
        }

        // ── EXPECTANCY GATE ────────────────────────────────────────────
        // The decisive test: does this trade make money if repeated?
        //   E = (winRate x R:R) - (1 - winRate),  in units of risk (R).
        // Tracked data showed the whole book at -0.25R — profitable-looking
        // setups that bled out because R:R never covered the loss rate.
        // Anything with negative expectancy is now flagged and kept out of
        // ENTER NOW, regardless of how good its technicals look.
        const rr = card.rrRatio || 0;
        const expectancy = (hist.winRate * rr) - (1 - hist.winRate);
        card.expectancy = parseFloat(expectancy.toFixed(3));
        // With zero recorded wins the breakeven R:R is undefined, and the
        // clamped version rendered as an absurd "needs R:R >= 100". Report it
        // as unreachable instead, which is what it actually means.
        card.breakEvenRR = hist.winRate > 0
          ? parseFloat(((1 - hist.winRate) / hist.winRate).toFixed(2))
          : null;
        if (expectancy <= 0) {
          card.negativeExpectancy = true;
        }
      }
      try { logSignal(card, { market }); } catch {}
    }

    // Mark the single best trade across all categories as TOP PICK
    // Only consider PASS verdict trades for TOP PICK (no caution flags)
    const allCards = [...trades.enterNow, ...trades.waitForBounce, ...trades.carryForward];
    const passOnly = allCards.filter(c => c.review?.verdict === 'PASS');
    const pool = passOnly.length ? passOnly : allCards;
    if (pool.length) {
      const top = pool.reduce((best, c) =>
        (!best || c.confidence > best.confidence ||
         (c.confidence === best.confidence && c.rrRatio > best.rrRatio)) ? c : best, null);
      if (top) top.isTopPick = true;
    }

    res.json({
      trades,
      market,
      topPick: allCards.find(c => c.isTopPick) || null,
      marketRegime,
      choppiness,
      vix,
      vixRegime: vix == null ? null : vix > 30 ? 'EXTREME' : vix > 22 ? 'ELEVATED' : vix > 15 ? 'NORMAL' : 'LOW',
      btcTrend,
      cryptoContext,
      inventoryReleases,
      entryTiming,
      enterNowEmptyReason,
      macroBlackout,
      scannedCount: tickerList.length,
      universe: universeMeta ? {
        total: universeMeta.total,
        fromScreens: universeMeta.fromScreens,
        fromWatchlist: universeMeta.fromWatchlist,
        sources: universeMeta.sources
      } : null,
      passedFilter: allCards.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Scanner error:', err);
    res.status(500).json({ error: 'Scan failed', details: err.message });
  }
});

router.get('/movers', async (req, res) => {
  try {
    const { fetchBatch } = await import('../lib/yahoo.js');
    const quotesMap = await fetchBatch(WATCHLIST.slice(0, 20));
    const quotes = Object.values(quotesMap)
      .filter(q => !q.error && q.price)
      .map(q => ({ ticker: q.symbol || q.ticker, price: q.price, change: q.change, changePercent: q.changePercent, name: q.longName }));
    const sorted = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
    res.json({ gainers: sorted.slice(0, 5), losers: sorted.slice(-5).reverse(), timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Movers fetch failed', details: err.message });
  }
});

router.get('/watchlist', (req, res) => res.json({ tickers: WATCHLIST }));

// GET /api/scanner/extended-movers — pre-market / post-market biggest moves
router.get('/extended-movers', async (req, res) => {
  try {
    const { fetchBatch } = await import('../lib/yahoo.js');
    const quotesMap = await fetchBatch(WATCHLIST.slice(0, 40));

    const movers = [];
    for (const [ticker, q] of Object.entries(quotesMap)) {
      if (q.error) continue;
      const regClose = q.price;
      const pre  = q.preMarketPrice;
      const post = q.postMarketPrice;
      if (pre && regClose) {
        const pct = ((pre - regClose) / regClose) * 100;
        if (Math.abs(pct) >= 0.8) movers.push({ ticker, name: q.longName, session: 'pre',  price: pre,  regClose, pct });
      } else if (post && regClose) {
        const pct = ((post - regClose) / regClose) * 100;
        if (Math.abs(pct) >= 0.8) movers.push({ ticker, name: q.longName, session: 'post', price: post, regClose, pct });
      }
    }

    movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    res.json({
      gainers: movers.filter(m => m.pct > 0).slice(0, 5),
      losers:  movers.filter(m => m.pct < 0).slice(0, 5),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Extended movers fetch failed', details: err.message });
  }
});

export default router;
