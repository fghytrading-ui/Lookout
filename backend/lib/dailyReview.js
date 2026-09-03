// The software's own end-of-day review.
//
// Everything needed to judge this system already existed and none of it was
// ever put side by side: the goal assessment knew whether it was making money,
// learning knew what it had changed, the self-check knew what was broken, the
// signal log knew how much it had produced. Four separate answers, each
// truthful, none of them ever compared against yesterday's. So a slow
// degradation — volume drying up over a week, expectancy sliding after a
// parameter moved, a feed quietly dropping out — was only visible to somebody
// who happened to remember what the numbers looked like last time.
//
// This takes one dated snapshot a day, compares it with the previous one, and
// says in plain words what got better, what got worse, and what was changed.
// It writes nothing back into the trading logic: learning already owns that,
// and it is validated out-of-sample. This is the record of what happened.
//
// Deliberately quiet. A review that lists every wobble is a review nobody
// reads, and this project has already learned that the expensive way — a
// revert mechanism was built and deleted on 2026-09-03 because at a 1.17R
// trade spread it fired on noise 45% of the time. So a metric has to move by
// more than its own noise before this calls it a change, and on a normal day
// the honest output is "nothing material".
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllSignals } from './signalLog.js';
import { expectancyOf } from './realisedR.js';
import { assessGoals } from './goals.js';
import { getLearningState } from './learning.js';
import { getFaultPatterns } from './selfCheckHistory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const JOURNAL = path.join(DATA_DIR, 'daily-review.json');

const DAY = 24 * 60 * 60 * 1000;
const KEEP = 120;              // roughly four months of entries
const MIN_TRADES = 20;         // below this a window says nothing worth saying

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(JOURNAL, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function write(entries) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(JOURNAL, JSON.stringify(entries.slice(-KEEP), null, 2), 'utf8');
  } catch { /* a diary is not worth breaking the server for */ }
}

/** Trades that resolved inside a window, per market and overall. */
function windowStats(from, to) {
  const closed = getAllSignals().filter(s =>
    s.status === 'CLOSED' && Number.isFinite(s.closedAt) &&
    s.closedAt >= from && s.closedAt < to);
  const stats = (rows) => {
    if (rows.length < MIN_TRADES) return { n: rows.length, expectancy: null, se: null };
    const e = expectancyOf(rows);
    return { n: e.n, expectancy: e.mean, se: e.se };
  };
  const byMarket = {};
  for (const m of ['stocks', 'crypto', 'commodities', 'forex']) {
    byMarket[m] = stats(closed.filter(s => s.market === m));
  }
  return { all: stats(closed), byMarket };
}

/**
 * A change is only a change if it clears the noise around it.
 *
 * Comparing two expectancies without this is how the deleted revert
 * mechanism ended up firing on coin flips. Both windows carry a standard
 * error; the difference carries their combination, and anything inside that
 * is weather rather than news.
 */
function movedMaterially(now, before) {
  if (now?.expectancy == null || before?.expectancy == null) return null;
  if (now.se == null || before.se == null) return null;
  const delta = now.expectancy - before.expectancy;
  const se = Math.sqrt(now.se ** 2 + before.se ** 2);
  if (!(se > 0)) return null;
  return Math.abs(delta) > se ? { delta, se } : null;
}

/** Build today's entry. Pure — writes nothing. */
export function buildReview(now = Date.now()) {
  const today = windowStats(now - DAY, now);
  const week = windowStats(now - 7 * DAY, now);
  const priorWeek = windowStats(now - 14 * DAY, now - 7 * DAY);

  const signals = getAllSignals();
  const signalledToday = signals.filter(s => s.signaledAt >= now - DAY).length;
  const open = signals.filter(s => s.status !== 'CLOSED').length;

  let goals = null;
  try { goals = assessGoals(); } catch { /* reported as unavailable */ }

  const learn = getLearningState();
  const changedToday = (learn.history || []).filter(h => {
    const t = Date.parse(h.at);
    return Number.isFinite(t) && t >= now - DAY && (h.changes || []).some(c => c.accepted);
  });

  let faults = { patterns: [] };
  try { faults = getFaultPatterns(); } catch { /* ditto */ }

  return {
    at: now,
    date: new Date(now).toISOString().slice(0, 10),
    produced: { signalledToday, open, resolvedToday: today.all.n },
    today: today.all,
    week: week.all,
    priorWeek: priorWeek.all,
    byMarket: week.byMarket,
    goals: goals ? { status: goals.status, headline: goals.headline,
                     expectancy: goals.current?.expectancy ?? null, n: goals.current?.n ?? null } : null,
    params: learn.params || {},
    changes: changedToday.map(h => ({
      market: h.market,
      changes: (h.changes || []).filter(c => c.accepted)
        .map(c => ({ parameter: c.parameter, from: c.from, to: c.to, evidence: c.evidence }))
    })),
    faults: faults.patterns || []
  };
}

