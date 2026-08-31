// Crypto-specific context — BTC dominance, Fear & Greed index, market mood.
// Both use FREE public APIs, no key needed.
import axios from 'axios';
import { registerCache } from './persistentCache.js';

const cache = new Map();
// [FAST-SYSTEM-101] Bumped 5 → 15 min. Funding rates update every 8h,
// Fear & Greed daily, BTC dominance slowly. Staler data here costs nothing,
// reduces API load.
const TTL = 15 * 60 * 1000;
registerCache('crypto-context', cache);

// Last successful CoinGecko global reading, kept across throttles. Six hours
// is well inside the span over which dominance and total cap stay meaningful,
// and past it we would rather show nothing than something misleading.
let lastGoodGlobal = null;
const GLOBAL_MAX_AGE_MIN = 6 * 60;
const INCOMPLETE_TTL = 90 * 1000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
};

// Binance perpetual funding rates — sentiment via crowded positioning.
// Returns { rates: {BTCUSDT: 0.0001, ...}, marketAvg: <avg of major coins>, tier: 'NEUTRAL'|... }
// One unauthenticated call returns ALL symbols — no rate limit issue.
const FUNDING_SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','ADAUSDT','DOTUSDT'];
// Binance geo-blocks cloud hosts, so on Render this returned nothing and the
// funding signal was simply absent in production while working on a laptop.
// Bybit and OKX serve the same perpetual funding data and are reachable from
// US-hosted infrastructure, so each provider is tried until one answers.
const FUNDING_PROVIDERS = [
  {
    name: 'binance',
    fetch: async () => {
      const { data } = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex',
        { headers: HEADERS, timeout: 8000 });
      const out = {};
      for (const row of data || []) {
        if (FUNDING_SYMBOLS.includes(row.symbol)) out[row.symbol] = parseFloat(row.lastFundingRate);
      }
      return out;
    }
  },
  {
    name: 'bybit',
    fetch: async () => {
      const { data } = await axios.get('https://api.bybit.com/v5/market/tickers',
        { params: { category: 'linear' }, headers: HEADERS, timeout: 8000 });
      const out = {};
      for (const row of data?.result?.list || []) {
        if (FUNDING_SYMBOLS.includes(row.symbol) && row.fundingRate != null) {
          out[row.symbol] = parseFloat(row.fundingRate);
        }
      }
      return out;
    }
  },
  {
    name: 'okx',
    fetch: async () => {
      // OKX is one instrument per call. The first version walked six of them
      // sequentially and stopped there to keep the cost down, which meant the
      // deployed site — where OKX is the provider that answers, because
      // Binance geo-blocks cloud hosts and Bybit blocks US IPs — averaged
      // funding over six pairs while a laptop averaged ten. Same gauge, two
      // different numbers, and near a tier boundary they disagree.
      //
      // Measured 2026-08-31: all ten instruments exist on OKX and ten
      // parallel calls complete in 0.43s, faster than the six sequential ones
      // were. OKX allows 20 requests per 2s per IP, so ten at once is well
      // inside the limit. No reason to run short.
      const results = await Promise.all(FUNDING_SYMBOLS.map(async (sym) => {
        const inst = `${sym.replace('USDT', '')}-USDT-SWAP`;
        try {
          const { data } = await axios.get('https://www.okx.com/api/v5/public/funding-rate',
            { params: { instId: inst }, headers: HEADERS, timeout: 8000 });
          const r = data?.data?.[0]?.fundingRate;
          return r != null ? [sym, parseFloat(r)] : null;
        } catch { return null; }
      }));
      return Object.fromEntries(results.filter(Boolean));
    }
  }
];

async function fetchFundingRates() {
  try {
    let rates = {}, source = null;
    for (const p of FUNDING_PROVIDERS) {
      try {
        const got = await p.fetch();
        if (got && Object.keys(got).length) { rates = got; source = p.name; break; }
      } catch { /* provider unreachable — try the next */ }
    }
    if (Object.keys(rates).length === 0) return null;
    if (source && source !== 'binance') console.log(`[crypto] funding via ${source} (Binance unreachable)`);
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
    return { rates, marketAvg, tier, advice, source, timestamp: new Date().toISOString() };
  } catch { return null; }
}

