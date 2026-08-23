// MUST stay first: loads .env before any module reads process.env.
// See env.js for why a plain dotenv.config() here was not enough.
import './env.js';

import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import quotesRouter from './routes/quotes.js';
import scannerRouter from './routes/scanner.js';
import calendarRouter from './routes/calendar.js';
import analystRouter from './routes/analyst.js';
import forexRouter from './routes/forex.js';
import commoditiesRouter from './routes/commodities.js';
import cryptoRouter from './routes/crypto.js';
import performanceRouter from './routes/performance.js';
import { startSignalMonitor } from './lib/signalMonitor.js';
import { isMarketOpen, getSession, getEntryTiming } from './utils/market.js';
import { startAutoPersist } from './lib/persistentCache.js';
import { POLYGON_ENABLED } from './lib/marketData.js';
import { FINNHUB_ENABLED, getFinnhubHealth } from './lib/finnhub.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
// Raised limit so the client can POST its full signal-log mirror back after
// a Render free-tier disk wipe (see /api/performance/restore).
app.use(express.json({ limit: '12mb' }));

app.use('/api/quotes', quotesRouter);
app.use('/api/scanner', scannerRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/analyst', analystRouter);
app.use('/api/forex', forexRouter);
app.use('/api/commodities', commoditiesRouter);
app.use('/api/crypto', cryptoRouter);
app.use('/api/performance', performanceRouter);

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

// Full data-source roster. The old badge only reported the PRICE feed, so
// the UI showed "FINNHUB + YAHOO" while CoinGecko, Binance, ForexFactory and
// the analyst/news feeds were all running unmentioned. This reports every
// source and what it drives, so the badge can tell the truth.
app.get('/api/system/sources', async (req, res) => {
  const finnhub = getFinnhubHealth();
  const probe = async (fn) => { try { return await fn(); } catch { return false; } };

  // Probe what each source actually DRIVES, not one arbitrary field of it.
  // The first version tested Binance solely via funding rates, which come from
  // the futures host — that host is unreachable from some hosting providers
  // while the spot host serving candles works perfectly. Binance was reported
  // dead while every crypto card was being built from its data. Same for the
  // calendar: the live feed can fail while the endpoint still serves usable
  // events from its fallback.
  const [cryptoCtx, binanceCandles, calendarLive] = await Promise.all([
    probe(async () => {
      const { getCryptoContext } = await import('./lib/cryptoContext.js');
      return await getCryptoContext();
    }),
    probe(async () => {
      // Use the SAME parameters the scanner uses so this reads the warm cache
      // instead of issuing a distinct uncached request. The earlier version
      // asked for 5 bars while the scanner asks for 200 — a different cache
      // key — so every status check fired a fresh call that Binance
      // rate-limited, reporting the feed dead while six crypto cards were
      // being built from it.
      const { fetchCryptoCandles } = await import('./lib/cryptoCandles.js');
      const c = await fetchCryptoCandles('BTC-USD', { interval: '4h', limit: 200 });
      return Array.isArray(c) && c.length > 0;
    }),
    probe(async () => {
      const { fetchLiveEconomicEvents } = await import('./lib/economicCalendarLive.js');
      const e = await fetchLiveEconomicEvents();
      return Array.isArray(e) && e.length > 0;
    })
  ]);

  const sources = [
    { name: 'Yahoo Finance', drives: 'Prices, candles, pre/post market',
      active: true },
    { name: 'Finnhub Quotes', drives: 'Real-time US stock prices',
      active: finnhub.enabled && !finnhub.throttled },
    { name: 'Finnhub News', drives: 'Company news for catalyst detection',
      active: finnhub.enabled },
    { name: 'Finnhub Analysts', drives: 'Buy/sell ratings and rating changes',
      active: finnhub.enabled },
    // Named for what it delivers, not one vendor: Binance geo-blocks cloud
    // hosts, so candles fall back to Coinbase and funding to Bybit/OKX. Report
    // which provider actually answered rather than implying Binance is down.
    { name: 'Crypto Exchange', drives: 'Crypto 4h candles, VWAP and funding rates',
      active: !!binanceCandles,
      note: cryptoCtx?.funding?.source && cryptoCtx.funding.source !== 'binance'
        ? `funding via ${cryptoCtx.funding.source} (Binance blocks this host)`
        : (cryptoCtx?.funding ? null : 'funding rates unavailable from this host') },
    { name: 'CoinGecko', drives: 'BTC dominance, total crypto market cap',
      active: !!cryptoCtx?.global?.btcDominance,
      note: cryptoCtx?.global?.btcDominance ? null : 'rate limited — retries automatically' },
    { name: 'Fear & Greed', drives: 'Crypto sentiment extremes',
      active: cryptoCtx?.fearGreed?.value != null },
    // The invented-events fallback was removed, so there is nothing to degrade
    // to: either the live feed answers or the calendar genuinely has no data.
    // Reporting it "active" with a fallback note was true before and is a lie
    // now.
    { name: 'Economic Calendar', drives: 'FOMC, CPI, jobs, EIA inventories',
      active: !!calendarLive,
      note: calendarLive ? null : 'provider blocks this host — no events shown' }
  ];

  res.json({
    sources,
    activeCount: sources.filter(s => s.active).length,
    totalCount: sources.length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/system/status', (req, res) => {
  const dataSource = POLYGON_ENABLED ? 'polygon'
                  : FINNHUB_ENABLED ? 'finnhub+yahoo'
                  : 'yahoo';
  const finnhub = getFinnhubHealth();
  res.json({
    dataSource,
    // Report the source actually in use. When Finnhub is throttled the app
    // falls back to Yahoo, which can lag — previously that happened silently.
    effectiveSource: finnhub.throttled ? 'yahoo (finnhub throttled)' : dataSource,
    polygonEnabled: POLYGON_ENABLED,
    finnhubEnabled: FINNHUB_ENABLED,
    finnhub,
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
  startSignalMonitor();
});
