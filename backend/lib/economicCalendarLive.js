// Live economic calendar. Forex Factory first (it carries forecast and
// previous figures), then FRED, which is reachable from cloud hosts but
// supplies release dates only.
import axios from 'axios';
import { registerCache } from './persistentCache.js';
import { fetchFredCalendar } from './fredCalendar.js';

const cache = new Map();
const TTL = 30 * 60 * 1000; // 30 min — calendar updates a few times per day
registerCache('economic-calendar-live', cache);

// Several mirrors of the same free Forex Factory feed. Render's egress reaches
// some hosts and not others — the single URL used before simply failed there,
// and the whole economic calendar went dark in production while working
// perfectly on a laptop. Each is tried in turn and the first that answers wins.
const FF_URLS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.json'
];
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

// Normalize Forex Factory event into the format the frontend expects
function normalizeFFEvent(e) {
  // FF dates are ISO with -04:00 offset (US Eastern). Convert to UK time string.
  const d = new Date(e.date);
  if (isNaN(d.getTime())) return null;

  const dayNames   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Format time in UK 12-hour
  const ukTime = d.toLocaleString('en-US', {
    timeZone: 'Europe/London',
    hour: 'numeric', minute: '2-digit', hour12: true
  }).toLowerCase().replace(' ', '');

  // Format date in UK
  const ukDate = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/London' }));

  // Impact: FF uses "High", "Medium", "Low", "Holiday"
  const impactMap = { High: 'high', Medium: 'medium', Low: 'low', Holiday: 'low' };

  return {
    name: e.title || 'Untitled',
    country: e.country || '',
    time: `${ukTime} UK`,
    impact: impactMap[e.impact] || 'low',
    expected: e.forecast || '—',
    previous: e.previous || '—',
    actual: e.actual || null,
    date: ukDate.toISOString().split('T')[0],
    dayName: dayNames[ukDate.getDay()],
    monthName: monthNames[ukDate.getMonth()],
    dayNum: ukDate.getDate(),
    timestamp: d.toISOString(),
    source: 'forexfactory'
  };
}

export async function fetchLiveEconomicEvents() {
  const cached = cache.get('events');
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  try {
    // Try each mirror; 8s was also tight for a cold free-tier dyno, so the
    // timeout is raised and a failure moves on rather than killing the feed.
    let data = null, usedUrl = null, lastErr = null;
    for (const url of FF_URLS) {
      try {
        const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
        if (Array.isArray(res.data) && res.data.length) { data = res.data; usedUrl = url; break; }
      } catch (e) { lastErr = e; }
    }
    if (!data) throw (lastErr || new Error('no calendar mirror reachable'));
    if (usedUrl !== FF_URLS[0]) console.log(`[calendar] primary feed unreachable, using ${usedUrl}`);
    if (!Array.isArray(data)) throw new Error('Unexpected response shape');

    const events = data
      .map(normalizeFFEvent)
      .filter(Boolean)
      // Filter to relevant currencies for retail traders
      .filter(e => ['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD','CNY','ALL'].includes(e.country))
      // Keep only this week + next 5 days
      .filter(e => {
        const eventDate = new Date(e.timestamp);
        const now = new Date();
        const days = (eventDate - now) / (1000 * 60 * 60 * 24);
        return days >= -1 && days <= 7;
      })
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // A reachable feed that yields nothing useful (late in the week, or all
    // events filtered out) should still fall through to FRED rather than
    // leaving the calendar blank.
    if (!events.length) {
      const fred = await fetchFredCalendar({ days: 14 }).catch(() => null);
      if (fred && fred.length) {
        console.log(`[calendar] primary feed returned no events — serving ${fred.length} from FRED`);
        cache.set('events', { data: fred, ts: Date.now() });
        return fred;
      }
    }

    cache.set('events', { data: events, ts: Date.now() });
    return events;
  } catch (err) {
    // Forex Factory rate-limits by IP and then serves HTML instead of JSON, so
    // on shared cloud hosting it never succeeds. FRED is an official Federal
    // Reserve service that permits server traffic; it supplies release DATES
    // but no forecast/previous figures, which are left blank rather than
    // invented.
    try {
      const fred = await fetchFredCalendar({ days: 14 });
      if (fred && fred.length) {
        console.log(`[calendar] Forex Factory unreachable — serving ${fred.length} events from FRED`);
        cache.set('events', { data: fred, ts: Date.now() });
        return fred;
      }
    } catch { /* fall through */ }
    console.warn('[calendar] no provider reachable:', err.message);
    return null;   // caller reports the calendar as unavailable
  }
}

// Returns true if live data is currently available
export async function isLiveCalendarAvailable() {
  const events = await fetchLiveEconomicEvents();
  return Array.isArray(events) && events.length > 0;
}
