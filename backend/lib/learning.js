// Learning from tracked outcomes.
//
// Every calibration change made so far came from a human exporting the signal
// log and running statistics by hand. That works, but it only happens when
// somebody goes looking — and the faults it found had been costing money for
// weeks before anyone did. The analysis is mechanical; it should run itself.
//
// The danger is equally real. Twice during that manual pass an obvious-looking
// finding turned out to be noise — the board ranking, and the reviewer's
// PASS/CAUTION verdict — and both were caught only by a significance test. A
// naive tuner would have shipped both. Chasing recent performance is the
// classic way an automated system destroys a strategy that was working.
//
// So the guardrails are the design, not a footnote:
//
//   1. MINIMUM EVIDENCE   nothing moves under MIN_SAMPLE resolved trades in
//                         the bucket being judged.
//   2. SIGNIFICANCE       a difference must clear |z| > 1.96 against the
//                         breakeven rate implied by its own reward:risk.
//   3. BOUNDED            any parameter may drift at most MAX_DRIFT from the
//                         hand-set baseline, and by at most STEP per run, so
//                         one unusual fortnight cannot swing the system.
//   4. AUDITED            every adjustment records its evidence, sample size
//                         and timestamp, and can be reverted.
//   5. HYSTERESIS         a change must beat the current setting by more than
//                         MIN_EDGE to be worth making, so parameters do not
//                         oscillate on noise.
//
// What it learns is deliberately narrow: where to put the target, and which
// volatility band to accept. Both are measurable directly from excursion data
// with a clear causal story. It does not touch direction, entry logic or the
// reviewer — those are judgement, not arithmetic.
import fs from 'fs';
import path from 'path';
import { getAllSignals } from './signalLog.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'learning-state.json');

const MIN_SAMPLE = 60;      // resolved trades before anything moves
const MAX_DRIFT  = 0.30;    // furthest a parameter may sit from its baseline
const STEP       = 0.10;    // furthest it may move in one run
const MIN_EDGE   = 0.05;    // R per trade a change must beat the incumbent by
const Z_CRIT     = 1.96;

// Hand-set starting points. Learning moves away from these within MAX_DRIFT;
// it never loses them, so the system can always be put back.
const BASELINE = {
  stocks:      { targetR: 1.5, maxStopPct: 0.040 },
  crypto:      { targetR: 2.4, maxStopPct: 0.060 },
  commodities: { targetR: 2.4, maxStopPct: 0.060 },
  forex:       { targetR: 2.4, maxStopPct: 0.020 }
};

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { params: {}, history: [], updatedAt: null }; }
}
function writeState(s) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch { /* learning is an optimisation; never break the scan over it */ }
}

/** Current parameters for a market — learned value if one exists, else baseline. */
export function getLearnedParams(market) {
  const base = BASELINE[market] || BASELINE.stocks;
  const learned = readState().params?.[market];
  return { ...base, ...(learned || {}) };
}

// Trades reduced to what the simulation needs: how far price ran in each
// direction, in absolute price terms, so any target can be tested against it.
function excursions(market) {
  return getAllSignals()
    .filter(s => s.status === 'CLOSED' && s.market === market)
    .map(s => {
      const { entry, sl, tp, mfePct, maePct } = s;
      if (!entry || !sl || !tp || mfePct == null || maePct == null) return null;
      const risk = Math.abs(entry - sl), tpd = Math.abs(tp - entry);
      if (risk <= 0 || tpd <= 0) return null;
      // Where it was actually closed, in R. Needed for trades that reached
      // neither the first scale nor the stop: they were being counted as a
      // flat zero when in the tracked record they settled at +0.50R on
      // average, so every candidate target was scored as if its slow winners
      // had been worth nothing.
      let settleR = 0;
      if (Number.isFinite(s.closePrice)) {
        const dir = s.direction === 'SHORT' ? -1 : 1;
        settleR = ((s.closePrice - entry) * dir) / risk;
      }
      return { mfe: (mfePct / 100) * tpd, mae: (maePct / 100) * risk, risk,
               stopPct: risk / entry, outcome: s.outcome, settleR };
    })
    .filter(Boolean);
}

