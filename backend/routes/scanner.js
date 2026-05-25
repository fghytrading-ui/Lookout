import { Router } from 'express';
import { fetchFullBatch, fetchFull, fetchWeekly } from '../lib/yahoo.js';
import { classifySetup } from '../lib/setupClassifier.js';
import { getMarketChoppiness } from '../lib/marketChoppiness.js';
import { enrichTicker, enrichCryptoTicker } from '../lib/news.js';
import { fetchNextEarnings, evaluateEarningsRisk } from '../lib/earnings.js';
import { reviewTrade } from '../utils/reviewer.js';
import { getCryptoContext, tickerToBinanceSymbol, getCryptoEntryTiming } from '../lib/cryptoContext.js';
import { fetchCryptoCandlesBatch, computeSessionVWAP } from '../lib/cryptoCandles.js';
import { getInventoryReleases, evaluateInventoryRisk } from '../lib/inventoryReleases.js';
import {
  analyzeSignals, generateTradeSetup, calculateSMA,
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
  const { direction, entry, entryLow, entryHigh, tp, tp2, sl, rrRatio, rrRatio2, probability, confirming, confidence, expectedDays, expectedDays2, expectedHours, expectedHours2, trendStrength, trendStrengthLabel, confirmation, tradeStyle } = setup;
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
    sl, slPct,
    timeSpan: tradeStyle === 'crypto' ? 'Intraday — Next Session (4–12h)'
            : tradeStyle === 'sameDay' ? 'Intraday — Same Day'
            : TIME_SPANS[tsKey].label,
    exitWindow: tradeStyle === 'crypto' ? 'Within the next active session — 24/7 market'
              : tradeStyle === 'sameDay' ? 'Before market close (9pm UK)'
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
      mustExitBy: '9:00 PM UK',
      totalSession: '6.5 hours',
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

function sortTrades(arr) {
  return arr.sort((a, b) => {
    // 1. HIGH probability first
    if (a.probability !== b.probability) return a.probability === 'HIGH' ? -1 : 1;
    // 2. Higher confidence score
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // 3. Better R:R as final tiebreaker
    return b.rrRatio - a.rrRatio;
  });
}

router.get('/scan', async (req, res) => {
  try {
    const market = (req.query.market || 'stocks').toLowerCase();
    const watchlist = market === 'forex' ? FOREX_WATCHLIST
                    : market === 'commodities' ? COMMODITIES_WATCHLIST
                    : market === 'crypto' ? CRYPTO_WATCHLIST
                    : WATCHLIST;

    const tickerList = req.query.tickers
      ? req.query.tickers.split(',').map(t => t.trim().toUpperCase())
      : watchlist.slice(0, 40);

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

    const trades = { enterNow: [], waitForBounce: [], carryForward: [] };

    for (const ticker of tickerList) {
      const entry = fullMap[ticker];
      if (!entry || entry.error) continue;

      const raw        = entry.quote;
      const historical = entry.candles;
      if (!raw.price || historical.length < 30) continue;  // Need 30+ for 200 SMA

      const quote = adaptQuote(raw);
      const signalData = analyzeSignals(quote, historical, marketRegime);
      const setup      = generateTradeSetup(quote, historical, signalData, { market, tradeStyle });
      if (!setup) continue;

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
      // Stash for the reviewer pass (stripped before sending to client)
      card._historical = historical;
      card._signalData = signalData;
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

    trades.enterNow      = sortTrades(trades.enterNow).slice(0, 6);
    trades.waitForBounce = sortTrades(trades.waitForBounce).slice(0, 4);
    trades.carryForward  = sortTrades(trades.carryForward).slice(0, 6);

    // ── Enrich ONLY the most important cards (saves API calls) ─────────────
    const priorityCards = [
      ...trades.enterNow,
      ...trades.waitForBounce.slice(0, 2),
      ...trades.carryForward.slice(0, 2)
    ];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < priorityCards.length; i++) {
      const card = priorityCards[i];
      try {
        // For crypto, search by coin name (Bitcoin, Ethereum…) instead of YHA ticker
        const enrichment = isCrypto
          ? await enrichCryptoTicker(CRYPTO_NAMES[card.ticker] || card.ticker.replace('-USD', ''))
          : await enrichTicker(card.ticker);
        card.news      = enrichment.news || [];
        card.sentiment = enrichment.sentiment || null;
        if (isCrypto) {
          card.earnings = null;  // crypto has no earnings reports
        } else {
          const earningsData = await fetchNextEarnings(card.ticker);
          card.earnings = evaluateEarningsRisk(earningsData);
        }
      } catch {
        card.news = []; card.sentiment = null; card.earnings = null;
      }
      if (i < priorityCards.length - 1) await sleep(250);
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
      const topForWeekly = reviewCandidates.slice(0, 12);
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
      // Mixed market: tighter than normal
      if (isMixed) {
        const passes = (card.probability === 'HIGH' && card.review?.verdict === 'PASS' && rr >= 1.7 && hasConfirmation) ||
                       (card.probability === 'HIGH' && card.review?.verdict === 'CAUTION' && rr >= 2.0 && hasConfirmation);
        if (passes) return true;
        demoted.push(card);
        return false;
      }
      // Trending market: standard gates + confirmation candle
      const isHighPass    = card.probability === 'HIGH'   && card.review?.verdict === 'PASS'    && rr >= 1.5;
      const isHighCaution = card.probability === 'HIGH'   && card.review?.verdict === 'CAUTION' && rr >= 1.8;
      const isMedPass     = card.probability === 'MEDIUM' && card.review?.verdict === 'PASS'    && rr >= 1.8;
      const qualifies = (isHighPass || isHighCaution || isMedPass) && hasConfirmation;
      if (qualifies) return true;
      demoted.push(card);
      return false;
    });
    trades.enterNow = sortTrades(trades.enterNow).slice(0, 6);  // 6 best max — quality not quantity
    trades.carryForward = [...trades.carryForward, ...demoted]
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 8);

    // Build the entry timing context — crypto uses its own session-aware function,
    // others use the US stock market entryTiming.
    const entryTiming = isCrypto ? getCryptoEntryTiming() : getEntryTiming();

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
      scannedCount: tickerList.length,
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
