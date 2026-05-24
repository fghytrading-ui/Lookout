// Crypto-specific context — BTC dominance, Fear & Greed index, market mood.
// Both use FREE public APIs, no key needed.
import axios from 'axios';
import { registerCache } from './persistentCache.js';

const cache = new Map();
const TTL = 5 * 60 * 1000; // 5 min
registerCache('crypto-context', cache);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
};

// Binance perpetual funding rates — sentiment via crowded positioning.
// Returns { rates: {BTCUSDT: 0.0001, ...}, marketAvg: <avg of major coins>, tier: 'NEUTRAL'|... }
// One unauthenticated call returns ALL symbols — no rate limit issue.
const FUNDING_SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','ADAUSDT','DOTUSDT'];
async function fetchFundingRates() {
  try {
    const { data } = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', {
      headers: HEADERS, timeout: 6000
    });
    const rates = {};
    for (const row of data) {
      if (FUNDING_SYMBOLS.includes(row.symbol)) {
        rates[row.symbol] = parseFloat(row.lastFundingRate);
      }
    }
    if (Object.keys(rates).length === 0) return null;
    // Average across majors — market-wide positioning gauge
    const vals = Object.values(rates);
    const marketAvg = vals.reduce((a, b) => a + b, 0) / vals.length;
    // Funding is per 8h. Annualized = rate * 3 * 365 (rough).
    // Extreme thresholds: >0.05%/8h crowded longs, <-0.03%/8h crowded shorts
    let tier, advice;
    if (marketAvg > 0.0005)       { tier = 'CROWDED LONGS';  advice = 'Extreme positive funding — long squeeze risk, contrarian short edge'; }
    else if (marketAvg > 0.0002)  { tier = 'BULLISH';        advice = 'Positive funding — bulls in control, monitor for exhaustion'; }
    else if (marketAvg > -0.0001) { tier = 'NEUTRAL';        advice = 'Balanced positioning — no contrarian edge'; }
    else if (marketAvg > -0.0003) { tier = 'BEARISH';        advice = 'Negative funding — bears in control, watch for short squeeze'; }
    else                          { tier = 'CROWDED SHORTS'; advice = 'Extreme negative funding — short squeeze risk, contrarian long edge'; }
    return { rates, marketAvg, tier, advice, timestamp: new Date().toISOString() };
  } catch { return null; }
}

// Map our Yahoo ticker to Binance perp symbol for funding lookup
export function tickerToBinanceSymbol(ticker) {
  // BTC-USD → BTCUSDT
  const base = ticker.replace('-USD', '').replace(/^TON.*$/, 'TON');
  return base + 'USDT';
}

// CoinGecko global data — BTC dominance + total market cap
async function fetchGlobalCrypto() {
  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/global', {
      headers: HEADERS, timeout: 6000
    });
    const d = data.data;
    return {
      btcDominance: parseFloat(d.market_cap_percentage.btc.toFixed(2)),
      ethDominance: parseFloat(d.market_cap_percentage.eth.toFixed(2)),
      totalMarketCapUSD: d.total_market_cap.usd,
      total24hVolume: d.total_volume.usd,
      marketCapChange24h: parseFloat(d.market_cap_change_percentage_24h_usd.toFixed(2))
    };
  } catch { return null; }
}

// Alternative.me Fear & Greed Index — sentiment proxy that actually correlates
async function fetchFearGreed() {
  try {
    const { data } = await axios.get('https://api.alternative.me/fng/?limit=1', {
      headers: HEADERS, timeout: 6000
    });
    const latest = data.data?.[0];
    if (!latest) return null;
    const value = parseInt(latest.value, 10);
    let interpretation, advice;
    if (value <= 20)      { interpretation = 'Extreme Fear';   advice = 'Historically a buy zone — contrarian opportunity'; }
    else if (value <= 40) { interpretation = 'Fear';            advice = 'Cautious bullish — accumulation territory'; }
    else if (value <= 60) { interpretation = 'Neutral';         advice = 'Trade the trend, no edge from sentiment'; }
    else if (value <= 80) { interpretation = 'Greed';           advice = 'Caution — reduce size, lock in profits'; }
    else                  { interpretation = 'Extreme Greed';   advice = 'Historically a top zone — be defensive'; }
    return { value, interpretation, advice, timestamp: new Date().toISOString() };
  } catch { return null; }
}

// Determine the active crypto trading "session" (informal but useful)
function getActiveCryptoSession() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const day = now.getDay();
  const hour = now.getHours();
  const isWeekend = day === 0 || day === 6;

  let activeSession, liquidity, advice;
  if (hour >= 0 && hour < 8) {
    activeSession = 'Asia';
    liquidity = isWeekend ? 'LOW' : 'MEDIUM';
    advice = isWeekend ? 'Asia weekend session — thin liquidity, wild moves possible'
                       : 'Asia session active — BTC/ETH and Asia-focused alts most active';
  } else if (hour >= 8 && hour < 13) {
    activeSession = 'Europe';
    liquidity = isWeekend ? 'LOW' : 'MEDIUM';
    advice = isWeekend ? 'Europe weekend session — moderate liquidity'
                       : 'Europe session — institutional flows and Asia/EU overlap building';
  } else if (hour >= 13 && hour < 21) {
    activeSession = 'US (Peak)';
    liquidity = isWeekend ? 'MEDIUM' : 'HIGH';
    advice = isWeekend ? 'US weekend session — still active but thinner than weekdays'
                       : 'US session — peak crypto liquidity, best entry conditions';
  } else {
    activeSession = 'Off-peak';
    liquidity = 'LOW';
    advice = 'Late evening UK — low liquidity window, prefer to wait';
  }

  return { activeSession, liquidity, advice, isWeekend };
}

export async function getCryptoContext() {
  const cached = cache.get('context');
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const [global, fearGreed, funding] = await Promise.all([
    fetchGlobalCrypto(), fetchFearGreed(), fetchFundingRates()
  ]);
  const session = getActiveCryptoSession();

  // Derive BTC.D direction from data we already have — no extra API call.
  // If BTC's 24h change > total crypto market cap's 24h change, BTC outperformed
  // (i.e. BTC.D is rising → bearish for alts). Reverse = alt-friendly.
  // Pulled from Yahoo BTC quote, computed in the scanner where we have it.
  // Here we just leave a placeholder; scanner attaches btcChange24h before sending to client.

  const result = { global, fearGreed, funding, session, timestamp: new Date().toISOString() };
  cache.set('context', { data: result, ts: Date.now() });
  return result;
}
