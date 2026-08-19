import { Router } from 'express';
import { fetchQuote, fetchHistorical, fetchBatch } from '../lib/yahoo.js';
import { fetchFinnhubBatch, FINNHUB_ENABLED } from '../lib/finnhub.js';

const router = Router();

// Determine whether a ticker is Finnhub-supported (US stocks only on free tier)
function isFinnhubSupported(t) {
  return !t.includes('=') && !t.includes('-USD') && !t.startsWith('^');
}

router.get('/price/:ticker', async (req, res) => {
  try {
    const q = await fetchQuote(req.params.ticker.toUpperCase());
    res.json(q);
  } catch (err) {
    res.status(500).json({ error: `Price unavailable for ${req.params.ticker}`, details: err.message });
  }
});

router.get('/batch', async (req, res) => {
  try {
    const raw = req.query.tickers || '';
    const tickers = raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (!tickers.length) return res.status(400).json({ error: 'No tickers provided' });

    let quotes = {};

    // 1. Finnhub for the tickers that actually need real-time pricing.
    //
    // Every supported ticker used to be sent, so a ~20-symbol ticker tape
    // polling every 10 seconds consumed the entire 60-calls/minute budget on
    // a decorative price strip — and the trades and open positions that
    // genuinely need live pricing were left on delayed Yahoo data.
    //
    // The caller marks what matters with ?priority=. Those go to Finnhub
    // first; the remainder is served by Yahoo, which is perfectly adequate
    // for a scrolling tape.
    if (FINNHUB_ENABLED) {
      const priority = (req.query.priority || '')
        .split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      const supported = tickers.filter(isFinnhubSupported);
      const ordered = [
        ...supported.filter(t => priority.includes(t)),
        ...supported.filter(t => !priority.includes(t))
      ];
      // Cap per request so one call cannot drain the minute's allowance
      const forFinnhub = ordered.slice(0, priority.length ? Math.max(12, priority.length) : 12);
      try {
        quotes = await fetchFinnhubBatch(forFinnhub, { concurrency: 5 });
      } catch (e) {
        // If Finnhub fails entirely, fall through to Yahoo for everything
      }
    }

    // 2. Fall back to Yahoo for any tickers Finnhub didn't return
    const missing = tickers.filter(t => !quotes[t] || quotes[t].error);
    if (missing.length) {
      const yahooQuotes = await fetchBatch(missing);
      Object.assign(quotes, yahooQuotes);
    }

    res.json(quotes);
  } catch (err) {
    res.status(500).json({ error: 'Batch fetch failed', details: err.message });
  }
});

router.get('/historical/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const { period = '3mo' } = req.query;
    const data = await fetchHistorical(ticker.toUpperCase(), period);
    res.json({ ticker, data });
  } catch (err) {
    res.status(500).json({ error: `Historical unavailable for ${req.params.ticker}`, details: err.message });
  }
});

export default router;
