// Persistent signal log + outcome tracker.
//
// Every signal that survives the reviewer is logged here. The monitor
// (lib/signalMonitor.js) periodically updates each open signal with its
// MAE/MFE and final outcome (TP1/TP2/SL/EXPIRED). Stats from this log
// feed back into signal confidence at scan time.
//
// Persistence: JSON file at backend/data/signal-log.json. Survives restarts.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'signal-log.json');

// In-memory store, persisted lazily
let signals = [];      // array of signal records
let indexById = new Map();
let dirty = false;
let loaded = false;

const HORIZON_HOURS = {
  crypto:     48,   // crypto signals expire after 48h
  stocks:     5 * 24,
  forex:      5 * 24,
  commodities: 5 * 24
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (loaded) return;
  ensureDir();
  try {
    if (fs.existsSync(LOG_PATH)) {
      const raw = fs.readFileSync(LOG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      signals = Array.isArray(parsed) ? parsed : [];
      indexById = new Map(signals.map(s => [s.id, s]));
      console.log(`  ✓ Loaded ${signals.length} signals from log`);
    }
  } catch (err) {
    console.error('  ⚠ Could not load signal log:', err.message);
    signals = [];
    indexById = new Map();
  }
  loaded = true;
}

function persist() {
  if (!dirty) return;
  ensureDir();
  try {
    fs.writeFileSync(LOG_PATH, JSON.stringify(signals, null, 2), 'utf-8');
    dirty = false;
  } catch (err) {
    console.error('  ⚠ Could not persist signal log:', err.message);
  }
}

// Auto-persist every 30s if dirty
setInterval(persist, 30_000);

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Log a new signal. De-dupes: if there's already an OPEN signal for the
// same ticker+direction within the last 24h, returns existing instead.
export function logSignal(card, extras = {}) {
  load();
  const now = Date.now();
  const dedupeWindowMs = 24 * 60 * 60 * 1000;

  // Find existing open signal for ticker+direction
  const existing = signals.find(s =>
    s.status === 'OPEN' &&
    s.ticker === card.ticker &&
    s.direction === card.direction &&
    now - s.signaledAt < dedupeWindowMs
  );
  if (existing) {
    // Update lastSeenAt so we know it's still firing
    existing.lastSeenAt = now;
    dirty = true;
    return existing;
  }

  const horizonHrs = HORIZON_HOURS[card.market || extras.market] || 5 * 24;
  const record = {
    id: genId(),
    ticker: card.ticker,
    name: card.name,
    market: extras.market || card.market || 'stocks',
    sector: card.sector,
    direction: card.direction,
    entry: card.entry,
    entryLow: card.entryLow,
    entryHigh: card.entryHigh,
    tp: card.tp,
    tp2: card.tp2,
    sl: card.sl,
    atr: extras.atr,
    rrRatio: card.rrRatio,
    rrRatio2: card.rrRatio2,
    probability: card.probability,
    confidence: card.confidence,
    setupType: card.setupType?.label || null,
    reviewVerdict: card.review?.verdict || null,
    signaledAt: now,
    lastSeenAt: now,
    expiresAt: now + horizonHrs * 60 * 60 * 1000,
    horizonHrs,
    status: 'OPEN',
    // Outcome fields — populated by monitor when closing
    closedAt: null,
    closeReason: null,    // 'TP1' | 'TP2' | 'SL' | 'EXPIRED'
    closePrice: null,
    mfe: null,            // best price toward TP (favorable excursion)
    mae: null,            // worst price toward SL (adverse excursion)
    mfePct: null,         // MFE / (TP - entry)
    maePct: null,         // MAE / (entry - SL)
    timeToCloseHrs: null,
    outcome: null         // 'WIN' | 'LOSS' | 'BREAKEVEN' | 'EXPIRED'
  };
  signals.push(record);
  indexById.set(record.id, record);
  dirty = true;
  return record;
}

export function updateSignal(id, updates) {
  load();
  const s = indexById.get(id);
  if (!s) return null;
  Object.assign(s, updates);
  dirty = true;
  return s;
}

export function getOpenSignals() {
  load();
  return signals.filter(s => s.status === 'OPEN');
}

export function getAllSignals() {
  load();
  return signals;
}

export function getClosedSignals({ since = null, market = null, setupType = null } = {}) {
  load();
  let list = signals.filter(s => s.status === 'CLOSED');
  if (since) list = list.filter(s => s.closedAt >= since);
  if (market) list = list.filter(s => s.market === market);
  if (setupType) list = list.filter(s => s.setupType === setupType);
  return list;
}

// Historical win rate for a setup type (and optional market) over a lookback.
// Used by signal generation to boost/demote confidence.
// Returns { winRate, sampleSize, tpHitRate, slHitRate, avgMFE, avgMAE } or null if n < minSamples.
export function getSetupTypeStats(setupType, { market = null, lookbackDays = 60, minSamples = 10 } = {}) {
  load();
  if (!setupType) return null;
  const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  const inWindow = signals.filter(s =>
    s.status === 'CLOSED' &&
    s.setupType === setupType &&
    s.closedAt >= since
  );

  // Prefer market-specific stats, but a setup's edge is mostly about the
  // pattern rather than the venue. Filtering by market alone starved the
  // sample size so much that the feedback loop never fired — fall back to
  // cross-market data when the per-market slice is too thin.
  let sample = market ? inWindow.filter(s => s.market === market) : inWindow;
  let scope = market ? 'market' : 'all';
  if (sample.length < minSamples && market) {
    sample = inWindow;
    scope = 'all-markets';
  }
  if (sample.length < minSamples) return null;

  const wins = sample.filter(s => s.outcome === 'WIN').length;
  const losses = sample.filter(s => s.outcome === 'LOSS').length;
  const tpHits = sample.filter(s => s.closeReason === 'TP1' || s.closeReason === 'TP2').length;
  const slHits = sample.filter(s => s.closeReason === 'SL').length;
  const mfeAvg = sample.reduce((a, s) => a + (s.mfePct || 0), 0) / sample.length;
  const maeAvg = sample.reduce((a, s) => a + (s.maePct || 0), 0) / sample.length;

  return {
    winRate: wins / sample.length,
    lossRate: losses / sample.length,
    tpHitRate: tpHits / sample.length,
    slHitRate: slHits / sample.length,
    sampleSize: sample.length,
    scope,   // 'market' | 'all-markets' | 'all' — tells the UI how broad the sample is
    avgMFEPct: parseFloat(mfeAvg.toFixed(2)),
    avgMAEPct: parseFloat(maeAvg.toFixed(2))
  };
}

// Get aggregate stats for the performance page.
export function getAggregateStats({ lookbackDays = 30 } = {}) {
  load();
  const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const allRecent = signals.filter(s => s.signaledAt >= since);
  const closed = allRecent.filter(s => s.status === 'CLOSED');
  const open = allRecent.filter(s => s.status === 'OPEN');

  const byField = (field) => {
    const map = {};
    for (const s of closed) {
      const key = s[field] || 'unknown';
      if (!map[key]) map[key] = { wins: 0, losses: 0, expired: 0, total: 0, mfeSum: 0, maeSum: 0 };
      map[key].total++;
      if (s.outcome === 'WIN') map[key].wins++;
      else if (s.outcome === 'LOSS') map[key].losses++;
      else if (s.outcome === 'EXPIRED') map[key].expired++;
      map[key].mfeSum += s.mfePct || 0;
      map[key].maeSum += s.maePct || 0;
    }
    return Object.entries(map).map(([key, v]) => ({
      key,
      total: v.total,
      wins: v.wins,
      losses: v.losses,
      expired: v.expired,
      winRate: v.total ? v.wins / v.total : 0,
      slHitRate: v.total ? v.losses / v.total : 0,
      avgMFEPct: v.total ? parseFloat((v.mfeSum / v.total).toFixed(2)) : 0,
      avgMAEPct: v.total ? parseFloat((v.maeSum / v.total).toFixed(2)) : 0
    })).sort((a, b) => b.total - a.total);
  };

  return {
    lookbackDays,
    totalSignals: allRecent.length,
    open: open.length,
    closed: closed.length,
    wins: closed.filter(s => s.outcome === 'WIN').length,
    losses: closed.filter(s => s.outcome === 'LOSS').length,
    expired: closed.filter(s => s.outcome === 'EXPIRED').length,
    overallWinRate: closed.length
      ? closed.filter(s => s.outcome === 'WIN').length / closed.length
      : null,
    byMarket: byField('market'),
    bySetupType: byField('setupType'),
    byVerdict: byField('reviewVerdict'),
    byProbability: byField('probability'),
    byDirection: byField('direction'),
    recentClosed: closed
      .sort((a, b) => b.closedAt - a.closedAt)
      .slice(0, 20)
      .map(s => ({
        id: s.id,
        ticker: s.ticker,
        market: s.market,
        direction: s.direction,
        setupType: s.setupType,
        outcome: s.outcome,
        closeReason: s.closeReason,
        signaledAt: s.signaledAt,
        closedAt: s.closedAt,
        timeToCloseHrs: s.timeToCloseHrs,
        mfePct: s.mfePct,
        maePct: s.maePct,
        entry: s.entry,
        tp: s.tp,
        sl: s.sl,
        closePrice: s.closePrice
      }))
  };
}

// Force a flush — useful at shutdown
export function flushSignalLog() { persist(); }

// ── EPHEMERAL-DISK RECOVERY ──────────────────────────────────────────────
// Render's free tier wipes the disk on every restart (and it sleeps after
// ~15 min idle). Without this, the learning system loses all history and can
// never accumulate enough samples to tune anything.
//
// Mitigation: the browser keeps a mirror in localStorage and POSTs it back
// whenever the server's log is smaller than the client's. We merge by id,
// preferring CLOSED records (they carry resolved outcomes) over OPEN ones.

export function getLogSize() { load(); return signals.length; }

export function mergeSignals(incoming) {
  load();
  if (!Array.isArray(incoming)) return { added: 0, updated: 0, total: signals.length };
  let added = 0, updated = 0;

  for (const rec of incoming) {
    if (!rec || typeof rec !== 'object' || !rec.id || !rec.ticker) continue;
    const existing = indexById.get(rec.id);
    if (!existing) {
      signals.push(rec);
      indexById.set(rec.id, rec);
      added++;
      continue;
    }
    // Conflict: prefer the CLOSED record — a resolved outcome beats an open one
    if (existing.status !== 'CLOSED' && rec.status === 'CLOSED') {
      Object.assign(existing, rec);
      updated++;
    }
  }

  if (added || updated) {
    // Keep the store bounded — newest 5000 records is far more than we need
    if (signals.length > 5000) {
      signals.sort((a, b) => b.signaledAt - a.signaledAt);
      signals = signals.slice(0, 5000);
      indexById = new Map(signals.map(s => [s.id, s]));
    }
    dirty = true;
    persist();
  }
  return { added, updated, total: signals.length };
}
