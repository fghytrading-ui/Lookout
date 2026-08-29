// Post-earnings drift — a catalyst trade rather than a pattern trade.
//
// Everything else in this scanner starts from a chart and looks for a shape.
// Measured over 443 tracked trades that approach has a negative edge, and
// nothing survived out-of-sample testing: not a filter, not a different entry,
// not a different stop. This starts from an event instead.
//
// The claim is narrow and was measured on 145 earnings events across 255
// instruments, using entry prices that were actually available:
//
//   long a company that beat by more than 5%, entered at the first open you
//   could trade after the report, held three sessions and closed
//     +2.35% average, 58% of them green, z = 3.2 over 109 events
//
//   the same trade on companies that MISSED, shorted
//     +0.63%, z = 0.4 over 36 events — not distinguishable from nothing
//
// So only beats are traded. It survives dropping the five best and five worst
// results (+1.82%, z = 3.4) and is positive in both halves of the period. The
// benchmark — the same instruments entered on random dates and held three
// sessions — is -0.49%.
//
// Two design points that come straight out of the measurement:
//
// The hold is a fixed three sessions, exiting at the close. The edge is in the
// average drift, not in reaching a particular price, so there is no target to
// hit. Day one is often negative — the reaction overshoots and gives some back
// before the drift resumes — which is why a tight stop does not belong here.
//
// The stop is wide and exists only to bound a disaster. Among the trades that
// finished green the median worst drawdown from entry was 2.2% and the worst
// tenth was 6.9%, so a stop nearer than about 8% starts cutting winners rather
// than protecting anything.

import { fetchEarningsCalendar } from './catalystFeed.js';

const MIN_SURPRISE_PCT = 5;      // below this the "beat" is rounding
const MIN_ESTIMATE     = 0.10;   // a percentage off a near-zero estimate is noise
const HOLD_SESSIONS    = 3;
const STOP_PCT         = 0.08;   // disaster stop, not a working stop

/**
 * Companies that beat and are still inside the window where the drift was
 * measured. `daysBack` of 2 keeps a report from yesterday or the day before;
 * past that the effect had decayed to nothing in testing.
 */
export async function getEarningsDriftCandidates({ daysBack = 2 } = {}) {
  const reported = await fetchEarningsCalendar({ daysBack: daysBack + 1 });
  const out = [];

  for (const e of reported) {
    if (!Number.isFinite(e.epsActual) || !Number.isFinite(e.epsEstimate)) continue;
    if (Math.abs(e.epsEstimate) < MIN_ESTIMATE) continue;
    const surprise = ((e.epsActual - e.epsEstimate) / Math.abs(e.epsEstimate)) * 100;
    if (surprise < MIN_SURPRISE_PCT) continue;        // beats only — misses did not work

    out.push({
      ticker: e.ticker,
      direction: 'LONG',
      surprisePct: Math.round(surprise),
      // For display. A one-cent beat against a 0.11 estimate is arithmetically
      // a 1218% beat and says nothing about how big the surprise was — past a
      // couple of hundred percent the number stops carrying information.
      surpriseLabel: surprise > 200 ? 'more than 200%' : `${Math.round(surprise)}%`,
      reportedOn: e.date,
      reportedWhen: e.hour === 'bmo' ? 'before the open'
                  : e.hour === 'amc' ? 'after the close' : null,
      epsActual: e.epsActual,
      epsEstimate: e.epsEstimate,
      holdSessions: HOLD_SESSIONS,
      stopPct: STOP_PCT
    });
  }
  // Biggest surprises first — the effect was strongest there, though the
  // difference between bands was not itself significant.
  return out.sort((a, b) => b.surprisePct - a.surprisePct);
}

/** Turn a candidate into the levels a card needs, given a live price. */
export function buildDriftSetup(candidate, price) {
  if (!(price > 0)) return null;
  const stop = +(price * (1 - candidate.stopPct)).toFixed(2);
  return {
    direction: 'LONG',
    entry: price,
    sl: stop,
    // No target: the exit is time-based. A target would be inventing a level
    // the measurement never used.
    tp: null,
    holdSessions: candidate.holdSessions,
    exitRule: `Close the position at the end of session ${candidate.holdSessions}`,
    stopPct: candidate.stopPct * 100,
    thesis: `Beat earnings by ${candidate.surprisePct}% on ${candidate.reportedOn}`
          + (candidate.reportedWhen ? ` ${candidate.reportedWhen}` : '')
          + '. Held three sessions, this returned +2.35% on average across 109'
          + ' tracked beats, 58% of them green.'
  };
}
