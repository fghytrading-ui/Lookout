// Dynamic scan universe.
//
// The scanner ran against a hardcoded 90-name watchlist, so the same stocks
// surfaced over and over — not because they were the best trades that day,
// but because they were the only ones ever considered. A fixed list is a
// pattern by construction.
//
// This pulls the universe from the market itself each session: today's most
// active names, today's biggest gainers and losers, and the growth/value
// screens. The list therefore changes as the market changes, and a stock only
// appears because it is actually doing something today.
//
// The curated watchlist is still included as a floor, so high-quality large
// caps are never dropped just because they are quiet on a given day.

import axios from 'axios';
import { registerCache } from './persistentCache.js';

const cache = new Map();
const TTL = 15 * 60_000;   // market movers shift intraday, but not by the second
registerCache('market-universe', cache);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json'
};

// Screens worth scanning, and why each earns its place.
const SCREENS = [
  { id: 'most_actives',              reason: 'Highest volume today — where participation actually is' },
  { id: 'day_gainers',               reason: 'Strongest momentum today' },
  { id: 'day_losers',                reason: 'Sharpest sellers — bounce and continuation candidates' },
  { id: 'growth_technology_stocks',  reason: 'Liquid growth names with movement' },
  { id: 'undervalued_growth_stocks', reason: 'Value setups with a catalyst' }
];

// Junk filter applied before a symbol reaches the scanner. The signal engine
// has its own liquidity gates, but screens like day_gainers are full of
// sub-$5 microcaps that would otherwise waste most of the scan budget.
function isTradeable(q) {
  const price = q.regularMarketPrice;
  const vol   = q.regularMarketVolume;
  const cap   = q.marketCap;
  if (!price || price < 5) return false;             // no penny stocks
  if (!vol || vol < 750_000) return false;           // needs real volume today
  if (cap && cap < 500_000_000) return false;        // no microcaps
  if (/\^|=/.test(q.symbol || '')) return false;     // indices/futures handled elsewhere
  return true;
}

async function fetchScreen(scrId, count = 50) {
  try {
    const { data } = await axios.get(
      'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved',
      { params: { scrIds: scrId, count }, headers: HEADERS, timeout: 9000 }
    );
    const quotes = data?.finance?.result?.[0]?.quotes || [];
    return quotes.filter(isTradeable).map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      changePercent: q.regularMarketChangePercent,
      volume: q.regularMarketVolume,
      price: q.regularMarketPrice
    }));
  } catch {
    return [];
  }
}

/**
 * Build today's scan universe.
 *
 * @param core  curated watchlist, always included as a quality floor
 * @param max   hard cap so scan time stays predictable
 */
export async function getMarketUniverse(core = [], { max = 150 } = {}) {
  const cached = cache.get('universe');
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const results = await Promise.allSettled(
    SCREENS.map(s => fetchScreen(s.id).then(list => ({ screen: s, list })))
  );

  const seen = new Map();
  const sources = {};

  // Curated names first — they are the quality floor and should never be
  // squeezed out by the cap.
  for (const t of core) {
    if (!seen.has(t)) seen.set(t, { symbol: t, from: ['watchlist'] });
  }

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { screen, list } = r.value;
    sources[screen.id] = list.length;
    for (const item of list) {
      const existing = seen.get(item.symbol);
      if (existing) {
        if (!existing.from.includes(screen.id)) existing.from.push(screen.id);
      } else {
        seen.set(item.symbol, { ...item, from: [screen.id] });
      }
    }
  }

  let universe = [...seen.values()];

  // If the cap bites, keep the names appearing on the most screens first —
  // a stock that is simultaneously a top gainer AND a most-active is more
  // interesting than one that scraped onto a single list.
  if (universe.length > max) {
    const coreSet = new Set(core);
    universe.sort((a, b) => {
      const aCore = coreSet.has(a.symbol) ? 1 : 0;
      const bCore = coreSet.has(b.symbol) ? 1 : 0;
      if (aCore !== bCore) return bCore - aCore;
      return (b.from?.length || 0) - (a.from?.length || 0);
    });
    universe = universe.slice(0, max);
  }

  const out = {
    tickers: universe.map(u => u.symbol),
    detail: universe,
    sources,
    fromScreens: universe.filter(u => !u.from.includes('watchlist')).length,
    fromWatchlist: core.length,
    total: universe.length,
    builtAt: new Date().toISOString()
  };
  cache.set('universe', { data: out, ts: Date.now() });
  return out;
}
