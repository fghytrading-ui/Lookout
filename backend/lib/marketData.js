// Unified market data interface — uses Polygon when available, falls back to Yahoo.
// Adds optional cross-source verification.
import { fetchFull as yahooFull, fetchBatch as yahooBatch } from './yahoo.js';
import { polygonSnapshot, polygonHistorical, POLYGON_ENABLED } from './polygon.js';

const VERIFY_DIVERGENCES = process.env.VERIFY_PRICES === 'true';

export { POLYGON_ENABLED };

// Get full quote + candles. Uses Polygon if enabled, else Yahoo.
// If cross-verify is on, fetches both and warns on divergence > 1%.
export async function fetchMarketData(ticker, range = '3mo') {
  if (POLYGON_ENABLED) {
    try {
      const days = range === '6mo' ? 180 : range === '3mo' ? 90 : 30;
      const [snapshot, candles] = await Promise.all([
        polygonSnapshot(ticker),
        polygonHistorical(ticker, days)
      ]);
      const result = {
        quote: {
          symbol: ticker,
          price: snapshot.price,
          previousClose: snapshot.previousClose,
          change: snapshot.change,
          changePercent: snapshot.changePercent,
          dayHigh: snapshot.dayHigh, dayLow: snapshot.dayLow,
          volume: snapshot.volume,
          // Polygon snapshot doesn't give 52w directly — fall back to yahoo for those fields
          fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
          marketState: 'OPEN', currency: 'USD',
          longName: ticker, exchangeName: 'US',
          timestamp: snapshot.timestamp,
          source: 'polygon'
        },
        candles,
        source: 'polygon'
      };
      // Backfill 52w + name from Yahoo (cached, cheap)
      try {
        const yh = await yahooFull(ticker, '1d');
        result.quote.fiftyTwoWeekHigh = yh.quote.fiftyTwoWeekHigh;
        result.quote.fiftyTwoWeekLow  = yh.quote.fiftyTwoWeekLow;
        result.quote.longName         = yh.quote.longName;
        result.quote.exchangeName     = yh.quote.exchangeName;
        result.quote.averageDailyVolume3Month = yh.quote.averageDailyVolume3Month;

        // Cross-source verification
        if (VERIFY_DIVERGENCES && yh.quote.price && snapshot.price) {
          const diff = Math.abs(yh.quote.price - snapshot.price) / yh.quote.price;
          if (diff > 0.01) {
            console.warn(`[verify] ${ticker} price divergence: Polygon $${snapshot.price} vs Yahoo $${yh.quote.price} (${(diff*100).toFixed(1)}%)`);
            result.quote.divergenceWarning = true;
          }
        }
      } catch {}
      return result;
    } catch (err) {
      console.warn(`[market-data] Polygon failed for ${ticker}, falling back to Yahoo:`, err.message);
    }
  }
  // Fallback: Yahoo
  return await yahooFull(ticker, range);
}

// Batch fetch
export async function fetchMarketBatch(tickers, opts = {}) {
  // For now, always use Yahoo for batch — Polygon batch needs separate endpoint
  return await yahooBatch(tickers, opts);
}
