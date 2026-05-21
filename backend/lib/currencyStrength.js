// Currency Strength Meter — computes relative strength of each major currency
// based on how all its pairs are performing today.
// USD strength = average % change of all USD-base pairs (inverted for quote pairs).
import { fetchBatch } from './yahoo.js';

const PAIRS = [
  // Each pair format: [base, quote, ticker]
  ['EUR','USD','EURUSD=X'],
  ['GBP','USD','GBPUSD=X'],
  ['USD','JPY','USDJPY=X'],
  ['USD','CHF','USDCHF=X'],
  ['AUD','USD','AUDUSD=X'],
  ['NZD','USD','NZDUSD=X'],
  ['USD','CAD','USDCAD=X'],
  ['EUR','GBP','EURGBP=X'],
  ['EUR','JPY','EURJPY=X'],
  ['GBP','JPY','GBPJPY=X'],
  ['EUR','CHF','EURCHF=X'],
  ['AUD','JPY','AUDJPY=X'],
  ['CAD','JPY','CADJPY=X']
];

// Compute currency strength score from all pair changes
export async function computeCurrencyStrength() {
  const tickers = PAIRS.map(p => p[2]);
  const quotes = await fetchBatch(tickers, { concurrency: 4, delayMs: 200 });

  // Each currency accumulates % changes (positive = stronger)
  const scores = { USD: 0, EUR: 0, GBP: 0, JPY: 0, CHF: 0, AUD: 0, NZD: 0, CAD: 0 };
  const counts = { USD: 0, EUR: 0, GBP: 0, JPY: 0, CHF: 0, AUD: 0, NZD: 0, CAD: 0 };

  for (const [base, quote, ticker] of PAIRS) {
    const q = quotes[ticker];
    if (!q || q.error || q.changePercent == null) continue;
    const chg = q.changePercent;
    // Base currency gains when pair rises; quote currency loses
    if (scores[base] !== undefined) { scores[base] += chg;  counts[base]++; }
    if (scores[quote] !== undefined) { scores[quote] -= chg; counts[quote]++; }
  }

  // Normalize to average % move per pair
  const result = Object.keys(scores).map(curr => ({
    currency: curr,
    score: counts[curr] ? scores[curr] / counts[curr] : 0,
    pairs: counts[curr]
  }));

  // Sort strongest to weakest
  result.sort((a, b) => b.score - a.score);

  // Add visual label
  const out = result.map((r, i) => ({
    ...r,
    score: parseFloat(r.score.toFixed(3)),
    rank: i + 1,
    strength: i === 0 ? 'strongest'
            : i === result.length - 1 ? 'weakest'
            : r.score > 0.15 ? 'strong'
            : r.score < -0.15 ? 'weak'
            : 'neutral'
  }));

  return out;
}
