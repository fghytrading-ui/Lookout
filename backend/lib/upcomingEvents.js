// Upcoming-event awareness.
//
// Catalysts that have ALREADY happened are handled by catalystEngine. This
// module covers the other half: scheduled events that have not happened yet
// but will land inside the trade's holding window.
//
// A setup can look perfect and still be a bad trade because earnings drop
// tomorrow, or the Fed speaks in four hours. That information already existed
// in the system but was scattered — earnings in one place, the economic
// calendar in another, EIA inventories in a third — and none of it was
// attached to the trade you were about to take. This pulls it together per
// card, filtered to the events that genuinely move price.

import { fetchLiveEconomicEvents } from './economicCalendarLive.js';

// Macro releases that move the whole market, not just one name. Anything not
// on this list is noise for a 1-2 session equity trade.
const MARKET_MOVING = [
  { match: /FOMC|Federal Funds Rate|Fed Interest Rate/i, label: 'FOMC rate decision', impact: 10 },
  { match: /FOMC (Statement|Press Conference|Minutes)/i,  label: 'FOMC commentary',    impact: 8  },
  { match: /Fed Chair|Powell (Speaks|Testifies)/i,        label: 'Fed Chair speaking', impact: 8  },
  { match: /\bCPI\b|Consumer Price Index|Core CPI/i,      label: 'CPI inflation',      impact: 9  },
  { match: /Non[- ]?Farm (Payrolls|Employment)|\bNFP\b/i, label: 'Jobs report (NFP)',  impact: 9  },
  { match: /Unemployment Rate/i,                          label: 'Unemployment rate',  impact: 6  },
  { match: /\bPPI\b|Producer Price/i,                     label: 'PPI inflation',      impact: 6  },
  { match: /\bGDP\b/i,                                    label: 'GDP',                impact: 7  },
  { match: /Retail Sales/i,                               label: 'Retail sales',       impact: 6  },
  { match: /\bPCE\b|Core PCE/i,                           label: 'PCE inflation',      impact: 8  },
  { match: /ISM (Manufacturing|Services)/i,               label: 'ISM survey',         impact: 5  },
  { match: /Consumer Confidence|Consumer Sentiment/i,     label: 'Consumer sentiment', impact: 5  },
  { match: /Crude Oil Inventories/i,                      label: 'EIA crude inventory', impact: 8, energyOnly: true },
  { match: /Natural Gas Storage/i,                        label: 'EIA gas storage',     impact: 8, energyOnly: true }
];

const ENERGY_TICKERS = ['CL=F','BZ=F','NG=F','HO=F','RB=F','USO','UNG','XLE','XOM','CVX','OXY','HAL','SLB','EOG'];

function hoursUntil(iso) {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

function formatWhen(hrs) {
  if (hrs < 0) return 'now';
  if (hrs < 1) return `in ${Math.round(hrs * 60)}m`;
  if (hrs < 24) return `in ${Math.round(hrs)}h`;
  const d = Math.round(hrs / 24);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

/**
 * Scheduled macro events landing inside the trade window.
 * Fetched once per scan and shared across every card.
 */
export async function getUpcomingMacro({ windowHours = 48 } = {}) {
  try {
    const events = await fetchLiveEconomicEvents();
    if (!Array.isArray(events)) return [];

    const out = [];
    for (const e of events) {
      const title = e.title || e.name || '';
      const when = e.timestamp || e.date;
      if (!when) continue;
      const hrs = hoursUntil(when);
      if (hrs < -0.5 || hrs > windowHours) continue;   // outside the window

      const match = MARKET_MOVING.find(m => m.match.test(title));
      if (!match) continue;

      out.push({
        label: match.label,
        title,
        impact: match.impact,
        energyOnly: !!match.energyOnly,
        hoursUntil: parseFloat(hrs.toFixed(1)),
        when: formatWhen(hrs),
        timestamp: when,
        forecast: e.forecast || null,
        previous: e.previous || null
      });
    }
    return out.sort((a, b) => a.hoursUntil - b.hoursUntil);
  } catch {
    return [];
  }
}

/**
 * Build the event timeline for one card: upcoming macro that applies to it,
 * plus its own earnings date.
 *
 * Returns { events[], highestImpact, warning } or null when nothing is due.
 */
export function buildEventTimeline({ ticker, macro, earnings, market }) {
  const events = [];
  const isEnergy = ENERGY_TICKERS.includes(ticker);

  // Company earnings — the single most dangerous scheduled event for a stock
  if (earnings?.daysAway != null && earnings.daysAway <= 3) {
    events.push({
      kind: 'earnings',
      label: 'Earnings report',
      impact: 10,
      hoursUntil: earnings.daysAway * 24,
      when: earnings.daysAway === 0 ? 'today'
          : earnings.daysAway === 1 ? 'tomorrow'
          : `in ${earnings.daysAway} days`,
      critical: true
    });
  }

  // Macro — crypto is only loosely tied to these, and energy-specific
  // releases are irrelevant to a name that is not an energy product.
  for (const m of (macro || [])) {
    if (m.energyOnly && !isEnergy) continue;
    if (market === 'crypto' && m.impact < 8) continue;  // only the big ones matter for crypto
    events.push({
      kind: 'macro',
      label: m.label,
      title: m.title,
      impact: m.impact,
      hoursUntil: m.hoursUntil,
      when: m.when,
      forecast: m.forecast,
      previous: m.previous,
      critical: m.impact >= 9 && m.hoursUntil <= 24
    });
  }

  if (!events.length) return null;

  events.sort((a, b) => a.hoursUntil - b.hoursUntil);
  const highest = events.reduce((a, b) => (b.impact > a.impact ? b : a), events[0]);

  // Warning only when something genuinely dangerous lands inside the window.
  // The triggering event is returned alongside the text so callers can grade
  // severity against the RIGHT event — reading events[0] instead would judge
  // an FOMC warning by whatever minor release happens to fall first.
  let warning = null, warningEvent = null;
  const imminent = events
    .filter(e => e.hoursUntil <= 24 && e.impact >= 8)
    .sort((a, b) => b.impact - a.impact);
  if (imminent.length) {
    const e = imminent[0];
    warningEvent = e;
    warning = e.kind === 'earnings'
      ? `Earnings ${e.when} — do not hold through the report`
      : `${e.label} ${e.when} — expect a volatility spike around the release`;
  }

  return {
    events: events.slice(0, 4),
    highestImpact: highest.impact,
    nextEvent: events[0],
    warning,
    warningEvent
  };
}
