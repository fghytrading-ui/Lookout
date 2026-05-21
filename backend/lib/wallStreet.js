// Wall Street analyst consensus from Yahoo Finance quoteSummary endpoint.
// Returns: target prices, BUY/HOLD/SELL ratings, # of analysts.
// Gracefully returns null if endpoint is restricted.
import axios from 'axios';
import { registerCache } from './persistentCache.js';

const cache = new Map();
const TTL = 12 * 60 * 60 * 1000; // 12 hours — analyst ratings change slowly
registerCache('wall-street', cache);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

export async function fetchWallStreetConsensus(ticker) {
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`;
    const { data } = await axios.get(url, {
      headers: HEADERS,
      params: { modules: 'financialData,recommendationTrend,upgradeDowngradeHistory' },
      timeout: 8000
    });

    const result = data?.quoteSummary?.result?.[0];
    if (!result) {
      cache.set(ticker, { data: null, ts: Date.now() });
      return null;
    }

    const fin = result.financialData || {};
    const recTrend = result.recommendationTrend?.trend?.[0] || {};

    // Recommendation key from Yahoo: 1=Strong Buy, 2=Buy, 3=Hold, 4=Sell, 5=Strong Sell
    const meanRecRaw = fin.recommendationMean?.raw;
    const meanRecLabel = !meanRecRaw ? null
      : meanRecRaw <= 1.5 ? 'STRONG BUY'
      : meanRecRaw <= 2.5 ? 'BUY'
      : meanRecRaw <= 3.5 ? 'HOLD'
      : meanRecRaw <= 4.5 ? 'SELL'
                          : 'STRONG SELL';

    const consensus = {
      targetMean:        fin.targetMeanPrice?.raw         ?? null,
      targetHigh:        fin.targetHighPrice?.raw         ?? null,
      targetLow:         fin.targetLowPrice?.raw          ?? null,
      targetMedian:      fin.targetMedianPrice?.raw       ?? null,
      analystCount:      fin.numberOfAnalystOpinions?.raw ?? null,
      recommendationKey: fin.recommendationKey            ?? null,
      recommendationMean: meanRecRaw,
      recommendationLabel: meanRecLabel,
      strongBuy:  recTrend.strongBuy  ?? 0,
      buy:        recTrend.buy        ?? 0,
      hold:       recTrend.hold       ?? 0,
      sell:       recTrend.sell       ?? 0,
      strongSell: recTrend.strongSell ?? 0,
    };

    cache.set(ticker, { data: consensus, ts: Date.now() });
    return consensus;
  } catch (err) {
    // Yahoo may restrict this endpoint — cache the failure to avoid repeated requests
    cache.set(ticker, { data: null, ts: Date.now() });
    return null;
  }
}
