// Economic calendar from FRED (Federal Reserve Bank of St. Louis).
//
// The Forex Factory feed this replaces rate-limits by IP and then serves HTML
// instead of JSON, so on shared cloud hosting it never succeeds and the
// calendar went dark in production while working fine on a laptop. FRED is an
// official Federal Reserve service, needs a free key, and permits server
// traffic.
//
// FRED publishes RELEASE DATES, not forecast/previous figures. Those columns
// are therefore left empty rather than filled with invented numbers.
import axios from 'axios';
import { registerCache } from './persistentCache.js';
import { ukTimeForET } from '../utils/market.js';

const cache = new Map();
const TTL = 6 * 60 * 60 * 1000;   // release schedules change rarely
registerCache('fred-calendar', cache);

const BASE = 'https://api.stlouisfed.org/fred';

// Releases worth putting in front of a trader, with the ET clock time each is
// published at. Those times are the agencies' own standing publication times
// (BLS releases at 08:30 ET, the FOMC statement lands at 14:00 ET) and are
// converted to UK time per date so they track daylight saving on both sides.
// FOMC (release 101) is deliberately absent. FRED treats it as a continuously
// updated release and returns a date for EVERY day in the window — 20 dates
// across 21 days, weekends included — so it carries no schedule information at
// all. Publishing that would put a fake "FOMC Statement today" on the board
// every single day, which is exactly the invented-calendar problem this feed
// was brought in to replace. FOMC dates need a source that actually lists
// meetings; until then the calendar is honest about not having them.
//
// `cadence` is the real-world release frequency, used below to detect the same
// padding fault in any release FRED changes the behaviour of later.
const RELEASES = [
  { id: 10,  name: 'CPI (inflation)',             impact: 'high',   et: { h: 8,  m: 30 }, cadence: 'monthly' },
  { id: 50,  name: 'Employment Situation (NFP)',  impact: 'high',   et: { h: 8,  m: 30 }, cadence: 'monthly' },
  { id: 53,  name: 'GDP',                         impact: 'high',   et: { h: 8,  m: 30 }, cadence: 'monthly' },
  { id: 46,  name: 'PPI (producer prices)',       impact: 'medium', et: { h: 8,  m: 30 }, cadence: 'monthly' },
  { id: 54,  name: 'PCE / Personal Income',       impact: 'high',   et: { h: 8,  m: 30 }, cadence: 'monthly' },
  { id: 9,   name: 'Retail Sales',                impact: 'high',   et: { h: 8,  m: 30 }, cadence: 'monthly' },
  { id: 180, name: 'Jobless Claims',              impact: 'medium', et: { h: 8,  m: 30 }, cadence: 'weekly'  },
  { id: 192, name: 'JOLTS Job Openings',          impact: 'medium', et: { h: 10, m: 0  }, cadence: 'monthly' }
];

const iso = (d) => d.toISOString().slice(0, 10);

export async function fetchFredCalendar({ days = 14 } = {}) {
  const key = process.env.FRED_API_KEY;
  if (!key) return null;

  const cached = cache.get('events');
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const start = iso(new Date());
  const end   = iso(new Date(Date.now() + days * 86400000));

  const results = await Promise.all(RELEASES.map(async (rel) => {
    try {
      const { data } = await axios.get(`${BASE}/release/dates`, {
        params: {
          release_id: rel.id, api_key: key, file_type: 'json',
          include_release_dates_with_no_data: true,
          realtime_start: start, realtime_end: end,
          sort_order: 'asc', limit: 20
        },
        timeout: 12000
      });
      const dates = (data?.release_dates || []).map(d => d.date);
      // Guard against FRED padding a release across every day in the window,
      // as it does for FOMC. Anything far above its real cadence is not a
      // schedule and is dropped rather than shown.
      const expected = rel.cadence === 'weekly' ? Math.ceil(days / 7) + 1 : Math.ceil(days / 28) + 1;
      if (dates.length > expected) {
        console.log(`[fred] ${rel.name}: ${dates.length} dates in ${days}d exceeds ${rel.cadence} cadence — treating as padded, skipping`);
        return [];
      }
      return dates.map(date => ({ rel, date }));
    } catch { return []; }
  }));

  const dayNames   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const events = results.flat()
    .filter(x => x.date >= start && x.date <= end)
    .map(({ rel, date }) => {
      const d = new Date(`${date}T12:00:00Z`);
      return {
        name: rel.name,
        country: 'USD',
        time: ukTimeForET(d, rel.et.h, rel.et.m),
        impact: rel.impact,
        // FRED schedules the release; it does not forecast it. Empty is honest.
        expected: '—',
        previous: '—',
        actual: null,
        date,
        dayName: dayNames[d.getUTCDay()],
        monthName: monthNames[d.getUTCMonth()],
        dayNum: d.getUTCDate(),
        source: 'FRED'
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  if (!events.length) return null;
  cache.set('events', { data: events, ts: Date.now() });
  return events;
}
