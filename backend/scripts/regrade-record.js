// Re-grade the tracked record with the current grader.
//
//   node scripts/regrade-record.js          dry run: report what would change
//   node scripts/regrade-record.js --apply  write the corrected outcomes
//
// Written 2026-10-02 after three grading faults were found: the walk ran past
// each trade's horizon, expiries settled at the price on the day of grading,
// and late grading fetched "the latest N bars" rather than the trade's own
// window. All three only bite when grading happens late — the normal case on
// a host that sleeps — so the record had to be checked trade by trade.
//
// Each trade is re-graded under the plan it was TAKEN on. Thirds-era trades
// never had their scale-out level stored, so it is reconstructed from the
// rule that set it (30% of the way to TP1); the single exit has none.
import '../env.js';
import { getAllSignals, updateSignal, flushSignalLog } from '../lib/signalLog.js';
import { determineOutcome, fetchCandlesSince, classifyOutcome } from '../lib/signalMonitor.js';
import { realisedR, expectancyOf, THIRDS_FROM, SINGLE_EXIT_FROM } from '../lib/realisedR.js';

const APPLY = process.argv.includes('--apply');
const all = getAllSignals().filter(s => s.status === 'CLOSED' || s.status === 'OPEN');
const rows = [];
const conc = 4;

// The plan on the card when the trade was signalled — never the grade's.
function planOnCard(s) {
  return (s.signaledAt >= THIRDS_FROM && s.signaledAt < SINGLE_EXIT_FROM) ? 'thirds' : 'single';
}

function asTaken(s) {
  const plan = planOnCard(s);
  const sig = { ...s };
  if (plan === 'thirds') sig.tp0 = s.entry + 0.3 * (s.tp - s.entry);
  else delete sig.tp0;
  return { sig, plan };
}

for (let i = 0; i < all.length; i += conc) {
  await Promise.all(all.slice(i, i + conc).map(async (s) => {
    const { sig, plan } = asTaken(s);
    const candles = await fetchCandlesSince(sig);
    const out = candles === null ? 'UNCOVERED' : determineOutcome(sig, candles);
    rows.push({ s, plan, out });
  }));
  if (i % 40 === 0) process.stderr.write(`  ${i}/${all.length}\r`);
}

const fmt = (x) => x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(3);
const kinds = {};
const changes = [];
for (const { s, plan, out } of rows) {
  let kind;
  if (out === 'UNCOVERED') kind = 'cannot reach its window';
  else if (!out) kind = s.status === 'OPEN' ? 'still pending' : 'no data now (kept as is)';
  else if (s.status === 'OPEN') kind = 'open -> graded';
  else if (out.reason !== s.closeReason) kind = 'outcome changes';
  else if (Math.abs((out.closePrice ?? 0) - (s.closePrice ?? 0)) > 1e-9 * Math.max(1, Math.abs(s.closePrice || 1))) kind = 'settle price changes';
  else if (s.exitPlan !== plan) kind = 'plan recorded';
  else kind = 'unchanged';
  kinds[kind] = (kinds[kind] || 0) + 1;
  if (out && out !== 'UNCOVERED' && kind !== 'unchanged') changes.push({ s, plan, out, kind });
}

console.log(`\nRE-GRADE ${APPLY ? '(APPLYING)' : '(dry run)'} — ${rows.length} trades`);
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}`);

console.log('\nchanged outcomes (first 15):');
for (const c of changes.filter(c => c.kind === 'outcome changes').slice(0, 15)) {
  console.log(`  ${c.s.market.padEnd(7)} ${c.s.ticker.padEnd(10)} ${new Date(c.s.signaledAt).toISOString().slice(0, 10)}  ${String(c.s.closeReason).padEnd(12)} -> ${c.out.reason}`);
}

const closedBefore = rows.filter(r => r.s.status === 'CLOSED').map(r => r.s);
const after = rows.map(({ s, out, plan }) => (out && out !== 'UNCOVERED')
  ? { ...s, exitPlan: plan, status: 'CLOSED', closeReason: out.reason, closePrice: out.closePrice, closedAt: out.closedAt,
      scaledOut: !!out.scaledOut, mfePct: out.mfePct ?? s.mfePct, maePct: out.maePct ?? s.maePct }
  : s).filter(s => s.status === 'CLOSED');
const eB = expectancyOf(closedBefore), eA = expectancyOf(after);
console.log(`\n  record as stored : ${fmt(eB.mean)}R  [${fmt(eB.lower)}, ${fmt(eB.upper)}]  n=${eB.n}`);
console.log(`  record re-graded : ${fmt(eA.mean)}R  [${fmt(eA.lower)}, ${fmt(eA.upper)}]  n=${eA.n}`);

if (APPLY) {
  let n = 0;
  for (const c of changes) {
    updateSignal(c.s.id, {
      status: 'CLOSED', closeReason: c.out.reason, closePrice: c.out.closePrice,
      mfe: c.out.mfe, mae: c.out.mae, mfePct: c.out.mfePct ?? null, maePct: c.out.maePct ?? null,
      closedAt: c.out.closedAt, scaledOut: !!c.out.scaledOut,
      outcome: classifyOutcome(c.out.reason, c.out.scaledOut),
      timeToCloseHrs: parseFloat(((c.out.closedAt - c.s.signaledAt) / 3600_000).toFixed(1)),
      exitPlan: c.plan, regradedAt: Date.now()
    });
    n++;
  }
  flushSignalLog();
  console.log(`\n  wrote ${n} corrected outcomes`);
}
process.exit(0);
