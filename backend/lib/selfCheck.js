// Self-check — looks for the software being quietly wrong.
//
// Every fault found in the audit that prompted this had two things in common:
// it had been running for weeks or months, and it was visible in data the
// software already held. The monitor graded trades against bars that predated
// them for about three months. Shorts were switched off entirely for a
// fortnight. The economic calendar served invented events. An analyst feed
// answered 403 on every call. None of it raised anything, because nothing was
// looking.
//
// These are invariants: statements that should be true of a working system.
// Each one here would have caught a real fault. They describe symptoms rather
// than causes — "no short has been produced in two weeks" rather than "check
// the regime gate" — because the next fault will not be one of the ones
// already fixed.
//
// Checks report; they never change behaviour. A check that silently altered
// what the scanner does would be the same class of problem it exists to find.
import { getAllSignals } from './signalLog.js';
import { assessGoals } from './goals.js';

const DAY = 24 * 60 * 60 * 1000;

const ok    = (id, title, detail) => ({ id, title, status: 'ok',    detail });
const warn  = (id, title, detail, action) => ({ id, title, status: 'warn',  detail, action });
const fail  = (id, title, detail, action) => ({ id, title, status: 'fail',  detail, action });
const skip  = (id, title, detail) => ({ id, title, status: 'skip',  detail });

// ── 1. Outcome scoring ───────────────────────────────────────────────
// A trade cannot close before it opened. This exact symptom went unseen for
// months and inverted every conclusion drawn from the tracked record.
function checkScoringIntegrity(signals) {
  const closed = signals.filter(s => s.status === 'CLOSED' && s.timeToCloseHrs != null);
  if (!closed.length) return skip('scoring', 'Outcome scoring', 'No closed signals yet');
  const bad = closed.filter(s => s.timeToCloseHrs < 0);
  if (bad.length) {
    return fail('scoring', 'Outcome scoring',
      `${bad.length} of ${closed.length} trades are recorded as closing before they were signalled`,
      'The monitor is grading against bars that predate the signal — every win-rate figure is wrong until fixed');
  }
  return ok('scoring', 'Outcome scoring', `${closed.length} closed trades, all with sane timing`);
}

// ── 2. Both directions reachable ─────────────────────────────────────
// A gate that blocks one side completely looks identical to "no setups
// qualified" from the outside. Shorts were off for a fortnight this way.
function checkDirectionBalance(signals) {
  const recent = signals.filter(s => s.market === 'stocks' && Date.now() - s.signaledAt < 14 * DAY);
  if (recent.length < 20) return skip('direction', 'Both directions reachable',
    `Only ${recent.length} stock signals in 14 days — too few to judge`);
  const shorts = recent.filter(s => s.direction === 'SHORT').length;
  if (shorts === 0) {
    return fail('direction', 'Both directions reachable',
      `${recent.length} stock signals in 14 days and not one short`,
      'A filter is probably blocking shorts outright rather than gating them');
  }
  const pct = shorts / recent.length * 100;
  if (pct < 5) {
    return warn('direction', 'Both directions reachable',
      `Only ${shorts} of ${recent.length} stock signals were shorts (${pct.toFixed(0)}%)`,
      'Worth checking the short gate is discriminating rather than nearly always refusing');
  }
  return ok('direction', 'Both directions reachable', `${shorts} shorts in ${recent.length} stock signals (${pct.toFixed(0)}%)`);
}

// ── 3. Every market still produces trades ────────────────────────────
function checkMarketCoverage(signals) {
  const markets = ['stocks', 'crypto', 'forex', 'commodities'];
  const dead = [];
  const counts = {};
  for (const m of markets) {
    counts[m] = signals.filter(s => s.market === m && Date.now() - s.signaledAt < 14 * DAY).length;
    if (counts[m] === 0) dead.push(m);
  }
  const summary = markets.map(m => `${m} ${counts[m]}`).join(', ');
  if (dead.length) {
    return warn('coverage', 'All markets producing', `Nothing from ${dead.join(', ')} in 14 days — ${summary}`,
      'Either the filters are too tight for that market or its data feed is failing silently');
  }
  return ok('coverage', 'All markets producing', `Signals in 14 days — ${summary}`);
}

