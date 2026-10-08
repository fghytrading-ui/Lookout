// Entry timing tests: when each kind of stock card should be entered, across
// the US session, weekends, holidays, half days and both clock changes.
// The window comes from the exchange calendar (utils/market.js) and the page
// reads it through frontend/src/utils/entryWindow.js; both are tested here.
const { entryState, clockLine } = await import('../../frontend/src/utils/entryWindow.js');
const { stockEntryWindow, marketClock } = await import('../utils/market.js');
let pass = 0, fail = 0;
const t = (name, cond, got) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name.padEnd(62)} ${cond ? '' : JSON.stringify(got)}`); };
const card = (closeEntry, raisedAt, extra = {}) => ({ direction: 'LONG', sl: 95, tp: 110, price: 100, entryWindow: stockEntryWindow({ closeEntry, now: Date.parse(raisedAt) }), ...extra });
const at = (c, iso, px) => entryState(c, px ?? c.price, Date.parse(iso));

console.log('EVENING CARD (raised Thu 6pm ET = 11pm UK)');
let c = card(true, '2026-10-08T22:00:00Z');
let s = at(c, '2026-10-08T22:05:00Z');
t('that evening: later, tomorrow 8:30-9:00pm UK', s.state === 'later' && s.when === 'tomorrow 8:30pm–9:00pm UK', s);
t('countdown ~21h', /^21h/.test(s.countIn), s.countIn);
s = at(c, '2026-10-09T08:00:00Z');                 // Fri 9am UK
t('next morning: later, today 8:30-9:00pm UK', s.state === 'later' && s.when === 'today 8:30pm–9:00pm UK', s);
s = at(c, '2026-10-09T14:00:00Z');                 // market open, before window
t('market open, before window: still later', s.state === 'later', s);
s = at(c, '2026-10-09T19:31:00Z');
t('8:31pm UK: ENTER NOW, last 30 min', s.state === 'now' && /Last 30 minutes/.test(s.detail), s);
s = at(c, '2026-10-09T20:00:30Z');
t('9:00pm UK: window closed', s.state === 'off' && s.headline === 'WINDOW CLOSED', s);
s = at({ ...c, touchedToday: true, entryStatusText: 'The stop already traded today — this trade is off' }, '2026-10-09T19:40:00Z');
t('stop traded during the day: off', s.state === 'off' && /stop already traded/.test(s.detail), s);

console.log('FRIDAY EVENING CARD');
c = card(true, '2026-10-09T21:00:00Z');
s = at(c, '2026-10-09T21:05:00Z');
t('Friday night: later, Mon 12 Oct 8:30-9:00pm UK', s.state === 'later' && s.when === 'Mon 12 Oct 8:30pm–9:00pm UK', s);
s = at(c, '2026-10-11T12:00:00Z');
t('Sunday: tomorrow 8:30-9:00pm UK', s.when === 'tomorrow 8:30pm–9:00pm UK', s);

console.log('PRE-MARKET CARD (raised Fri 8am ET = 1pm UK)');
c = card(false, '2026-10-09T12:00:00Z');
s = at(c, '2026-10-09T12:05:00Z');
t('before the open: later, at the open today 2:30pm UK', s.state === 'later' && /AT THE OPEN — TODAY 2:30PM UK/.test(s.headline), s);
s = at(c, '2026-10-09T13:31:00Z');
t('after the open: ENTER NOW at market', s.state === 'now' && /Enter at market/.test(s.detail), s);

console.log('IN-SESSION CARD (raised Fri 11am ET)');
c = card(false, '2026-10-09T15:00:00Z');
t('window kind now', c.entryWindow.kind === 'now');
s = at(c, '2026-10-09T15:01:00Z');
t('ENTER NOW until 9:00pm UK', s.state === 'now' && /until 9:00pm UK/.test(s.detail), s);
s = at(c, '2026-10-09T15:01:00Z', 111);
t('price already past the target: off', s.state === 'off' && /past the target/.test(s.detail), s);
s = at(c, '2026-10-09T15:01:00Z', 94);
t('price already past the stop: off', s.state === 'off' && /past the stop/.test(s.detail), s);
s = at({ ...c, direction: 'SHORT', sl: 105, tp: 90 }, '2026-10-09T15:01:00Z', 106);
t('short past its stop: off', s.state === 'off' && /past the stop/.test(s.detail), s);
s = at({ ...c, heldBack: 'CPI tomorrow 8:30am — no new entries until it clears.' }, '2026-10-09T15:01:00Z');
t('held back for a release: off with the reason', s.state === 'off' && /CPI/.test(s.detail), s);

console.log('HALF DAY AND WINTER TIME');
c = card(true, '2026-11-26T15:00:00Z');            // Thanksgiving -> Fri half day
s = at(c, '2026-11-27T12:00:00Z');
t('half day: 5:30-6:00pm UK (12:30-1pm ET, GMT)', s.when === 'today 5:30pm–6:00pm UK', s);
c = card(true, '2026-11-03T22:00:00Z');            // EST
s = at(c, '2026-11-04T10:00:00Z');
t('winter: 8:30-9:00pm UK (3:30-4pm EST = GMT+5)', s.when === 'today 8:30pm–9:00pm UK', s);
c = card(true, '2026-03-10T22:00:00Z');            // US on EDT, UK still GMT
s = at(c, '2026-03-11T10:00:00Z');
t('March gap weeks: 7:30-8:00pm UK', s.when === 'today 7:30pm–8:00pm UK', s);

console.log('CLOCK');
let k = clockLine(marketClock(Date.parse('2026-10-09T14:00:00Z')), 'MARKET_OPEN', Date.parse('2026-10-09T14:00:00Z'));
t('open: closes 9:00pm UK', k.open && /closes 9:00pm UK \(in 6h\)/.test(k.text), k);
k = clockLine(marketClock(Date.parse('2026-10-09T22:00:00Z')), 'AFTER_HOURS', Date.parse('2026-10-09T22:00:00Z'));
t('Friday night: opens Mon 2:30pm UK', !k.open && /opens Mon 12 Oct 2:30pm UK/.test(k.text), k);
k = clockLine(marketClock(Date.parse('2026-12-25T12:00:00Z')), 'HOLIDAY', Date.parse('2026-12-25T12:00:00Z'));
t('Christmas: holiday, opens Mon 28 Dec', /HOLIDAY — opens Mon 28 Dec 2:30pm UK/.test(k.text), k);
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
