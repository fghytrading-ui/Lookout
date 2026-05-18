import { Router } from 'express';
import { fetchQuote, fetchHistorical, fetchBatch } from '../lib/yahoo.js';

const router = Router();

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
    const quotes = await fetchBatch(tickers);
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
