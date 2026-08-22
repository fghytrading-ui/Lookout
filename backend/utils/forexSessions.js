import { ukTimeForET } from './market.js';
// Forex market awareness — sessions, opening hours, overlap windows.
// Forex trades 24/5: Sunday 5pm ET → Friday 5pm ET
// Four major sessions overlap to create different liquidity profiles.

// Returns active session info in UK time
export function getForexSession() {
  const now = new Date();
  // Forex opens/closes at 5pm New York time, so the boundary must be tested on
  // the NY clock. Testing "22:00 UK" only lines up while both sides are on the
  // same daylight-saving footing — in the March gap the true boundary is 9pm
  // UK, and the market read as closed for an hour while it was trading.
  const nyHour = parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(now), 10) % 24;
  const nyDay = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
  const reopenUK = ukTimeForET(now, 17, 0);
  // Convert to UTC for cleaner session math (sessions are defined in UTC equivalents)
  const utcHour = now.getUTCHours();
  const utcMin  = now.getUTCMinutes();
  const ukNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const day = ukNow.getDay();

  // Determine if forex market is open at all
  // Closes Friday 5pm ET, reopens Sunday 5pm ET (Sydney).
  const isWeekendClosed = (nyDay === 5 && nyHour >= 17) || nyDay === 6 || (nyDay === 0 && nyHour < 17);

  if (isWeekendClosed) {
    return {
      isOpen: false,
      session: 'WEEKEND',
      activeSessions: [],
      label: 'Forex Closed',
      detail: `Markets reopen Sunday ${reopenUK} (Sydney session)`,
      liquidity: 'NONE',
      nextOpen: `Sunday ${reopenUK}`
    };
  }

  // Forex sessions in UTC:
  //   Sydney:  21:00–06:00 UTC (next day) — i.e. evening UK
  //   Tokyo:   00:00–09:00 UTC
  //   London:  08:00–17:00 UTC (most volume here)
  //   New York: 13:00–22:00 UTC
  // OVERLAPS (highest liquidity):
  //   Tokyo + London: 08:00–09:00 UTC
  //   London + NY:    13:00–17:00 UTC  ← THE MOST ACTIVE WINDOW
  // Sessions are defined by each centre's OWN local clock, not by fixed UTC
  // hours. London trades 8am-5pm London time, which is 07:00-16:00 UTC in
  // summer and 08:00-17:00 UTC in winter; New York trades 8am-5pm ET, which
  // shifts the other way. Hardcoding UTC made every session boundary an hour
  // wrong for part of the year, including the London/NY overlap that the
  // liquidity read is based on.
  const localHour = (tz) => {
    const h = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', hour12: false
    }).format(now);
    return parseInt(h, 10) % 24;
  };
  const sydneyH = localHour('Australia/Sydney');
  const tokyoH  = localHour('Asia/Tokyo');
  const londonH = localHour('Europe/London');
  const nyH     = localHour('America/New_York');

  const inSydney  = sydneyH >= 8 && sydneyH < 17;
  const inTokyo   = tokyoH  >= 9 && tokyoH  < 18;
  const inLondon  = londonH >= 8 && londonH < 17;
  const inNY      = nyH     >= 8 && nyH     < 17;

  const activeSessions = [];
  if (inSydney) activeSessions.push('Sydney');
  if (inTokyo)  activeSessions.push('Tokyo');
  if (inLondon) activeSessions.push('London');
  if (inNY)     activeSessions.push('New York');

  // Determine liquidity
  let liquidity, label, detail;
  if (inLondon && inNY) {
    liquidity = 'PEAK';
    label = 'London + NY Overlap';
    detail = 'Highest-liquidity window of the day — best entry conditions';
  } else if (inLondon) {
    liquidity = 'HIGH';
    label = 'London Session';
    detail = 'European traders active — strong EUR/GBP volume';
  } else if (inNY) {
    liquidity = 'HIGH';
    label = 'New York Session';
    detail = 'US data + Fed-driven moves — strong USD volume';
  } else if (inTokyo && inLondon) {
    liquidity = 'HIGH';
    label = 'Tokyo + London Overlap';
    detail = 'Asia + Europe handover — JPY/EUR active';
  } else if (inTokyo) {
    liquidity = 'MEDIUM';
    label = 'Tokyo Session';
    detail = 'Asian session — JPY, AUD, NZD most active';
  } else if (inSydney) {
    liquidity = 'LOW';
    label = 'Sydney Session';
    detail = 'Quiet session — narrow ranges, avoid breakout trades';
  } else {
    liquidity = 'LOW';
    label = 'Inter-session';
    detail = 'Low liquidity window';
  }

  return {
    isOpen: true,
    session: label.replace(/\s+/g, '_').toUpperCase(),
    activeSessions,
    label,
    detail,
    liquidity,
    inLondonNYOverlap: inLondon && inNY
  };
}

// Forex entry timing — works around 24/5 schedule
export function getForexEntryTiming() {
  const s = getForexSession();
  if (!s.isOpen) {
    return {
      label: `ENTER SUN ${ukTimeForET(new Date(), 17, 0)}`,
      detail: 'Forex market closed for the weekend — reopens Sunday evening',
      urgency: 'wait'
    };
  }
  if (s.inLondonNYOverlap) {
    return {
      label: 'ENTER NOW',
      detail: 'London + NY overlap — peak liquidity, best execution',
      urgency: 'now'
    };
  }
  if (s.liquidity === 'HIGH') {
    return {
      label: 'ENTER NOW',
      detail: `${s.label} active — good liquidity for entry`,
      urgency: 'now'
    };
  }
  if (s.liquidity === 'MEDIUM') {
    return {
      label: 'WAIT FOR LONDON OPEN',
      detail: 'Lower-volatility window — consider waiting for London 8am UK for tighter spreads',
      urgency: 'soon'
    };
  }
  return {
    label: 'WAIT FOR HIGHER LIQUIDITY',
    detail: 'Low-volume session — wait for London or NY for cleaner setups',
    urgency: 'wait'
  };
}

// Crypto entry timing — 24/7 market
export function getCryptoEntryTiming() {
  return {
    label: 'ENTER NOW',
    detail: 'Crypto trades 24/7 — execute when ready',
    urgency: 'now'
  };
}