/**
 * Turn an entry, and the one before it, into plain sentences.
 *
 * Split into good / bad / changed / watch so it can be read in five seconds.
 * Anything it cannot say honestly it does not say.
 */
export function narrate(entry, previous) {
  const good = [], bad = [], changed = [], watch = [];

  // What it produced.
  if (entry.produced.signalledToday === 0) {
    watch.push('No signals produced in the last 24 hours');
  } else {
    good.push(`${entry.produced.signalledToday} signals produced, ${entry.produced.resolvedToday} resolved`);
  }

  // Week against the week before — the only comparison with enough trades in
  // it to mean anything. A single day is almost always inside the noise.
  const move = movedMaterially(entry.week, entry.priorWeek);
  if (move) {
    const line = `Expectancy ${move.delta > 0 ? 'up' : 'down'} ${Math.abs(move.delta).toFixed(3)}R `
      + `on the week (${entry.week.n} trades against ${entry.priorWeek.n})`;
    (move.delta > 0 ? good : bad).push(line);
  } else if (entry.week.expectancy != null && entry.priorWeek.expectancy != null) {
    good.push(`Week on week steady at ${entry.week.expectancy.toFixed(3)}R — no move beyond the noise`);
  } else if (entry.week.n < MIN_TRADES) {
    watch.push(`Only ${entry.week.n} trades resolved this week — too few to judge`);
  }

  // Goals, stated once, without repeating the arithmetic above.
  if (entry.goals?.status && entry.goals.status !== 'ok') {
    bad.push(`Goals: ${entry.goals.headline}`);
  } else if (entry.goals?.status === 'ok') {
    good.push(`Goals: ${entry.goals.headline}`);
  }

  // What the software changed about itself.
  for (const c of entry.changes) {
    for (const p of c.changes) {
      changed.push(`${c.market} ${p.parameter} ${p.from} → ${p.to}`);
    }
  }
  if (!entry.changes.length && previous) {
    const sameParams = JSON.stringify(entry.params) === JSON.stringify(previous.params);
    if (sameParams) changed.push('Settings unchanged');
  }

  // Faults worth acting on — recurrence, not blips.
  for (const f of entry.faults) {
    watch.push(`${f.id}: ${f.detail}`);
  }

  // Volume drift, which is how the board quietly stops working.
  if (previous?.produced && entry.produced.signalledToday === 0 && previous.produced.signalledToday === 0) {
    watch.push('Second day running with no signals — check the filters and feeds');
  }

  return { good, bad, changed, watch };
}

/**
 * Write today's entry if one has not been written today. Returns the entry
 * and its narration either way, so a caller can always show something.
 *
 * Idempotent by calendar date rather than by elapsed time: a free-tier restart
 * must not produce a second entry for the same day, which is the same fault
 * that had learning re-running on every boot.
 */
export function runDailyReview({ force = false } = {}) {
  const entries = read();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const existing = entries.find(e => e.date === today);
  if (existing && !force) {
    const idx = entries.indexOf(existing);
    return { entry: existing, narration: narrate(existing, entries[idx - 1]), written: false };
  }

  const entry = buildReview(now);
  const previous = entries.filter(e => e.date !== today).slice(-1)[0] || null;
  const kept = entries.filter(e => e.date !== today);
  kept.push(entry);
  write(kept);
  return { entry, narration: narrate(entry, previous), written: true };
}

/** The journal, newest last. */
export function getJournal(limit = 30) {
  return read().slice(-limit);
}

/** Has a review already been written for today? Survives restarts. */
export function reviewedToday() {
  const today = new Date().toISOString().slice(0, 10);
  return read().some(e => e.date === today);
}