// ── 4. Values that should vary, varying ──────────────────────────────
// A hardcoded number shows up as the same value on every card. The invented
// "60% historical win rate" sat on every trade for months looking plausible.
function checkForConstants(cards) {
  if (!cards || cards.length < 4) return skip('constants', 'Card values vary', 'Too few cards to compare');
  const fields = ['confidence', 'rrRatio', 'expectedDays'];
  const frozen = [];
  for (const f of fields) {
    const vals = cards.map(c => c[f]).filter(v => v != null);
    if (vals.length >= 4 && new Set(vals).size === 1) frozen.push(`${f} is ${vals[0]} on all ${vals.length}`);
  }
  if (frozen.length) {
    return warn('constants', 'Card values vary', frozen.join('; '),
      'A value identical across every card is usually hardcoded rather than computed');
  }
  return ok('constants', 'Card values vary', `${cards.length} cards, values differ as expected`);
}

// ── 5. Setup geometry inside its own limits ──────────────────────────
// Catches a calibration change that quietly stops doing what it claims —
// targets drifting wide again, or a ceiling that is not actually applied.
function checkGeometry(cards) {
  if (!cards || !cards.length) return skip('geometry', 'Setup geometry', 'No cards to inspect');
  const issues = [];
  const stops = cards.map(c => c.entry && c.sl ? Math.abs(c.entry - c.sl) / c.entry * 100 : null).filter(Boolean);
  const rrs   = cards.map(c => c.rrRatio).filter(Boolean);
  const over  = stops.filter(s => s > 4.05).length;
  if (over) issues.push(`${over} card(s) need a stop wider than 4% of price`);
  const wide  = rrs.filter(r => r > 3.0).length;
  if (wide) issues.push(`${wide} card(s) at reward:risk above 3.0, a band that has lost money`);
  const days  = cards.map(c => c.expectedDays).filter(Boolean);
  const slow  = days.filter(d => d > 4).length;
  if (slow) issues.push(`${slow} card(s) expect longer than 4 sessions`);
  if (issues.length) {
    return warn('geometry', 'Setup geometry', issues.join('; '),
      'Setups are outside the bands the tracked record supports for a 24-72h hold');
  }
  const avgStop = stops.length ? (stops.reduce((a,b)=>a+b,0)/stops.length).toFixed(2) : '?';
  const avgRR   = rrs.length ? (rrs.reduce((a,b)=>a+b,0)/rrs.length).toFixed(2) : '?';
  return ok('geometry', 'Setup geometry', `avg reward:risk ${avgRR}, avg stop ${avgStop}% of price`);
}

// ── 6. Data sources actually answering ───────────────────────────────
function checkSources(sources) {
  if (!sources?.length) return skip('sources', 'Data sources', 'Source status unavailable');
  const dead = sources.filter(s => !s.active);
  if (dead.length) {
    return warn('sources', 'Data sources', `${dead.length} inactive: ${dead.map(d => d.name).join(', ')}`,
      'A source that is down changes what the scanner can see, quietly');
  }
  return ok('sources', 'Data sources', `${sources.length} of ${sources.length} answering`);
}

// ── 7. Tracking still recording ──────────────────────────────────────
// If logging breaks, everything above keeps looking fine while the record
// silently stops growing — and every future calibration rests on it.
function checkTrackingLive(signals) {
  if (!signals.length) return fail('tracking', 'Outcome tracking', 'No signals recorded at all',
    'Nothing is being tracked, so no future analysis is possible');
  const newest = Math.max(...signals.map(s => s.signaledAt));
  const hrs = (Date.now() - newest) / 3600000;
  const open = signals.filter(s => s.status === 'OPEN').length;
  if (hrs > 72) {
    return warn('tracking', 'Outcome tracking', `Nothing new logged in ${Math.round(hrs)} hours`,
      'Either no setup has qualified in three days, or logging has stopped');
  }
  const withFeatures = signals.filter(s => s.features).length;
  return ok('tracking', 'Outcome tracking',
    `${signals.length} signals, ${open} open, newest ${hrs < 1 ? 'under an hour' : Math.round(hrs) + 'h'} ago`
    + (withFeatures ? ` · ${withFeatures} with full inputs recorded` : ''));
}

// ── 8. Still doing what it exists to do ──────────────────────────────
// Parameters can be within their bands and every feed answering while the
// system quietly stops making money. This is the check that notices.
function checkGoals() {
  let g;
  try { g = assessGoals(); } catch { return skip('goals', 'Meeting its goals', 'Assessment unavailable'); }
  if (g.status === 'waiting') return skip('goals', 'Meeting its goals', g.headline);
  if (g.status === 'off') {
    const bad = g.goals.filter(x => x.status === 'off').map(x => x.detail).join('; ');
    return fail('goals', 'Meeting its goals', bad,
      'The settings are within their bands but the results are not there — worth re-examining the calibration');
  }
  if (g.trend?.direction === 'degrading') {
    return warn('goals', 'Meeting its goals', g.trend.detail,
      'Results are worse than under the previous settings');
  }
  return ok('goals', 'Meeting its goals', g.goals.map(x => x.detail).join('; '));
}


