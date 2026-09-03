// Candidate edges, watched until they are provable or dead.
//
// The gap this fills. Searching the record for "where does it lose money"
// throws up leads constantly, and most of them are noise wearing a plausible
// story. On 2026-09-03 a search found crypto signals raised in the European
// morning returning -0.451R against +0.248R later in the day, z=-4.45, and it
// held in every out-of-sample window. It looked ready to act on. Re-cut using
// the session boundaries the software itself defines, the same data gave four
// buckets of 9 to 36 trades and a completely different ranking — the US block
// turned negative too. The effect moved with the boundary, which means the
// boundary was doing the work.
//
// That is the whole problem in one example. A lead is found once, it is
// exciting, it is either acted on too early or forgotten entirely, and either
// way nobody ever goes back when the sample has doubled. This project has
// already retracted one finding that way: post-earnings drift, strong at
// z=3.2 on a subset, dead at z=0.8 on the full record.
//
// So candidate edges are declared here and measured on every run, with the
// bar stated up front and the sample required before anyone is allowed to
// believe it. Nothing here changes what is traded. It reports, so that a
// decision is taken when the evidence is in rather than when the idea is new.
import { getAllSignals } from './signalLog.js';
import { expectancyOf } from './realisedR.js';

// A segment needs this many resolved trades before its verdict means anything.
// Set from the arithmetic rather than taste: at the measured 1.17R spread, 40
// trades put the standard error near 0.19R, so an effect has to be about 0.37R
// to clear 1.96. Below that a bucket cannot separate a real edge from a run of
// luck, and reporting it invites exactly the boundary-chasing described above.
const MIN_N = 40;
const Z_CRIT = 1.96;

// Splits worth watching, each one a question with a plain answer.
// Keep this list short and mechanical. Anything derived from the trade's own
// outcome would be circular, and anything not knowable when the signal fires
// is look-ahead — the trap that killed the five-session trend gate.
const HYPOTHESES = [
  {
    id: 'crypto-session',
    question: 'Does the hour a crypto signal is raised predict how it does?',
    market: 'crypto',
    segment: (s) => {
      const h = new Date(new Date(s.signaledAt).toLocaleString('en-US', { timeZone: 'Europe/London' })).getHours();
      return h < 8 ? 'Asia' : h < 13 ? 'Europe' : h < 21 ? 'US' : 'Off-peak';
    },
    note: 'Found 2026-09-03 at z=-4.45 on a two-way split, then failed to survive '
        + 'a four-way one. Watching until every bucket has the sample to settle it.'
  },
  {
    id: 'stock-session',
    question: 'Do stock signals raised before noon ET do worse?',
    market: 'stocks',
    segment: (s) => {
      const h = parseInt(new Date(s.signaledAt)
        .toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit' }), 10);
      return h < 12 ? 'morning' : 'afternoon';
    },
    note: 'Same search, stocks only: -0.201R against +0.008R but z=1.19, so unproven either way.'
  },
  {
    id: 'direction',
    question: 'Are shorts worth offering at all?',
    market: null,
    segment: (s) => s.direction === 'SHORT' ? 'short' : 'long',
    note: 'Shorts have run behind longs since the record began without ever reaching significance.'
  },
  {
    id: 'reviewer',
    question: 'Does the reviewer verdict predict anything?',
    market: null,
    segment: (s) => s.reviewVerdict || null,
    note: 'PASS has been scoring WORSE than CAUTION, which would mean the verdict is '
        + 'either inverted or inert. Neither has the sample to say yet.'
  }
];

/** Measure every hypothesis against the record as it currently stands. */
export function assessHypotheses() {
  const all = getAllSignals().filter(s => s.status === 'CLOSED' && Number.isFinite(s.signaledAt));
  const out = [];

  for (const h of HYPOTHESES) {
    const rows = h.market ? all.filter(s => s.market === h.market) : all;
    const groups = new Map();
    for (const s of rows) {
      const g = h.segment(s);
      if (g == null) continue;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }

    const segments = [];
    for (const [name, seg] of groups) {
      const e = expectancyOf(seg);
      segments.push({
        segment: name, n: e.n,
        expectancy: e.mean, se: e.se,
        ready: e.n >= MIN_N,
        z: (e.mean != null && e.se) ? e.mean / e.se : null
      });
    }
    segments.sort((a, b) => (b.expectancy ?? -9) - (a.expectancy ?? -9));

    // A verdict needs BOTH ends of the comparison to be ready. Half a
    // comparison is how a promising bucket gets believed on its own.
    const ready = segments.filter(s => s.ready);
    let status = 'watching', verdict;
    if (ready.length < 2) {
      const short = segments.filter(s => !s.ready).map(s => `${s.segment} ${s.n}/${MIN_N}`);
      verdict = `Not enough yet — ${short.join(', ')}`;
    } else {
      const best = ready[0], worst = ready[ready.length - 1];
      const seD = Math.sqrt((best.se ?? 0) ** 2 + (worst.se ?? 0) ** 2);
      const gap = best.expectancy - worst.expectancy;
      const z = seD > 0 ? gap / seD : 0;
      if (Math.abs(z) > Z_CRIT) {
        status = 'proven';
        verdict = `${best.segment} beats ${worst.segment} by ${gap.toFixed(3)}R `
                + `(z=${z.toFixed(2)}, n=${best.n} vs ${worst.n})`;
      } else {
        status = 'no-effect';
        verdict = `${best.segment} and ${worst.segment} differ by only ${gap.toFixed(3)}R `
                + `(z=${z.toFixed(2)}) — no effect at this sample`;
      }
    }
    out.push({ id: h.id, question: h.question, note: h.note, status, verdict, segments });
  }

  return {
    minSample: MIN_N,
    proven: out.filter(h => h.status === 'proven').map(h => h.id),
    hypotheses: out
  };
}

/** Only the ones that have earned a decision — for the daily review. */
export function provenHypotheses() {
  return assessHypotheses().hypotheses
    .filter(h => h.status === 'proven')
    .map(h => ({ id: h.id, question: h.question, verdict: h.verdict }));
}
