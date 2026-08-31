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

// ── Records that cannot be true ──────────────────────────────────────────
// A trade cannot close before it was signalled. Until 2026-08-22 the monitor
// compared stock signals against their OWN day's daily bar — a bar stamped at
// midnight, covering a session that had already finished — so the day's low
// took out stops that were never live, and the outcome was stamped with the
// bar's timestamp, hours before the signal existed. The filter was fixed
// (signalMonitor.js) and the local record was cleaned.
//
// They came back anyway. The store has three doors — the file on disk, the
// shipped seed, and the client mirror POSTed to /performance/restore — and
// only the file had been cleaned. Render's free tier wipes the disk on every
// deploy, so after today's deploy the browser pushed its own months-old
// mirror back and re-admitted 21 of them, none newer than 2026-08-20.
//
// They are not neutral noise: those 21 closed 76% at the stop against 42% for
// honestly-scored trades, exactly the pessimistic skew the old bug produced,
// and nothing downstream filters on timing — goals, learning and expectancy
// all counted them. So the guard belongs at the boundary, on every door, not
// in each consumer.
function isCoherent(rec) {
  if (!rec || typeof rec !== 'object' || !rec.id || !rec.ticker) return false;
  if (rec.status === 'CLOSED') {
    if (typeof rec.timeToCloseHrs === 'number' && rec.timeToCloseHrs < 0) return false;
    if (rec.closedAt && rec.signaledAt && rec.closedAt < rec.signaledAt) return false;
  }
  return true;
}

// One idea, one record, however many times the store is rebuilt.
//
// logSignal already refuses to log the same ticker+direction twice in a
// session, but it can only see the records the running process holds. Render
// wipes the disk on every deploy and spin-down, so a scan after a restart has
// an empty store, logs an idea it already logged that morning, and the client
// mirror later merges the earlier copy back in beside it. mergeSignals only
// de-duped on id, so both survived: measured on the live record, 225 of 635
// closed rows were the same idea counted more than once, and one AAPL LONG on
// 2026-08-30 was present twice with identical entry, stop and target, thirteen
// hours apart.
//
// It biases the record it inflates. Deduplicated, expectancy over the same
// trades moves from -0.024R to +0.029R — neither significant on its own, both
// CIs straddling zero, but the calibration is fitted to this record and it was
// being fitted to double counts.
function sessionKeyOf(rec) {
  const tz = rec.market === 'crypto' ? 'UTC' : 'America/New_York';
  const day = new Date(rec.signaledAt).toLocaleDateString('en-CA', { timeZone: tz });
  return `${rec.ticker}|${rec.direction}|${day}`;
}

// Which of two records for the same idea to keep: a resolved outcome beats an
// unresolved one, and otherwise the first one written — that is the idea as it
// was actually offered.
function preferred(a, b) {
  const aClosed = a.status === 'CLOSED', bClosed = b.status === 'CLOSED';
  if (aClosed !== bClosed) return aClosed ? a : b;
  return a.signaledAt <= b.signaledAt ? a : b;
}

function dedupeBySession(rows) {
  const bySession = new Map();
  for (const r of rows) {
    if (!r?.signaledAt || !r.ticker || !r.direction) continue;
    const k = sessionKeyOf(r);
    const cur = bySession.get(k);
    bySession.set(k, cur ? preferred(cur, r) : r);
  }
  const kept = new Set(bySession.values());
  return rows.filter(r => kept.has(r));
}

let indexBySession = new Map();

function load() {
  if (loaded) return;
  ensureDir();
  try {
    if (fs.existsSync(LOG_PATH)) {
      const raw = fs.readFileSync(LOG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      const all = Array.isArray(parsed) ? parsed : [];
      const coherent = all.filter(isCoherent);
      const dropped = all.length - coherent.length;
      signals = dedupeBySession(coherent);
      const deduped = coherent.length - signals.length;
      indexById = new Map(signals.map(s => [s.id, s]));
      if (dropped || deduped) dirty = true;   // rewrite without them
      console.log(`  ✓ Loaded ${signals.length} signals from log`
        + (dropped ? ` (dropped ${dropped} that closed before they opened)` : '')
        + (deduped ? ` (merged ${deduped} duplicate record(s) of the same idea)` : ''));
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
      // The session index has to be built BEFORE the seed is merged, not after.
      // Deduping the file drops the surplus copies of an idea, and those copies
      // are in the shipped seed too — matching on id alone re-admitted every one
      // of them, putting the file straight back to the count it started at.
      const seenSessions = new Set(signals.map(sessionKeyOf));
      for (const rec of Array.isArray(seed) ? seed : []) {
        if (!isCoherent(rec) || indexById.has(rec.id)) continue;
        const k = sessionKeyOf(rec);
        if (seenSessions.has(k)) continue;
        seenSessions.add(k);
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

  indexBySession = new Map(signals.map(s => [sessionKeyOf(s), s]));
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
  // Keep the session index in step, or a restore arriving later would not see
  // this record and would admit its own copy of the same idea beside it.
  indexBySession.set(sessionKeyOf(record), record);
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
  let added = 0, updated = 0, rejected = 0, duplicates = 0;

  for (const rec of incoming) {
    if (!isCoherent(rec)) { rejected++; continue; }
    // Same idea, different id. A client mirror written before a restart carries
    // its own record of a signal this store logged again afterwards; matching
    // on id alone let both in. Match on the idea — ticker, direction, session —
    // exactly as logSignal does.
    const existing = indexById.get(rec.id) || indexBySession.get(sessionKeyOf(rec));
    if (!existing) {
      signals.push(rec);
      indexById.set(rec.id, rec);
      indexBySession.set(sessionKeyOf(rec), rec);
      added++;
      continue;
    }
    // Conflict: prefer the CLOSED record — a resolved outcome beats an open one
    if (existing.status !== 'CLOSED' && rec.status === 'CLOSED') {
      const keptId = existing.id;
      Object.assign(existing, rec, { id: keptId });   // keep the id already indexed
      updated++;
    } else {
      duplicates++;
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
  if (rejected || duplicates) {
    console.log(`  ⚠ Restore rejected ${rejected} incoherent, ${duplicates} duplicate record(s)`);
  }
  return { added, updated, rejected, duplicates, total: signals.length };
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
