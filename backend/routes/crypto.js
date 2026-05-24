import { Router } from 'express';
import { getCryptoContext } from '../lib/cryptoContext.js';

const router = Router();

// GET /api/crypto/context — BTC dominance, Fear & Greed, active session
router.get('/context', async (req, res) => {
  try {
    const ctx = await getCryptoContext();
    res.json(ctx);
  } catch (err) {
    res.status(500).json({ error: 'Crypto context failed', details: err.message });
  }
});

export default router;
