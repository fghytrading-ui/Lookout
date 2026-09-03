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

// ── Walk-forward validation ──────────────────────────────────────────────
//
// Picking the target that would have been best over the whole record is
// fitting to the record. That is the mistake this project has made before and
// written down: every strategy tested looked strong in-sample and died out of
// it. So a candidate is chosen on older trades and scored on newer ones it has
// never seen, at four cut points, and only adopted if it keeps winning.
//
// Consistency is the evidence, not size. Four independent test windows all
// favouring the same value is a far stronger claim than one large in-sample
// gain, and it is why the floor here (MIN_EDGE_OOS) is lower than the
// in-sample MIN_EDGE it replaces: a 0.04R edge that holds in every window is
// worth more than a 0.06R edge measured once on the data that chose it.
//
// Measured on the stock record when this was written: every one of the four
// splits independently chose 1.08 over the 1.25 in force, and it won
// out-of-sample in all four by +0.036R to +0.056R. The old in-sample gate
// scored that same change at 0.016R and refused it — the guardrail was
// blocking a real improvement because it was measuring it the wrong way.
const WF_SPLITS   = [0.5, 0.6, 0.7, 0.8];
const WF_MIN_TEST = 30;     // trades a test window needs to count
const WF_AGREE    = 0.75;   // share of splits that must pick the same value
const MIN_EDGE_OOS = 0.02;  // R the median out-of-sample gain must clear

function walkForwardTarget(rows, currentR, lo, hi) {
  const picks = [], gains = [];
  for (const frac of WF_SPLITS) {
    const cut = Math.floor(rows.length * frac);
    const train = rows.slice(0, cut), test = rows.slice(cut);
    if (train.length < MIN_SAMPLE || test.length < WF_MIN_TEST) continue;
    let best = { t: currentR, e: -Infinity };
    for (let t = lo; t <= hi + 1e-9; t += 0.05) {
      const e = expectancy(train, t);
      if (e > best.e) best = { t: +t.toFixed(2), e };
    }
    picks.push(best.t);
    gains.push(expectancy(test, best.t) - expectancy(test, currentR));
  }
  // Two usable windows is enough BECAUSE agreement is already unanimous at
  // that count: WF_AGREE rounds the requirement up, so two splits must both
  // pick the same value and both win. Demanding three stalled crypto
  // completely — at 106 trades only two splits leave a 60-trade train and a
  // 30-trade test, so the market would have stopped learning for weeks while
  // holding evidence that two independent windows agreed on.
  if (picks.length < 2) return null;          // too little history to validate

  const counts = new Map();
  for (const p of picks) counts.set(p, (counts.get(p) || 0) + 1);
  const [pick, votes] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const sorted = [...gains].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    pick, splits: picks.length,
    agreement: votes / picks.length,
    wins: gains.filter(g => g > 0).length,
    median, gains
  };
}

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
  const wf = walkForwardTarget(rows, current.targetR, lo, hi);
  const needWins = Math.ceil(WF_AGREE * (wf?.splits ?? 0));
  const validated = wf
    && wf.pick !== current.targetR
    && wf.agreement >= WF_AGREE
    && wf.wins >= needWins
    && wf.median > MIN_EDGE_OOS;

  if (validated) {
    // move toward the validated value, never straight to it
    const step = clamp(wf.pick - current.targetR, -STEP, STEP);
    const next = +clamp(current.targetR + step, lo, hi).toFixed(2);
    out.findings.push({
      parameter: 'targetR', from: current.targetR, to: next, optimum: wf.pick,
      evidence: `${wf.pick}R chosen on older trades and tested on newer ones it had not seen: `
        + `won ${wf.wins} of ${wf.splits} splits against the current ${current.targetR}R, `
        + `median out-of-sample gain ${wf.median.toFixed(3)}R over ${rows.length} trades`,
      validation: { splits: wf.splits, wins: wf.wins, agreement: wf.agreement, medianOOS: wf.median },
      accepted: true
    });
    out.next = { ...out.next, targetR: next };
  } else {
    let why;
    if (!wf) {
      why = `${rows.length} trades is too little history to test a change out-of-sample`;
    } else if (wf.pick === current.targetR) {
      why = `already at the value the out-of-sample test picks, across ${wf.splits} splits`;
    } else if (wf.agreement < WF_AGREE) {
      why = `the splits disagree on the best target (${wf.gains.length} tested, no ${Math.round(WF_AGREE*100)}% consensus) — not a stable finding`;
    } else if (wf.wins < needWins) {
      why = `${wf.pick}R looked better on older trades but won only ${wf.wins} of ${wf.splits} out-of-sample windows`;
    } else {
      why = `${wf.pick}R holds up out-of-sample but by a median of only ${wf.median.toFixed(3)}R, under the ${MIN_EDGE_OOS}R needed to justify moving`;
    }
    out.findings.push({
      parameter: 'targetR', from: current.targetR, to: current.targetR,
      evidence: why,
      validation: wf ? { splits: wf.splits, wins: wf.wins, agreement: wf.agreement, medianOOS: wf.median } : null,
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
// Outcome-based reverting was built here on 2026-09-03 and removed the same
// day. Keeping the reasoning so it is not rebuilt.
//
// The idea was to judge each applied change once enough trades had run under
// it — compare expectancy after against before, undo anything materially
// worse. It cannot work at this data volume, and the numbers say so plainly.
// Measured on the real record:
//
//   Spread of a single trade                          1.17R
//   se of a before/after difference, 60-trade windows 0.214R
//   Run at 166 split points where NOTHING changed, it fired:
//     45% of the time at 1.0 se       26% at 1.96 se      16% at 2.5 se
//   Requiring a clean control market cut that to 9% at 1.96 se and 7% at 2.5,
//   but the power to catch a REAL degradation then collapses:
//     0.10R harm -> 2%    0.20R -> 6%    0.30R -> 13%    0.50R -> 43%
//
// Either it reverts at random or it detects nothing. The parameters here move
// expectancy by perhaps 0.05-0.15R, which sits entirely inside the blind spot.
// That is a limit of having a few hundred trades against a 1.17R spread, not
// an implementation that needed more care.
//
// It was also redundant. analyseMarket re-derives the optimum from the FULL
// record every run and compares it against the CURRENT value, and its step is
// signed — so when accumulated evidence says the old setting was better, it
// already walks back, using every trade on file rather than a 60-trade window,
// and it re-simulates each trade against the alternative rather than comparing
// two noisy periods. Self-correction was there all along; a second, weaker
// mechanism voting against it could only add noise.
//
// What was a real fault, and is fixed: the daily pass re-ran on every restart
// (see learnedRecently below), which is what actually let the parameters
// ratchet one way.

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
