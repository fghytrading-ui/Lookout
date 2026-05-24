import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import quotesRouter from './routes/quotes.js';
import scannerRouter from './routes/scanner.js';
import calendarRouter from './routes/calendar.js';
import analystRouter from './routes/analyst.js';
import forexRouter from './routes/forex.js';
import commoditiesRouter from './routes/commodities.js';
import cryptoRouter from './routes/crypto.js';
import { isMarketOpen, getSession, getEntryTiming } from './utils/market.js';
import { startAutoPersist } from './lib/persistentCache.js';
import { POLYGON_ENABLED } from './lib/marketData.js';
import { FINNHUB_ENABLED } from './lib/finnhub.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/quotes', quotesRouter);
app.use('/api/scanner', scannerRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/analyst', analystRouter);
app.use('/api/forex', forexRouter);
app.use('/api/commodities', commoditiesRouter);
app.use('/api/crypto', cryptoRouter);

app.get('/api/market-status', (req, res) => {
  res.json({
    isOpen: isMarketOpen(),
    session: getSession(),
    entryTiming: getEntryTiming(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/system/status', (req, res) => {
  const dataSource = POLYGON_ENABLED ? 'polygon'
                  : FINNHUB_ENABLED ? 'finnhub+yahoo'
                  : 'yahoo';
  res.json({
    dataSource,
    polygonEnabled: POLYGON_ENABLED,
    finnhubEnabled: FINNHUB_ENABLED,
    cacheEnabled: true,
    timestamp: new Date().toISOString()
  });
});

// ── Serve built frontend in production (single deployment) ─────────────
// In dev, Vite handles the frontend separately on port 3000.
// In production, this serves the React build from /backend/public/.
const FRONTEND_DIR = path.join(__dirname, 'public');
import fs from 'fs';
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  // SPA fallback — any non-API route serves index.html (so React Router works)
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`\n  ███████████████████████████████████`);
  console.log(`  ██  PROJECT LOOK OUT  —  LIVE  ██`);
  console.log(`  ███████████████████████████████████`);
  console.log(`\n  Backend running on http://localhost:${PORT}\n`);
  startAutoPersist();
});