// Map our Yahoo ticker to Binance perp symbol for funding lookup
export function tickerToBinanceSymbol(ticker) {
  // BTC-USD → BTCUSDT
  const base = ticker.replace('-USD', '').replace(/^TON.*$/, 'TON');
  return base + 'USDT';
}

// CoinGecko global data — BTC dominance + total market cap
//
// The keyless endpoint answers a laptop instantly and refuses Render outright:
// measured 2026-08-31, every call from the live host came back empty while the
// same call from home returned 200 in 0.24s. CoinGecko throttles datacentre IP
// ranges, so on the deployed site dominance and total cap were simply missing.
//
// The free Demo key (x-cg-demo-api-key, same base URL, 100/min and 10k/month)
// lifts that. At the 15-minute cache TTL this endpoint costs ~2,900 calls a
// month, well inside the cap, and failed calls do not spend credits.
//
// Deliberately NOT swapped for a keyless rival. CoinPaprika and CoinLore both
// serve a global endpoint, but measured side by side against CoinGecko they
// disagree: dominance 56.93 / 59.63 / 59.21, and 24h market-cap change
// +0.14 / +0.68 / -1.81 — opposite signs. The card thresholds (>55 alts
// headwind, <50 alt-friendly) and the colour bands are calibrated to
// CoinGecko's universe, so those feeds are a different number, not the same
// number from another door.
const CG_KEY = process.env.COINGECKO_API_KEY || '';
export const COINGECKO_KEYED = !!CG_KEY;

