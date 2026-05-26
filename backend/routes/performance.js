import { Router } from 'express';
import { getAggregateStats, getOpenSignals, getAllSignals } from '../lib/signalLog.js';
import { monitorTick } from '../lib/signalMonitor.js';

const router = Router();

// GET /api/performance?lookback=30 — aggregate stats over last N days
router.get('/', (req, res) => {
  const lookbackDays = parseInt(req.query.lookback, 10) || 30;
  try {
    const stats = getAggregateStats({ lookbackDays });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Performance fetch failed', details: err.message });
  }
});

// GET /api/performance/open — currently open signals being monitored
router.get('/open', (req, res) => {
  try {
    const open = getOpenSignals().map(s => ({
      id: s.id,
      ticker: s.ticker,
      name: s.name,
      market: s.market,
      direction: s.direction,
      entry: s.entry,
      tp: s.tp,
      sl: s.sl,
      probability: s.probability,
      confidence: s.confidence,
      setupType: s.setupType,
      reviewVerdict: s.reviewVerdict,
      signaledAt: s.signaledAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      hoursSinceSignal: parseFloat(((Date.now() - s.signaledAt) / (60 * 60 * 1000)).toFixed(1))
    }));
    res.json({ count: open.length, signals: open });
  } catch (err) {
    res.status(500).json({ error: 'Open signals fetch failed', details: err.message });
  }
});

// POST /api/performance/monitor-now — manually trigger a monitor tick (admin/debug)
router.post('/monitor-now', async (req, res) => {
  try {
    const result = await monitorTick();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Monitor tick failed', details: err.message });
  }
});

// GET /api/performance/raw — all signal records (for export/debug)
router.get('/raw', (req, res) => {
  res.json(getAllSignals());
});

export default router;
