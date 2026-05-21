import { Router } from 'express';
import { getCommoditySchedule, COMMODITY_DRIVERS } from '../lib/commoditySchedule.js';
import { fetchFull } from '../lib/yahoo.js';

const router = Router();

// GET /api/commodities/context — schedule, DXY, drivers
router.get('/context', async (req, res) => {
  try {
    const schedule = getCommoditySchedule(7);
    let dxy = null;
    try {
      const dxyData = await fetchFull('DX-Y.NYB', '1d');
      dxy = { price: dxyData.quote.price, changePercent: dxyData.quote.changePercent };
    } catch {}

    res.json({
      schedule,
      drivers: COMMODITY_DRIVERS,
      dxy,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Commodities context fetch failed', details: err.message });
  }
});

// GET /api/commodities/schedule
router.get('/schedule', (req, res) => {
  res.json({ schedule: getCommoditySchedule(7), timestamp: new Date().toISOString() });
});

export default router;