// ── 9. A flood of signals in one session ─────────────────────────────
//
// On 21 Aug the scanner logged 119 signals in a single day, with an average
// stop of 3.97% and an average reward:risk of 2.83. Those trades alone cost
// -34.9R, which is 37% of everything this system has ever lost. Nothing
// capped the count and nothing remarked on it — it took a retrospective
// months later to notice.
//
// A day producing several times the usual number is not an unusually rich
// day. It means a filter has come loose, and no one can act on 119 ideas
// anyway.
function checkSignalVolume(signals) {
  // Distinct ideas, not records. Counting records made 21 Aug look like 119
  // signals when it was 41 ideas logged repeatedly.
  const seen = new Set();
  const byDay = {};
  for (const s of signals) {
    const d = new Date(s.signaledAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const key = `${d}|${s.ticker}|${s.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  const days = Object.keys(byDay).sort();
  if (days.length < 4) return skip('volume', 'Signal volume', 'Not enough days to compare');

  const counts = days.map(d => byDay[d]).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)];
  const today = byDay[days[days.length - 1]] || 0;
  const worst = Math.max(...Object.values(byDay));
  const worstDay = days.find(d => byDay[d] === worst);

  if (median > 0 && today > median * 3 && today > 40) {
    return fail('volume', 'Signal volume',
      `${today} signals today against a typical ${median}`,
      'A day producing several times the usual count means a filter has come loose, not that the market is unusually generous');
  }
  return ok('volume', 'Signal volume',
    `${today} today, typically ${median} a day (busiest was ${worst} on ${worstDay})`);
}

// ── 10. Are the entries reachable? ───────────────────────────────────
//
// For months every signal was counted from the moment it was logged, without
// checking that price ever traded at the entry. 53 of 477 closed trades had
// never been enterable, all of them winners — an unfilled trade cannot lose —
// and they inflated measured performance threefold. The bug was invisible
// precisely because it only ever added good news.
//
// A fill rate that collapses means the entries are being placed where price
// does not go; one at 100% means the check has stopped running.
function checkFillRate(signals) {
  const closed = signals.filter(s => s.status === 'CLOSED');
  if (closed.length < 50) return skip('fills', 'Entries reachable', 'Too few closed trades to judge');
  const unfilled = closed.filter(s => s.closeReason === 'NEVER_FILLED').length;
  const rate = (closed.length - unfilled) / closed.length;

  if (unfilled === 0) {
    return warn('fills', 'Entries reachable',
      `Every one of ${closed.length} closed trades is recorded as filled`,
      'Some entries should always go unreached — none at all suggests the fill check has stopped running, which is how performance was overstated threefold before');
  }
  if (rate < 0.6) {
    return fail('fills', 'Entries reachable',
      `Only ${Math.round(rate * 100)}% of signals reached their entry`,
      'Entries are being placed where price does not trade, so most of these are not trades you could take');
  }
  return ok('fills', 'Entries reachable',
    `${Math.round(rate * 100)}% of signals traded at their entry · ${unfilled} never did and are excluded from the record`);
}

/**
 * Run every check. `cards` and `sources` are optional; checks needing them
 * report 'skip' rather than failing when they are absent.
 */
export function runSelfCheck({ cards = null, sources = null } = {}) {
  const signals = getAllSignals();
  const checks = [
    checkScoringIntegrity(signals),
    checkTrackingLive(signals),
    checkDirectionBalance(signals),
    checkMarketCoverage(signals),
    checkGeometry(cards),
    checkForConstants(cards),
    checkSources(sources),
    checkSignalVolume(signals),
    checkFillRate(signals),
    checkGoals()
  ];
  const counts = checks.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] || 0) + 1 }), {});
  const status = counts.fail ? 'fail' : counts.warn ? 'warn' : 'ok';
  return {
    status,
    summary: counts.fail ? `${counts.fail} problem${counts.fail === 1 ? '' : 's'} found`
           : counts.warn ? `${counts.warn} thing${counts.warn === 1 ? '' : 's'} worth a look`
           : 'Nothing wrong found',
    counts,
    checks,
    ranAt: new Date().toISOString()
  };
}
