// Live economic calendar from Forex Factory (free, no key required).
// Falls back to the static template if FF is unreachable.
import axios from 'axios';
import { registerCache } from './persistentCache.js';

const cache = new Map();
const TTL = 30 * 60 * 1000; // 30 min — calendar updates a few times per day
registerCache('economic-calendar-live', cache);

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
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
    const { data } = await axios.get(FF_URL, { headers: HEADERS, timeout: 8000 });
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

    cache.set('events', { data: events, ts: Date.now() });
    return events;
  } catch (err) {
    console.warn('[calendar] Live fetch failed, will fall back to template:', err.message);
    return null; // signals caller to use template
  }
}

// Returns true if live data is currently available
export async function isLiveCalendarAvailable() {
  const events = await fetchLiveEconomicEvents();
  return Array.isArray(events) && events.length > 0;
}
