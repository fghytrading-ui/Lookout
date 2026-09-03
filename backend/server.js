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
import { runSelfCheck } from './lib/selfCheck.js';
import { ALPACA_ENABLED } from './lib/alpaca.js';
import { COINGECKO_KEYED } from './lib/cryptoContext.js';
import { runLearning, getLearningState, resetLearning, learnedRecently } from './lib/learning.js';
import { assessGoals } from './lib/goals.js';
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

// Goals — is the software doing what it exists to do? Measured only on
// cohorts old enough to have resolved, and only on trades produced by the
// settings currently in force.
app.get('/api/system/goals', (req, res) => {
  try { res.json(assessGoals()); }
  catch (err) { res.status(500).json({ error: 'Goal assessment failed', details: err.message }); }
});

// Learning — what the tracked record says the parameters should be.
// GET reports without changing anything; POST applies what the guardrails
// accept. Kept separate so the reasoning can always be inspected first.
app.get('/api/system/learning', (req, res) => {
  try { res.json({ ...runLearning({ apply: false }), state: getLearningState() }); }
  catch (err) { res.status(500).json({ error: 'Learning analysis failed', details: err.message }); }
});
app.post('/api/system/learning/apply', (req, res) => {
  try { res.json(runLearning({ apply: true })); }
  catch (err) { res.status(500).json({ error: 'Apply failed', details: err.message }); }
});
app.post('/api/system/learning/reset', (req, res) => {
  try { res.json(resetLearning()); }
  catch (err) { res.status(500).json({ error: 'Reset failed', details: err.message }); }
});

