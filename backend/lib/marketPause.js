// Markets taken off the board until their own record earns them back.
//
// Crypto, measured 2026-10-07 on 121 resolved trades: -0.260R per trade,
// 95% interval -0.407 to -0.113, and below zero in every chronological
// quarter, longs (-0.255R) and shorts (-0.277R) alike. Re-graded under the
// rules it trades on now (single exit, 10-hour time stop) it is still
// -0.171R, with three of four quarters negative and the latest the worst.
// Taking the opposite side of the same cards was tested too: +0.08R after
// costs at z=0.76, negative in the first two quarters — not an edge either.
//
// So it is not offered. It is still scanned on the schedule and every card
// is logged with `shown: false`, because a market removed from the record
// could never show it had improved. It comes back on its own when trades
// logged under the current rules have proven it: enough of them, positive
// overall AND in both chronological halves — the same walk-forward standard
// every other change here has had to meet. A good week alone cannot do it;
// trades raised on the same day move together.
import { getAllSignals } from './signalLog.js';
import { expectancyOf } from './realisedR.js';

const RELEASE_N = 100;

const PAUSES = {
  crypto: {
    // Cards logged with a time stop are the ones traded on today's rules.
    current: (s) => s.timeStop != null,
    reason: 'Crypto is paused: across 121 tracked trades it lost money in every period measured '
          + '(-0.26R per trade), and the newest rules still replay below zero.'
  }
};

/**
 * Is this market paused? Returns null when it is on the board, otherwise
 * what it is waiting on. Recomputed on every call, so a release takes effect
 * on the next scan without anyone touching it.
 */
export function marketPause(market) {
  const rule = PAUSES[market];
  if (!rule) return null;
  const rows = getAllSignals()
    .filter(s => s.market === market && s.status === 'CLOSED' && rule.current(s))
    .sort((a, b) => a.signaledAt - b.signaledAt);
  const all = expectancyOf(rows);
  const half = Math.floor(rows.length / 2);
  const early = expectancyOf(rows.slice(0, half));
  const late = expectancyOf(rows.slice(half));
  const earned = all.n >= RELEASE_N && all.mean > 0 && early.mean > 0 && late.mean > 0;
  if (earned) return null;
  const sofar = all.n
    ? `${all.n} of ${RELEASE_N} trades tracked on the current rules, ${all.mean >= 0 ? '+' : ''}${all.mean.toFixed(2)}R per trade so far`
    : `0 of ${RELEASE_N} trades tracked on the current rules yet`;
  return {
    market,
    reason: rule.reason,
    progress: `Still tracked in the background: ${sofar}. It returns once ${RELEASE_N} have resolved `
            + 'and it is positive overall and in both halves.',
    tracked: all.n,
    needed: RELEASE_N,
    expectancy: all.mean != null ? parseFloat(all.mean.toFixed(3)) : null
  };
}

export function pausedMarkets() {
  return Object.keys(PAUSES).map(marketPause).filter(Boolean);
}
