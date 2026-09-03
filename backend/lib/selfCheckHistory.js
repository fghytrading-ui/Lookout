// Memory for the self-check.
//
// The checks in selfCheck.js are good at answering "is anything wrong right
// now". They could not answer "has this been wrong before", because nothing
// kept the answers: every run was reported to whoever was looking and then
// thrown away, and the check only ran at all when somebody opened the page.
// A fault that comes and goes — the crypto board thinning out at a particular
// hour, a feed that drops for twenty minutes each morning, a check that has
// quietly failed for a week — looked identical to a one-off, and a fault
// nobody happened to be watching for did not exist.
//
// This keeps the verdicts so patterns can be seen: how often a check fails,
// whether it is failing now, how long it has been in that state, and — the
// one that matters most — whether something that was fixed has come back.
// Recurrence is the signal that a fix treated a symptom, and it is invisible
// without history. Two of the faults found on 2026-08-31 were exactly that
// shape: records that close before they open, fixed on 2026-08-22 and back on
// the live site nine days later.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'selfcheck-log.json');

// Roughly a fortnight of four-hourly runs across two markets, which is enough
// to see a weekly rhythm without the file growing without limit.
const MAX_RUNS = 400;

let runs = null;

function load() {
  if (runs) return runs;
  try {
    const parsed = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
    runs = Array.isArray(parsed) ? parsed : [];
  } catch { runs = []; }
  return runs;
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOG_PATH, JSON.stringify(runs.slice(-MAX_RUNS)), 'utf8');
  } catch { /* history is a diagnostic; never break the server over it */ }
}

/** Record one self-check result. Stores verdicts only, not the prose. */
export function recordRun(result, market) {
  if (!result?.checks) return;
  load();
  runs.push({
    at: Date.now(),
    market,
    status: result.status,
    checks: result.checks.map(c => ({ id: c.id, status: c.status }))
  });
  if (runs.length > MAX_RUNS) runs = runs.slice(-MAX_RUNS);
  persist();
}

const BAD = new Set(['fail', 'warn']);

/**
 * What the history says about each check.
 *
 * `recurrences` counts how many times a check has gone from healthy back to
 * failing. One is a fault that came back; several is a fix that never held.
 */
export function getCheckHistory(market = null) {
  load();
  const scoped = market ? runs.filter(r => r.market === market) : runs;
  if (!scoped.length) return { runs: 0, since: null, checks: [] };

  const byId = new Map();
  for (const run of scoped) {
    for (const c of run.checks) {
      if (!byId.has(c.id)) byId.set(c.id, []);
      byId.get(c.id).push({ at: run.at, status: c.status });
    }
  }

  const checks = [];
  for (const [id, series] of byId) {
    series.sort((a, b) => a.at - b.at);
    const seen = series.filter(s => s.status !== 'skip');
    const bad = seen.filter(s => BAD.has(s.status));
    let recurrences = 0, healthySince = false;
    for (const s of seen) {
      if (BAD.has(s.status)) { if (healthySince) recurrences++; healthySince = false; }
      else healthySince = true;
    }
    // How long the current state has held.
    let streak = 0;
    for (let i = seen.length - 1; i >= 0; i--) {
      if (BAD.has(seen[i].status) === BAD.has(seen[seen.length - 1].status)) streak++;
      else break;
    }
    const last = seen[seen.length - 1];
    checks.push({
      id,
      runs: seen.length,
      failures: bad.length,
      failRate: seen.length ? bad.length / seen.length : 0,
      failingNow: last ? BAD.has(last.status) : false,
      streak,
      recurrences,
      lastFailAt: bad.length ? bad[bad.length - 1].at : null,
      firstFailAt: bad.length ? bad[0].at : null
    });
  }

  checks.sort((a, b) =>
    (b.failingNow - a.failingNow) || (b.recurrences - a.recurrences) || (b.failRate - a.failRate));

  return { runs: scoped.length, since: scoped[0].at, checks };
}

/**
 * The things worth saying out loud, in plain words.
 *
 * Deliberately quiet: a check that failed once and recovered is noise, and a
 * panel that lists every blip trains you to stop reading it. Only persistence
 * and recurrence earn a line.
 */
export function getFaultPatterns(market = null) {
  const { runs: n, checks } = getCheckHistory(market);
  if (n < 4) return { runs: n, patterns: [], summary: 'Not enough history yet to see patterns' };

  const patterns = [];
  for (const c of checks) {
    if (c.recurrences >= 2) {
      patterns.push({ id: c.id, severity: 'recurring', runs: c.runs,
        detail: `has come back ${c.recurrences} times after looking fixed — the cause is probably still there` });
    } else if (c.failingNow && c.streak >= 3) {
      patterns.push({ id: c.id, severity: 'persistent', runs: c.runs,
        detail: `failing for ${c.streak} checks in a row, not a blip` });
    } else if (c.recurrences === 1 && c.failingNow) {
      patterns.push({ id: c.id, severity: 'returned', runs: c.runs,
        detail: 'was fixed and has come back' });
    } else if (!c.failingNow && c.failRate > 0.25 && c.failures >= 3) {
      patterns.push({ id: c.id, severity: 'flapping', runs: c.runs,
        detail: `fails ${Math.round(c.failRate * 100)}% of the time but looks fine right now — intermittent` });
    }
  }
  patterns.sort((a, b) =>
    ['recurring', 'returned', 'persistent', 'flapping'].indexOf(a.severity) -
    ['recurring', 'returned', 'persistent', 'flapping'].indexOf(b.severity));

  return {
    runs: n,
    patterns,
    summary: patterns.length
      ? `${patterns.length} pattern${patterns.length === 1 ? '' : 's'} across ${n} checks`
      : `Nothing recurring across ${n} checks`
  };
}
