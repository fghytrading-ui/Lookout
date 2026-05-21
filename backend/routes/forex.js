import { Router } from 'express';
import { getForexSession, getForexEntryTiming } from '../utils/forexSessions.js';
import { computeCurrencyStrength } from '../lib/currencyStrength.js';
import { fetchFull } from '../lib/yahoo.js';

const router = Router();

// GET /api/forex/context — session, strength, DXY
router.get('/context', async (req, res) => {
  try {
    const session = getForexSession();
    const entryTiming = getForexEntryTiming();
    const [strength, dxy] = await Promise.allSettled([
      computeCurrencyStrength(),
      fetchFull('DX-Y.NYB', '1d')
    ]);

    res.json({
      session,
      entryTiming,
      currencyStrength: strength.status === 'fulfilled' ? strength.value : [],
      dxy: dxy.status === 'fulfilled'
        ? { price: dxy.value.quote.price, changePercent: dxy.value.quote.changePercent }
        : null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Forex context fetch failed', details: err.message });
  }
});

// GET /api/forex/session — just the session info
router.get('/session', (req, res) => {
  res.json({ session: getForexSession(), entryTiming: getForexEntryTiming() });
});

export default router;
