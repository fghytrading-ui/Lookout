// Additional Finnhub free-tier feeds.
//
// The catalyst engine was reading Google News RSS, which returns roughly a
// dozen loosely-matched headlines with inconsistent timestamps. Finnhub's
// company-news endpoint returns properly structured, ticker-tagged articles
// with exact publish times — for AAPL it returned 76 against Google's 12.
// More articles with reliable timestamps means the catalyst engine detects
// far more real events, and recency weighting actually works.
//
// Also exposes analyst recommendation trends, which are a genuine catalyst:
// a consensus shifting from hold to buy moves price, and it is measurable.

import axios from 'axios';
import { registerCache } from './persistentCache.js';

const API_KEY = process.env.FINNHUB_API_KEY || '';
export const FINNHUB_DATA_ENABLED = !!API_KEY;
const BASE = 'https://finnhub.io/api/v1';

const cache = new Map();
registerCache('finnhub-data', cache);
const TTL = { news: 10 * 60_000, recs: 12 * 60 * 60_000, earnings: 60 * 60_000, profile: 30 * 24 * 60 * 60_000 };

function cacheGet(k, ttl) {
  const e = cache.get(k);
  if (!e || Date.now() - e.ts > ttl) return null;
  return e.data;
}
function cacheSet(k, d) { cache.set(k, { data: d, ts: Date.now() }); }

const ymd = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0];

/**
 * Company news, normalised to the shape the catalyst engine already consumes
 * ({ title, publisher, link, time }) so it is a drop-in upgrade.
 */
export async function fetchFinnhubCompanyNews(ticker, { days = 4, limit = 25 } = {}) {
  if (!FINNHUB_DATA_ENABLED) return null;
  const key = `news:${ticker}`;
  const hit = cacheGet(key, TTL.news);
  if (hit) return hit;

  try {
    const { data } = await axios.get(`${BASE}/company-news`, {
      params: { symbol: ticker, from: ymd(-days), to: ymd(0), token: API_KEY },
      timeout: 8000
    });
    if (!Array.isArray(data)) return null;

    const news = data
      .filter(a => a.headline)
      .sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
      .slice(0, limit)
      .map(a => ({
        title: a.headline,
        publisher: a.source || 'Finnhub',
        link: a.url || '',
        // Finnhub gives an exact unix timestamp — far more reliable than the
        // relative dates Google News returns, which recency weighting needs.
        time: a.datetime ? new Date(a.datetime * 1000).toISOString() : null,
        summary: a.summary || ''
      }));
    cacheSet(key, news);
    return news;
  } catch {
    return null;
  }
}

// Finnhub industries grouped into broad sectors, so related names count
// together for the concentration limit — a semiconductor maker and a software
// house move together far more than two names that merely share a word.
const SECTOR_OF_INDUSTRY = {
  Semiconductors: 'Technology', Technology: 'Technology', 'Communications': 'Communication Services',
  Media: 'Communication Services', 'Telecommunication': 'Communication Services',
  Banking: 'Financials', 'Financial Services': 'Financials', Insurance: 'Financials',
  Pharmaceuticals: 'Health Care', Biotechnology: 'Health Care', 'Health Care': 'Health Care',
  'Life Sciences Tools & Services': 'Health Care', 'Oil & Gas': 'Energy', Energy: 'Energy',
  Utilities: 'Utilities', 'Real Estate': 'Real Estate', Retail: 'Consumer', 'Consumer products': 'Consumer',
  Hotels: 'Consumer', 'Hotels, Restaurants & Leisure': 'Consumer', Automobiles: 'Consumer', 'Auto Components': 'Consumer',
  'Food Products': 'Consumer Staples', Beverages: 'Consumer Staples', Tobacco: 'Consumer Staples',
  Machinery: 'Industrials', 'Aerospace & Defense': 'Industrials', Airlines: 'Industrials', Logistics: 'Industrials',
  'Industrial Conglomerates': 'Industrials', Construction: 'Industrials', 'Electrical Equipment': 'Industrials',
  Chemicals: 'Materials', Metals: 'Materials', 'Metals & Mining': 'Materials', Mining: 'Materials', Packaging: 'Materials'
};