async function fetchGlobalCrypto() {
  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/global', {
      headers: CG_KEY ? { ...HEADERS, 'x-cg-demo-api-key': CG_KEY } : HEADERS,
      timeout: 6000
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

// Crypto-native entry timing — research-backed.
// Returns same shape as backend/utils/market.getEntryTiming so it slots straight into TradeCard.
//
// Why these windows (data sources: Kaiko, CoinMetrics, Glassnode market structure papers + CME volume data):
//   • 13:30–20:00 UK = US/EU overlap → BTC/ETH spot volume 2–3× Asia hours, tightest spreads,
//     ~70% of large intraday moves originate here.
//   • 14:30 UK = NY equity open. Real crypto spike — not stock-bell mechanics — because:
//       1. Crypto/Nasdaq correlation 0.6–0.8 since 2022
//       2. Spot Bitcoin ETF flows (IBIT, FBTC) only execute in equity hours
//       3. CME BTC/ETH futures volume peaks here; basis arb pulls spot
//       4. US macro data (CPI, NFP, FOMC) releases at 13:30 UK and cause the biggest intraday moves
//   • 08:00–13:30 UK = Europe-only, lighter but workable
//   • 00:00–08:00 UK = Asia session, lower liquidity, alts wick more
//   • 20:00–00:00 UK + weekends = dead zone, whale-driven wicks, manipulation more common
export function getCryptoEntryTiming() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const hour = now.getHours();
  const min  = now.getMinutes();
  const day  = now.getDay();
  const isWeekend = day === 0 || day === 6;

  // Weekend = always wait
  if (isWeekend) {
    return {
      label: 'Weekend — wait for Monday',
      detail: 'Weekend liquidity is thin; whale wicks and manipulation more common. Best wait for Monday NY open (14:30 UK).',
      urgency: 'wait'
    };
  }

  const minutesNow = hour * 60 + min;
  const peakStart  = 13 * 60 + 30;   // 13:30 UK
  const peakEnd    = 20 * 60;        // 20:00 UK
  const nyOpen     = 14 * 60 + 30;   // 14:30 UK

  // In peak window
  if (minutesNow >= peakStart && minutesNow < peakEnd) {
    if (Math.abs(minutesNow - nyOpen) <= 30) {
      return {
        label: 'ENTER NOW — NY open spike',
        detail: 'NY equity open (14:30 UK) — biggest intraday move window. ETF flows + CME futures volume peaking.',
        urgency: 'now'
      };
    }
    return {
      label: 'ENTER NOW — peak liquidity',
      detail: 'US/EU overlap (13:30–20:00 UK) — tightest spreads, 70% of major moves happen here.',
      urgency: 'now'
    };
  }

  // Europe session — peak coming
  if (hour >= 8 && minutesNow < peakStart) {
    const minsToPeak = peakStart - minutesNow;
    const hh = Math.floor(minsToPeak / 60);
    const mm = minsToPeak % 60;
    const wait = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
    return {
      label: `Peak in ${wait} (13:30 UK)`,
      detail: 'Europe session active — lighter volume. NY open at 14:30 UK is the higher-conviction window.',
      urgency: 'soon'
    };
  }

  // Asia session — long wait
  if (hour < 8) {
    const minsToPeak = peakStart - minutesNow;
    const hh = Math.floor(minsToPeak / 60);
    return {
      label: `Peak in ~${hh}h (13:30 UK)`,
      detail: 'Asia session — thin liquidity; alts prone to wicks. Scalping BTC/ETH only. Peak liquidity at NY open.',
      urgency: 'wait'
    };
  }

  // Post-US (20:00–00:00) = dead zone
  return {
    label: 'Off-peak — wait for tomorrow',
    detail: 'US close behind us, Asia not yet open. Spreads widening, choppy. Best wait for tomorrow\'s NY open (14:30 UK).',
    urgency: 'wait'
  };
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
  // A result with a hole in it is cached only briefly. Holding an incomplete
  // context for the full fifteen minutes meant one throttled call blanked
  // dominance across every crypto card for a quarter of an hour, and the cache
  // survives restarts, so a hole outlived the process that made it.
  const cached = cache.get('context');
  const ttl = cached?.data?.global ? TTL : INCOMPLETE_TTL;
  if (cached && Date.now() - cached.ts < ttl) return cached.data;

  // The cache survives restarts, so an expired entry still carries the last
  // reading we ever got — worth holding on to on a host that restarts often.
  if (!lastGoodGlobal && cached?.data?.global) {
    lastGoodGlobal = { data: cached.data.global, ts: cached.ts };
  }

  const [global, fearGreed, funding] = await Promise.all([
    fetchGlobalCrypto(), fetchFearGreed(), fetchFundingRates()
  ]);
  const session = getActiveCryptoSession();

  // Derive BTC.D direction from data we already have — no extra API call.
  // If BTC's 24h change > total crypto market cap's 24h change, BTC outperformed
  // (i.e. BTC.D is rising → bearish for alts). Reverse = alt-friendly.
  // Pulled from Yahoo BTC quote, computed in the scanner where we have it.
  // Here we just leave a placeholder; scanner attaches btcChange24h before sending to client.

  // CoinGecko's free endpoint rate-limits without warning, and it is the only
  // source for BTC dominance and total market cap. Both move slowly, so a
  // reading from earlier is worth far more than nothing: dropping to null
  // silently removed the alt-season and market-breadth reads from every crypto
  // signal for as long as the throttle lasted. Keep the last good one and say
  // how old it is rather than pretending we have no view.
  let globalOut = global;
  if (global) {
    lastGoodGlobal = { data: global, ts: Date.now() };
  } else if (lastGoodGlobal) {
    const ageMin = Math.round((Date.now() - lastGoodGlobal.ts) / 60000);
    if (ageMin <= GLOBAL_MAX_AGE_MIN) globalOut = { ...lastGoodGlobal.data, ageMinutes: ageMin };
  }

  const result = { global: globalOut, fearGreed, funding, session, timestamp: new Date().toISOString() };
  cache.set('context', { data: result, ts: Date.now() });
  return result;
}
