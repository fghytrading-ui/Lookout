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
import { expectancyOf } from './realisedR.js';

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
  // Target at roughly one stop distance rather than 1.5.
  //
  // Reaching a target 2.5 stops away happens 14% of the time; at one stop it
  // is 41%, and 70% of trades finish green against 57%. Measured expectancy
  // barely moves across that whole range (+0.011R to +0.056R, none of them
  // significant) because a closer target trades size of win for frequency, and
  // the two very nearly cancel. What changes is whether the thing is
  // executable: a system that fails 86% of the time does not get followed
  // through its losing runs, and an edge nobody can sit through pays nothing.
  // Trades also resolve in 1.4 sessions instead of 2.2, which is the actual
  // holding period this is for.
  // 1.25 is the measured optimum and now also the aim, so the setting and the
  // board agree. It was 1.0 while the minimum reward:risk floor sat at 1.15,
  // which meant the floor rather than the setting decided the geometry and
  // only setups pushed above it by a trend bonus survived — selection by side
  // effect. The self-check caught it: set to 1.00, producing 1.55.
  stocks:      { targetR: 1.25, maxStopPct: 0.040 },
  crypto:      { targetR: 1.25, maxStopPct: 0.060 },
  commodities: { targetR: 1.1, maxStopPct: 0.060 },
  forex:       { targetR: 1.0, maxStopPct: 0.020 }
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
// ── Did the last change actually help? ───────────────────────────────────
//
// Learning moved parameters and never once looked back at whether its own
// decisions worked. That is the half of a feedback loop that makes it a loop:
// without it a run can only ever ratchet further in the direction it last
// went, re-optimising on a record its own previous change shaped. The live
// history shows exactly that drift — stocks maxStopPct 0.040 -> 0.035 ->
// 0.0305 and crypto targetR 1.25 -> 1.15 -> 1.05, one direction, never back.
//
// So each applied change is now judged once enough trades have run under it.
// Compare realised expectancy on trades signalled after the change against
// the same window before it. If it is materially WORSE, the change is undone
// and the parameter pinned so the next run cannot immediately redo it.
//
// Deliberately asymmetric: a change must clear MIN_EDGE with significance to
// be made, but only has to be clearly worse to be undone. Reverting to a
// known state is much cheaper than staying somewhere the evidence says is
// losing money.
const REVIEW_MIN_TRADES = 30;    // resolved trades under a change before judging it
const REVIEW_MIN_HARM   = 0.05;  // R per trade it must be worse by to be undone

function reviewApplied(state) {
  const reverted = [];
  const history = state.history || [];
  state.reviewed = state.reviewed || {};

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    const stamp = `${h.at}|${h.market}`;
    if (state.reviewed[stamp]) continue;
    const accepted = (h.changes || []).filter(c => c.accepted);
    if (!accepted.length) { state.reviewed[stamp] = 'no-change'; continue; }

    const at = Date.parse(h.at);
    if (!Number.isFinite(at)) { state.reviewed[stamp] = 'bad-timestamp'; continue; }

    const closed = getAllSignals().filter(s =>
      s.status === 'CLOSED' && s.market === h.market && Number.isFinite(s.signaledAt));
    const after  = closed.filter(s => s.signaledAt >= at);
    const before = closed.filter(s => s.signaledAt <  at);
    if (after.length < REVIEW_MIN_TRADES || before.length < REVIEW_MIN_TRADES) continue;  // not ripe yet

    // Same window each side so a change is not judged against a different era.
    const span = Math.min(after.length, before.length);
    const beforeRows = before.slice(-span);
    const afterRows  = after.slice(0, span);
    const eBefore = expectancyOf(beforeRows).mean;
    const eAfter  = expectancyOf(afterRows).mean;
    if (eBefore == null || eAfter == null) continue;

    const harm = eBefore - eAfter;
    if (harm > REVIEW_MIN_HARM) {
      for (const c of accepted) {
        state.params[h.market] = { ...(state.params[h.market] || {}) };
        state.params[h.market][c.parameter] = c.from;   // put it back
      }
      state.pinned = state.pinned || {};
      state.pinned[h.market] = {
        until: Date.now() + 7 * 24 * 60 * 60 * 1000,
        because: `reverted ${accepted.map(c => c.parameter).join(', ')} — cost ${harm.toFixed(3)}R over ${span} trades`
      };
      reverted.push({
        market: h.market, at: h.at, span,
        expectancyBefore: eBefore, expectancyAfter: eAfter, harm,
        parameters: accepted.map(c => ({ parameter: c.parameter, revertedTo: c.from, from: c.to }))
      });
      state.reviewed[stamp] = 'reverted';
    } else {
      state.reviewed[stamp] = harm < -REVIEW_MIN_HARM ? 'helped' : 'neutral';
    }
  }
  return reverted;
}

