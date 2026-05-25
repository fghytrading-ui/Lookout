// Energy inventory release detector.
// EIA Crude Oil and Natural Gas storage reports move CL/NG 2–5% in minutes.
// We tap the existing ForexFactory live calendar feed (already cached) so no
// new API is needed.
//
// Returns the NEXT scheduled release per energy product with consensus,
// previous value, and hours until release.

import axios from 'axios';
import { registerCache } from './persistentCache.js';

const cache = new Map();
const TTL = 30 * 60 * 1000; // 30 min — release schedule changes slowly
registerCache('inventory-releases', cache);

const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

// Map FF event title → our internal product key + which tickers it affects
const RELEASE_MAP = [
  { match: /^Crude Oil Inventories/i,    product: 'crudeOil',   tickers: ['CL=F', 'BZ=F', 'USO'] },
  { match: /^Natural Gas Storage/i,      product: 'naturalGas', tickers: ['NG=F', 'UNG'] },
  // FF occasionally includes API stock report (pre-EIA, Tuesday evening)
  { match: /^API Weekly Crude Stock/i,   product: 'crudeApi',   tickers: ['CL=F', 'BZ=F', 'USO'] },
];

export async function getInventoryReleases() {
  const cached = cache.get('releases');
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  try {
    const { data: events } = await axios.get(FEED_URL, { timeout: 8000 });
    if (!Array.isArray(events)) return null;

    const now = Date.now();
    const result = {};

    for (const event of events) {
      const title = event.title || '';
      const matched = RELEASE_MAP.find(m => m.match.test(title));
      if (!matched) continue;

      const releaseTs = new Date(event.date).getTime();
      if (isNaN(releaseTs)) continue;
      // Skip past releases — only interested in next one per product
      if (releaseTs < now - 60 * 60 * 1000) continue; // allow 1h grace for "just released"

      const existing = result[matched.product];
      if (!existing || releaseTs < existing._ts) {
        const hoursUntil = (releaseTs - now) / (60 * 60 * 1000);
        result[matched.product] = {
          title,
          date: event.date,
          forecast: event.forecast || null,
          previous: event.previous || null,
          tickers: matched.tickers,
          hoursUntil: parseFloat(hoursUntil.toFixed(1)),
          isPast: hoursUntil < 0,
          _ts: releaseTs
        };
      }
    }

    cache.set('releases', { data: result, ts: Date.now() });
    return result;
  } catch {
    return null;
  }
}

// For a given ticker, return the next relevant release (or null)
export function getNextReleaseForTicker(releases, ticker) {
  if (!releases) return null;
  for (const product of Object.values(releases)) {
    if (product.tickers.includes(ticker)) return product;
  }
  return null;
}

// Returns 'BLOCK' (within ±2h), 'CAUTION' (within ±24h), or null (safe).
// Inventory releases are scheduled binary events — like earnings for stocks.
export function evaluateInventoryRisk(releases, ticker) {
  const release = getNextReleaseForTicker(releases, ticker);
  if (!release) return null;
  const h = release.hoursUntil;
  if (h >= -2 && h <= 2) {
    return {
      status: 'BLOCK',
      release,
      message: h < 0
        ? `${release.title} just released (${Math.abs(h).toFixed(1)}h ago) — wait for dust to settle`
        : `${release.title} in ${h.toFixed(1)}h — do NOT hold through release`
    };
  }
  if (h > 2 && h <= 24) {
    return {
      status: 'CAUTION',
      release,
      message: `${release.title} in ${h.toFixed(1)}h — must clear position before release`
    };
  }
  return null;
}
