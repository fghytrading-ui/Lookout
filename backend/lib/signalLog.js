// Persistent signal log + outcome tracker.
//
// Every signal that survives the reviewer is logged here. The monitor
// (lib/signalMonitor.js) periodically updates each open signal with its
// MAE/MFE and final outcome (TP1/TP2/SL/EXPIRED). Stats from this log
// feed back into signal confidence at scan time.
//
// Persistence: JSON file at backend/data/signal-log.json. Survives restarts.

import fs from 'fs';
import { expectancyOf, greenRateOf } from './realisedR.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'signal-log.json');

// A committed snapshot of the tracked record, merged in at boot for any
// signal the live file does not already hold.
//
// Render's free tier gives the service no persistent disk: the filesystem is
// wiped on every deploy and every spin-down. Without this the deployed site
// woke up with an empty record every time, so it could never accumulate
// enough outcomes to learn from, and every signal it showed used the
// hand-set defaults rather than the calibration the record had earned.
// Merging by id means a server that HAS kept its own record is unaffected.
const SEED_PATH = path.join(DATA_DIR, 'seed', 'signal-log.json');

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

  try {
    if (fs.existsSync(SEED_PATH)) {
      const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
      let added = 0;
      for (const rec of Array.isArray(seed) ? seed : []) {
        if (!rec || !rec.id || indexById.has(rec.id)) continue;
        signals.push(rec);
        indexById.set(rec.id, rec);
        added++;
      }
      if (added) {
        dirty = true;
        console.log(`  ✓ Restored ${added} tracked signals from the shipped record`);
      }
    }
  } catch (err) {
    console.error('  ⚠ Could not read shipped record:', err.message);
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

  // One record per idea per session, whatever became of it.
  //
  // This used to require status === 'OPEN', so a signal that closed between
  // scans was logged again as if it were new. With the scan running every few
  // minutes that produced up to thirteen copies of the same idea in a day —
  // 78 duplicate records on 21 Aug alone — and each copy carried its own
  // outcome into the performance record, so one losing trade could be counted
  // thirteen times. It made that day look responsible for 37% of all losses
  // when the true figure was 7%.
  //
  // The trigger was a separate bug that closed signals almost instantly, fixed
  // on 22 Aug, after which the duplicates nearly stopped. But the dedupe
  // itself was the fragile part: whether an idea is new has nothing to do with
  // whether the previous one is still running.
  const sessionOf = (ms) => new Date(ms).toLocaleDateString('en-CA',
    { timeZone: (extras.market || card.market) === 'crypto' ? 'UTC' : 'America/New_York' });
  const thisSession = sessionOf(now);
  const existing = signals.find(s =>
    s.ticker === card.ticker &&
    s.direction === card.direction &&
    now - s.signaledAt < dedupeWindowMs &&
    sessionOf(s.signaledAt) === thisSession
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

    // ── WHY the trade was taken ──────────────────────────────────────
    // The log recorded what happened but not what the system saw, so it
    // could never answer which signals actually predict. Every question
    // asked of it so far — does confidence work, do catalysts help, does
    // pre-market matter — could only be answered for the handful of fields
    // that happened to be stored.
    //
    // These are the inputs the decision was made on, captured at signal
    // time. Cheap to store, and without them the tracking cannot improve
    // the logic it is tracking.
    features: {
      rsi:            card.rsi ?? null,
      atrPct:         extras.atr && card.price ? +(extras.atr / card.price * 100).toFixed(2) : null,
      stopPct:        card.entry && card.sl ? +(Math.abs(card.entry - card.sl) / card.entry * 100).toFixed(2) : null,
      price:          card.price ?? null,
      changePercent:  card.changePercent ?? null,
      volRatio:       card.volRatio ?? null,
      weeklyTrend:    card.weeklyTrend ?? null,
      trendStrength:  card.trendStrength ?? null,
      confirming:     card.confirming ?? null,
      marketRegime:   extras.marketRegime ?? null,
      vix:            extras.vix ?? null,
      // catalyst / news
      primaryCatalyst: card.primaryCatalyst?.label || card.primaryCatalyst || null,
      catalystDirection: card.catalystDirection ?? null,
      newsCount:      Array.isArray(card.news) ? card.news.length : null,
      sentimentScore: card.sentiment?.score ?? null,
      // outside opinion
      analystBullPct: card.analystConsensus?.bullPct ?? null,
      analystTotal:   card.analystConsensus?.total ?? null,
      // session context
      extendedMovePct: card.extendedHours?.movePct ?? null,
      extendedSession: card.extendedHours?.session ?? null,
      secRisk:        card.secWarning ? true : false,
      timingSource:   card.timingSource || 'daily',
      expectedDays:   card.expectedDays ?? null
    },

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
    s.closedAt >= since &&
    s.closeReason !== 'NEVER_FILLED'   // never a position, so not evidence
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

  // Realised return, which is what the gate and the confidence feedback now
  // judge on. winRate is kept for display but must not be used to decide
  // whether a setup trades: it counts profitable scale-outs and profitable
  // expiries as failures, which is how the best pattern in the record came to
  // look like a 21% loser.
  const exp = expectancyOf(sample);

  return {
    winRate: wins / sample.length,
    wins,                       // raw counts — needed for a significance test
    losses,
    trades: sample,             // for the expectancy test
    expectancy: exp.mean,
    expectancyUpper: exp.upper,
    expectancyLower: exp.lower,
    greenRate: greenRateOf(sample),
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
      if (s.closeReason === 'NEVER_FILLED') continue;   // never a position
      const key = s[field] || 'unknown';
      if (!map[key]) map[key] = { wins: 0, losses: 0, expired: 0, total: 0, mfeSum: 0, maeSum: 0 };
      map[key].total++;
      if (s.outcome === 'WIN') map[key].wins++;
      else if (s.outcome === 'SCRATCH') { map[key].scratches = (map[key].scratches || 0) + 1; }
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
      scratches: v.scratches || 0,
      winRate: v.total ? v.wins / v.total : 0,
      greenRate: v.total ? (v.wins + (v.scratches || 0)) / v.total : 0,
      slHitRate: v.total ? v.losses / v.total : 0,
      avgMFEPct: v.total ? parseFloat((v.mfeSum / v.total).toFixed(2)) : 0,
      avgMAEPct: v.total ? parseFloat((v.maeSum / v.total).toFixed(2)) : 0
    })).sort((a, b) => b.total - a.total);
  };

  // GREEN RATE — the share of trades that finished in profit, counting those
  // that banked the first scale and then stopped at breakeven. This is the
  // number that answers "how many of the trades you showed me made money",
  // which is not the same as the full-target hit rate.
  //
  // A signal whose entry limit was never reached is NOT a trade — there was no
  // position, so it can be neither green nor red, and averaging it in either
  // direction misstates the record. It is reported on its own line instead,
  // because the share of signals that never fill decides how many chances the
  // day actually offers.
  const taken   = closed.filter(s => s.closeReason !== 'NEVER_FILLED');
  const unfilled = closed.filter(s => s.closeReason === 'NEVER_FILLED');
  const green = taken.filter(s => s.outcome === 'WIN' || s.outcome === 'SCRATCH').length;
  const exp = expectancyOf(taken);

  return {
    lookbackDays,
    greenRate: taken.length ? green / taken.length : null,
    greenCount: green,
    scratchCount: taken.filter(s => s.outcome === 'SCRATCH').length,
    totalSignals: allRecent.length,
    open: open.length,
    closed: closed.length,
    // Trades actually entered, and the signals that never became one.
    taken: taken.length,
    neverFilled: unfilled.length,
    fillRate: closed.length ? taken.length / closed.length : null,
    // The number that decides whether any of this makes money.
    expectancyR: exp.mean != null ? parseFloat(exp.mean.toFixed(3)) : null,
    expectancyLow: exp.lower != null ? parseFloat(exp.lower.toFixed(3)) : null,
    expectancyHigh: exp.upper != null ? parseFloat(exp.upper.toFixed(3)) : null,
    totalR: exp.n ? parseFloat((exp.mean * exp.n).toFixed(1)) : null,
    wins: taken.filter(s => s.outcome === 'WIN').length,
    losses: taken.filter(s => s.outcome === 'LOSS').length,
    expired: taken.filter(s => s.outcome === 'EXPIRED').length,
    overallWinRate: taken.length
      ? taken.filter(s => s.outcome === 'WIN').length / taken.length
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

/**
 * Has this ticker+direction already been signalled in an EARLIER session?
 *
 * Entering the session immediately after a signal is where this system loses
 * its money. Measured on 288 stock signals with the entry timing as the only
 * difference: taking the next open returns -0.116R, waiting one further
 * session returns +0.136R, and the paired difference is +0.252R at z=3.74.
 * The mechanism is visible in the raw direction data — the day after a signal
 * is right only 37.6% of the time (z=-4.51 against a coin flip, and below the
 * 44.8% a random entry on the same stocks would give), while days two onward
 * sit back at the benchmark. The scanner selects stocks that have already run,
 * and the first session afterwards is the giveback.
 *
 * So a setup has to survive a session before it is offered as actionable. No
 * re-pricing is needed: the scan reruns each session and the card carries that
 * session's own levels.
 */
export function seenInEarlierSession(ticker, direction, market) {
  load();
  const dayOf = (ms) => new Date(ms).toLocaleDateString('en-CA',
    { timeZone: market === 'crypto' ? 'UTC' : 'America/New_York' });
  const today = dayOf(Date.now());
  // Only look back a few days: a setup from a fortnight ago is a different idea.
  const floor = Date.now() - 6 * 24 * 60 * 60 * 1000;
  for (const s of signals) {
    if (s.ticker !== ticker || s.direction !== direction) continue;
    if (s.signaledAt < floor) continue;
    if (dayOf(s.signaledAt) !== today) return true;
  }
  return false;
}