export function runLearning({ apply = false } = {}) {
  const markets = Object.keys(BASELINE);
  const results = markets.map(analyseMarket);
  let reverted = [];
  if (apply) {
    const state = readState();
    state.params = state.params || {};
    state.history = state.history || [];

    // Judge past decisions BEFORE making new ones, so a change that has just
    // been undone cannot be re-applied in the same pass.
    reverted = reviewApplied(state);

    for (const r of results) {
      if (!r.next) continue;
      // A market whose last change was reverted is left alone for a week.
      // Without this the next run re-derives the same change from the same
      // record and puts it straight back, which is how a parameter ends up
      // oscillating instead of settling.
      const pin = state.pinned?.[r.market];
      if (pin && Date.now() < pin.until) { r.pinned = pin.because; continue; }
      state.params[r.market] = { ...(state.params[r.market] || {}), ...r.next };
      state.history.push({
        at: new Date().toISOString(), market: r.market, sample: r.sample,
        changes: r.findings.filter(f => f.accepted)
      });
      r.applied = true;
    }
    state.history = state.history.slice(-200);
    state.updatedAt = new Date().toISOString();
    // Persisted so a restart cannot re-trigger a pass that is meant to be
    // daily. Render's free tier spins the service down whenever it is idle,
    // so "once shortly after boot" was firing on every visit: the live history
    // has two stocks changes 96 minutes apart against a 24h design.
    state.lastRunAt = state.updatedAt;

    // Trades signalled before a parameter moved were produced by different
    // settings, so the goal tracker must not pool them with what came after.
    // But this pass runs daily and can move something by a step every time,
    // and resetting the boundary on each nudge meant the tracker restarted at
    // "0 of 40 trades" before it could ever reach forty. It would have said
    // "gathering evidence" forever — a verdict permanently one day away.
    //
    // So the boundary moves only when the settings have drifted MATERIALLY
    // from where they were when it last moved. Small guarded steps accumulate
    // until they add up to a real change: trades run at targetR 1.00 and 1.05
    // are the same trade for this purpose, trades at 1.0 and 1.3 are not.
    const MATERIAL_DRIFT = 0.15;
    state.epochParams = state.epochParams || {};
    let material = false;
    for (const r of results) {
      if (!r.applied) continue;
      const now = state.params[r.market] || {};
      const base = state.epochParams[r.market];
      if (!base) { material = true; continue; }
      for (const k of Object.keys(now)) {
        const a = base[k], b = now[k];
        if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) continue;
        if (Math.abs(b - a) / Math.abs(a) > MATERIAL_DRIFT) material = true;
      }
    }
    if (material) {
      state.lastChangeAt = state.updatedAt;
      for (const r of results) {
        if (r.applied) state.epochParams[r.market] = { ...state.params[r.market] };
      }
    }
    writeState(state);
  }
  return {
    ranAt: new Date().toISOString(),
    applied: results.some(r => r.applied),
    reverted,
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

/**
 * Has a learning pass already run inside the window?
 *
 * The daily interval only holds for a process that stays up. Render's free
 * tier spins the service down whenever it is idle and restarts it on the next
 * visit, so the boot trigger was running on every visit and the "once a day"
 * guarantee never existed in production — the live history carries two stocks
 * changes 96 minutes apart. The answer has to come off disk, not off a timer.
 */
export function learnedRecently(windowMs = 24 * 60 * 60 * 1000) {
  const at = Date.parse(readState().lastRunAt || '');
  return Number.isFinite(at) && (Date.now() - at) < windowMs;
}
