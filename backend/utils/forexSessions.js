// Forex market awareness — sessions, opening hours, overlap windows.
// Forex trades 24/5: Sunday 5pm ET → Friday 5pm ET
// Four major sessions overlap to create different liquidity profiles.

// Returns active session info in UK time
export function getForexSession() {
  const now = new Date();
  // Convert to UTC for cleaner session math (sessions are defined in UTC equivalents)
  const utcHour = now.getUTCHours();
  const utcMin  = now.getUTCMinutes();
  const ukNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const day = ukNow.getDay(); // Note: forex weekend = Sat all day, Sun before 10pm UK

  // Determine if forex market is open at all
  // Closes Friday 10pm UK / Saturday 12am UK → reopens Sunday 10pm UK
  const isWeekendClosed = (day === 5 && (ukNow.getHours() >= 22)) || day === 6 || (day === 0 && ukNow.getHours() < 22);

  if (isWeekendClosed) {
    return {
      isOpen: false,
      session: 'WEEKEND',
      activeSessions: [],
      label: 'Forex Closed',
      detail: 'Markets reopen Sunday 10pm UK (Sydney session)',
      liquidity: 'NONE',
      nextOpen: 'Sunday 10pm UK'
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
  const inSydney  = utcHour >= 21 || utcHour < 6;
  const inTokyo   = utcHour < 9;
  const inLondon  = utcHour >= 8 && utcHour < 17;
  const inNY      = utcHour >= 13 && utcHour < 22;

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
      label: 'ENTER SUN 10pm UK',
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