/**
 * The company's sector, for the risk guard's concentration limit. The scanner
 * used a hand-written map from the days of a fixed watchlist; once the
 * universe was rebuilt from the live market 198 of 287 stock trades had no
 * sector at all, and the guard skips its check when there is none — so the
 * limit applied to under a third of trades. Cached for 30 days: a company
 * does not change sector.
 */
export async function fetchCompanySector(ticker) {
  if (!FINNHUB_DATA_ENABLED) return null;
  const key = `profile:${ticker}`;
  const hit = cacheGet(key, TTL.profile);
  if (hit !== null) return hit || null;
  try {
    const { data } = await axios.get(`${BASE}/stock/profile2`, { params: { symbol: ticker, token: API_KEY }, timeout: 8000 });
    const industry = data?.finnhubIndustry || '';
    const sector = industry ? (SECTOR_OF_INDUSTRY[industry] || industry) : '';
    cacheSet(key, sector);            // '' remembers "no profile" (ETFs) without asking again
    return sector || null;
  } catch {
    return null;                      // not cached: a failed call is retried next scan
  }
}

/**
 * Analyst recommendation trend. Returns the latest month plus the direction of
 * travel versus the previous month — an upgrade wave is a real, tradable
 * catalyst, and a downgrade wave is a reason to stand aside.
 */
export async function fetchRecommendationTrend(ticker) {
  if (!FINNHUB_DATA_ENABLED) return null;
  const key = `recs:${ticker}`;
  const hit = cacheGet(key, TTL.recs);
  if (hit) return hit;

  try {
    const { data } = await axios.get(`${BASE}/stock/recommendation`, {
      params: { symbol: ticker, token: API_KEY }, timeout: 8000
    });
    if (!Array.isArray(data) || !data.length) return null;

    const [now, prev] = data;   // already newest-first
    const bulls = (now.strongBuy || 0) + (now.buy || 0);
    const bears = (now.strongSell || 0) + (now.sell || 0);
    const total = bulls + bears + (now.hold || 0);
    if (!total) return null;

    let shift = null;
    if (prev) {
      const prevBulls = (prev.strongBuy || 0) + (prev.buy || 0);
      const prevBears = (prev.strongSell || 0) + (prev.sell || 0);
      const bullDelta = bulls - prevBulls;
      const bearDelta = bears - prevBears;
      if (bullDelta >= 2 && bullDelta > bearDelta)      shift = 'upgrades';
      else if (bearDelta >= 2 && bearDelta > bullDelta) shift = 'downgrades';
    }

    const out = {
      period: now.period,
      strongBuy: now.strongBuy || 0, buy: now.buy || 0, hold: now.hold || 0,
      sell: now.sell || 0, strongSell: now.strongSell || 0,
      total,
      bullPct: Math.round((bulls / total) * 100),
      bearPct: Math.round((bears / total) * 100),
      shift,
      consensus: bulls / total >= 0.6 ? 'BULLISH'
               : bears / total >= 0.4 ? 'BEARISH' : 'MIXED'
    };
    cacheSet(key, out);
    return out;
  } catch {
    return null;
  }
}

/**
 * Market-wide breaking news. Used for a whole-market risk read rather than a
 * single ticker — when several major outlets lead with the same negative
 * story, individual chart setups matter less.
 */
export async function fetchMarketNews({ limit = 30 } = {}) {
  if (!FINNHUB_DATA_ENABLED) return null;
  const hit = cacheGet('marketNews', TTL.news);
  if (hit) return hit;
  try {
    const { data } = await axios.get(`${BASE}/news`, {
      params: { category: 'general', token: API_KEY }, timeout: 8000
    });
    if (!Array.isArray(data)) return null;
    const news = data.slice(0, limit).map(a => ({
      title: a.headline,
      publisher: a.source || 'Finnhub',
      link: a.url || '',
      time: a.datetime ? new Date(a.datetime * 1000).toISOString() : null
    }));
    cacheSet('marketNews', news);
    return news;
  } catch {
    return null;
  }
}