// Expectancy in R for a given target, under the real scale-out plan:
// a third at 30% of TP1 with the stop then to breakeven, a third at TP1,
// the runner at 1.2x TP1.
function expectancy(rows, targetR) {
  if (!rows.length) return 0;
  let tot = 0;
  for (const r of rows) {
    const tp0 = 0.30 * targetR * r.risk, tp1 = targetR * r.risk, tp2 = 1.2 * targetR * r.risk;
    if      (r.mfe >= tp2)  tot += (0.3 * targetR) / 3 + targetR / 3 + (1.2 * targetR) / 3;
    else if (r.mfe >= tp1)  tot += (0.3 * targetR) / 3 + targetR / 3;
    else if (r.mfe >= tp0)  tot += (0.3 * targetR) / 3;
    else if (r.mae >= r.risk) tot += -1.0;
    else tot += r.settleR ?? 0;   // reached neither: settles where it closed
  }
  return tot / rows.length;
}

// Is this bucket's win rate distinguishable from the breakeven its own
// reward:risk demands? Used to decide whether a volatility band is genuinely
// unprofitable rather than merely unlucky.
function significance(rows, targetR) {
  const n = rows.length;
  if (!n) return 0;
  const wins = rows.filter(r => r.mfe >= targetR * r.risk).length;
  const be = 1 / (1 + targetR);
  return (wins - n * be) / Math.sqrt(n * be * (1 - be));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Analyse one market and decide whether anything should move.
 * Returns the finding whether or not it is applied, so the reasoning is
 * visible even when the guardrails refuse it.
 */
export function analyseMarket(market) {
  const base = BASELINE[market] || BASELINE.stocks;
  const current = getLearnedParams(market);
  const rows = excursions(market);
  const out = { market, sample: rows.length, current, baseline: base, applied: false, findings: [] };

  if (rows.length < MIN_SAMPLE) {
    out.reason = `${rows.length} resolved trades — needs ${MIN_SAMPLE} before adjusting`;
    return out;
  }

  // ── target distance ────────────────────────────────────────────────
  const lo = base.targetR * (1 - MAX_DRIFT), hi = base.targetR * (1 + MAX_DRIFT);
  let best = { targetR: current.targetR, exp: expectancy(rows, current.targetR) };
  for (let t = lo; t <= hi + 1e-9; t += 0.05) {
    const e = expectancy(rows, t);
    if (e > best.exp) best = { targetR: +t.toFixed(2), exp: e };
  }
  const curExp = expectancy(rows, current.targetR);
  if (best.targetR !== current.targetR && best.exp - curExp > MIN_EDGE) {
    // move toward the optimum, never straight to it
    const step = clamp(best.targetR - current.targetR, -STEP, STEP);
    const next = +clamp(current.targetR + step, lo, hi).toFixed(2);
    out.findings.push({
      parameter: 'targetR', from: current.targetR, to: next, optimum: best.targetR,
      evidence: `optimum ${best.targetR}R returns ${best.exp.toFixed(3)}R against ${curExp.toFixed(3)}R at the current ${current.targetR}R, over ${rows.length} trades`,
      accepted: true
    });
    out.next = { ...out.next, targetR: next };
  } else {
    out.findings.push({
      parameter: 'targetR', from: current.targetR, to: current.targetR,
      evidence: best.targetR === current.targetR
        ? `already at the optimum for ${rows.length} trades`
        : `best alternative ${best.targetR}R gains only ${(best.exp - curExp).toFixed(3)}R, under the ${MIN_EDGE}R needed to justify moving`,
      accepted: false
    });
  }

  // ── volatility ceiling ─────────────────────────────────────────────
  // Tested in 0.5% steps: is there a band above which trades stop paying,
  // and is that conclusion significant rather than a thin unlucky bucket?
  const ceilLo = base.maxStopPct * (1 - MAX_DRIFT), ceilHi = base.maxStopPct * (1 + MAX_DRIFT);
  let bestCeil = { pct: current.maxStopPct, total: null };
  for (let c = ceilLo; c <= ceilHi + 1e-9; c += 0.0025) {
    const kept = rows.filter(r => r.stopPct <= c);
    if (kept.length < MIN_SAMPLE * 0.5) continue;
    const total = expectancy(kept, current.targetR) * kept.length;   // total R, not per-trade
    if (bestCeil.total === null || total > bestCeil.total) bestCeil = { pct: +c.toFixed(4), total, n: kept.length };
  }
  const curKept = rows.filter(r => r.stopPct <= current.maxStopPct);
  const curTotal = expectancy(curKept, current.targetR) * curKept.length;
  const excluded = rows.filter(r => r.stopPct > bestCeil.pct);
  const z = excluded.length >= 20 ? significance(excluded, current.targetR) : 0;

  if (bestCeil.pct !== current.maxStopPct && bestCeil.total > curTotal + 2 && Math.abs(z) > Z_CRIT) {
    const step = clamp(bestCeil.pct - current.maxStopPct, -0.005, 0.005);
    const next = +clamp(current.maxStopPct + step, ceilLo, ceilHi).toFixed(4);
    out.findings.push({
      parameter: 'maxStopPct', from: current.maxStopPct, to: next, optimum: bestCeil.pct,
      evidence: `ceiling at ${(bestCeil.pct*100).toFixed(1)}% returns ${bestCeil.total.toFixed(1)}R total against ${curTotal.toFixed(1)}R now; the excluded band is z=${z.toFixed(2)}`,
      accepted: true
    });
    out.next = { ...out.next, maxStopPct: next };
  } else {
    out.findings.push({
      parameter: 'maxStopPct', from: current.maxStopPct, to: current.maxStopPct,
      evidence: Math.abs(z) <= Z_CRIT && bestCeil.pct !== current.maxStopPct
        ? `a ${(bestCeil.pct*100).toFixed(1)}% ceiling looks better but the excluded band is only z=${z.toFixed(2)} — not distinguishable from noise`
        : `current ceiling holds up over ${rows.length} trades`,
      accepted: false
    });
  }
  return out;
}

/** Analyse every market. `apply` writes the accepted changes. */
export function runLearning({ apply = false } = {}) {
  const markets = Object.keys(BASELINE);
  const results = markets.map(analyseMarket);
  if (apply) {
    const state = readState();
    state.params = state.params || {};
    state.history = state.history || [];
    for (const r of results) {
      if (!r.next) continue;
      state.params[r.market] = { ...(state.params[r.market] || {}), ...r.next };
      state.history.push({
        at: new Date().toISOString(), market: r.market, sample: r.sample,
        changes: r.findings.filter(f => f.accepted)
      });
      r.applied = true;
    }
    state.history = state.history.slice(-200);
    state.updatedAt = new Date().toISOString();
    // Trades signalled before a parameter moved were produced by different
    // settings, so the goal tracker must not pool them with what came after.
    // Stamping the moment here means that boundary maintains itself; a
    // hand-kept date would silently go stale the first time this applied
    // something on its own.
    if (results.some(r => r.applied)) state.lastChangeAt = state.updatedAt;
    writeState(state);
  }
  return {
    ranAt: new Date().toISOString(),
    applied: results.some(r => r.applied),
    guardrails: { minSample: MIN_SAMPLE, maxDrift: MAX_DRIFT, step: STEP, minEdge: MIN_EDGE, zCritical: Z_CRIT },
    markets: results
  };
}

/** Undo all learning, returning every market to its hand-set baseline. */
export function resetLearning() {
  writeState({ params: {}, history: readState().history || [], updatedAt: new Date().toISOString(), resetAt: new Date().toISOString() });
  return { reset: true, baseline: BASELINE };
}

export function getLearningState() { return readState(); }