// Self-check — invariants that would have caught the faults found in the
// audit. Reports only; never changes scanner behaviour.
app.get('/api/system/selfcheck', async (req, res) => {
  try {
    let cards = null, sources = null, scanStats = null;
    const market = req.query.market || 'stocks';
    try {
      const r = await fetch(`http://localhost:${PORT}/api/scanner/scan?market=${encodeURIComponent(market)}`);
      const d = await r.json();
      const tr = d.trades || d;
      cards = ['enterNow', 'waitForBounce', 'carryForward'].flatMap(k => tr[k] || []);
      scanStats = { scannedCount: d.scannedCount, passedFilter: d.passedFilter };
    } catch { /* checks needing cards will skip */ }
    try {
      const r = await fetch(`http://localhost:${PORT}/api/system/sources`);
      sources = (await r.json()).sources;
    } catch { /* ditto */ }
    res.json(runSelfCheck({ cards, sources, market, scanStats }));
  } catch (err) {
    res.status(500).json({ error: 'Self-check failed', details: err.message });
  }
});

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
    // Added when Alpaca came in. A feed doing most of the heavy lifting and
    // absent from the panel is a feed nobody can tell has stopped — the key
    // lives in .env where it cannot be seen, so this line is the only place
    // its state is visible.
    { name: 'Alpaca', drives: 'Daily bars — 6 years of history, 150 symbols per request',
      active: ALPACA_ENABLED,
      note: ALPACA_ENABLED ? null : 'no key set — Yahoo candles used instead',
      noteLevel: 'warn' },
    { name: 'Yahoo Finance', drives: 'Live prices, pre/post market, candle fallback',
      active: true },
    // Throttling is a pause, not an outage: the limiter backs off for seconds
    // and prices come from Yahoo meanwhile, so nothing on screen goes blank.
    // Flagging the feed dead every time the minute's budget filled reported a
    // fault where the fallback was working exactly as designed.
    { name: 'Finnhub Quotes', drives: 'Real-time US stock prices',
      active: finnhub.enabled,
      note: finnhub.throttled
        ? `at its per-minute limit — Yahoo prices for the next ${finnhub.retryInSec}s`
        : null,
      noteLevel: 'info' },
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
        ? `funding via ${cryptoCtx.funding.source} — ${Object.keys(cryptoCtx.funding.rates || {}).length} pairs`
        : (cryptoCtx?.funding ? null : 'funding rates unavailable from this host'),
      // Which exchange answered is worth showing and is not a fault: Binance
      // geo-blocks cloud hosts and Bybit blocks US IPs, so on Render OKX is
      // simply the provider that works, with the same ten pairs. Painted amber
      // like a real problem, it got read as one repeatedly.
      noteLevel: cryptoCtx?.funding ? 'info' : 'warn' },
    // Dominance and total cap move slowly enough that the last reading still
    // informs a signal, so a throttle only matters once it has gone stale.
    { name: 'CoinGecko', drives: 'BTC dominance, total crypto market cap',
      active: !!cryptoCtx?.global?.btcDominance,
      // Say which of the two failures this is. "Rate limited, retries
      // automatically" was true of a passing throttle and wrong about the
      // state the live host is actually in: keyless CoinGecko refuses
      // datacentre IPs outright, so no amount of retrying fixes it and the
      // panel was telling us to wait for something that never arrives.
      note: !cryptoCtx?.global?.btcDominance
        ? (COINGECKO_KEYED
            ? 'no reading — retries automatically'
            : 'blocked from this host — needs the free COINGECKO_API_KEY')
        : (cryptoCtx.global.ageMinutes
            ? `using the reading from ${cryptoCtx.global.ageMinutes} min ago`
            : null),
      noteLevel: !cryptoCtx?.global?.btcDominance ? 'warn' : 'info' },
    { name: 'Fear & Greed', drives: 'Crypto sentiment extremes',
      active: cryptoCtx?.fearGreed?.value != null },
    // The invented-events fallback was removed, so there is nothing to degrade
    // to: either the live feed answers or the calendar genuinely has no data.
    // Reporting it "active" with a fallback note was true before and is a lie
    // now.
    // Free, no key, official. Reports active unless a lookup actually failed.
    { name: 'SEC EDGAR', drives: 'Company filings — dilution, delisting, exec changes',
      active: true },
    { name: 'Economic Calendar', drives: 'CPI, jobs, GDP, PCE release dates',
      active: !!calendarLive,
      note: !calendarLive ? 'no provider reachable — no events shown'
          : (calendarLive[0]?.source === 'FRED'
              ? 'via FRED (release dates only — no forecast figures)'
              : null),
      // FRED is a narrower source, not a broken one — the dates are right,
      // the forecast column is simply absent. Worth stating, not worth
      // alarming about.
      noteLevel: !calendarLive ? 'warn' : 'info' }
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

  // Re-examine the tracked record daily and apply anything that clears the
  // guardrails. Daily rather than per-scan: the evidence moves slowly, and a
  // parameter that can only shift once a day cannot be whipped around by one
  // unusual session.
  const LEARN_EVERY = 24 * 60 * 60 * 1000;
  const learnPass = ({ force = false } = {}) => {
    try {
      // Daily means daily, measured from the last pass that actually ran and
      // not from this process starting. A free-tier restart is not a new day.
      if (!force && learnedRecently(LEARN_EVERY)) return;
      const r = runLearning({ apply: true });
      for (const rv of r.reverted || []) {
        console.log(`  ↩ learning: ${rv.market} reverted ${rv.parameters.map(p => `${p.parameter} ${p.from} -> ${p.revertedTo}`).join(', ')}`
          + ` (cost ${rv.harm.toFixed(3)}R over ${rv.span} trades)`);
      }
      const changed = r.markets.filter(m => m.applied);
      if (changed.length) {
        for (const m of changed) {
          for (const f of m.findings.filter(x => x.accepted)) {
            console.log(`  ✓ learning: ${m.market} ${f.parameter} ${f.from} -> ${f.to} (${m.sample} trades)`);
          }
        }
      }
    } catch { /* never let learning break the server */ }
  };
  setTimeout(learnPass, 60_000);          // no-ops unless a day has actually passed
  setInterval(() => learnPass({ force: true }), LEARN_EVERY);
});
