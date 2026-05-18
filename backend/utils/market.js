function getNYTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

export function isMarketOpen() {
  const et = getNYTime();
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 570 && mins < 960;
}

// Convert a date to UK time string showing London hour for US market open
function getUKMarketOpenTime() {
  // 9:30 AM ET → UK time. ET is either EST (-5) or EDT (-4)
  // UK is either GMT (0) or BST (+1)
  // Most of US market hours overlap: 9:30 ET = 14:30 UK (winter) or 14:30 UK (summer)
  // Both align at 14:30 UK because daylight savings rollovers happen ~2 weeks apart
  // To be safe, calculate it dynamically from a known reference
  const now = new Date();
  // Construct 9:30 AM ET today
  const etDateStr = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  etDateStr.setHours(9, 30, 0, 0);
  // Now express that moment in UK time
  const utcEquivalent = new Date(etDateStr.toLocaleString('en-US', { timeZone: 'UTC' }));
  // Use toLocaleString with Europe/London
  const ukHHMM = new Date().toLocaleString('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
  });
  return { ukHHMM };
}

// Compute the UK time string equivalent to 9:30 AM ET on a specific NY day
function ukTimeFor930AMET(nyDay) {
  // Build the exact ET timestamp for that day at 9:30 AM
  // Then format it as UK time
  const year = nyDay.getFullYear();
  const month = nyDay.getMonth();
  const date = nyDay.getDate();

  // Create date that represents 9:30 AM ET on that date
  // We use a known offset trick: format from a UTC date that is 14:30 UTC (assuming EST in winter)
  // Best approach: convert via toLocaleString
  // ET 9:30 AM = UTC 13:30 (EDT) or 14:30 (EST)
  // Build a candidate UTC time and verify
  const candidateUTC = new Date(Date.UTC(year, month, date, 14, 30)); // EST guess
  const etHourFromCandidate = parseInt(candidateUTC.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }), 10);
  const adjustedUTC = etHourFromCandidate === 9
    ? candidateUTC
    : new Date(Date.UTC(year, month, date, 13, 30)); // EDT
  // Format as 12-hour with am/pm e.g. "2:30pm"
  const formatted = adjustedUTC.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
  return formatted.replace(/\s?(AM|PM|am|pm)/i, (m) => m.trim().toLowerCase());
}

// Returns smart entry instructions in UK time
export function getEntryTiming() {
  const session = getSession();
  const et = getNYTime();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (session === 'MARKET_OPEN') {
    return { label: 'ENTER NOW', detail: 'Market is OPEN — place limit order at entry price', urgency: 'now' };
  }

  if (session === 'PRE_MARKET') {
    const ukTime = ukTimeFor930AMET(et);
    return { label: `ENTER AT ${ukTime} UK`, detail: `Markets open at ${ukTime} UK time — set limit order now`, urgency: 'soon' };
  }

  // For AFTER_HOURS, CLOSED, WEEKEND — find next market open
  const next = new Date(et);
  if (session === 'AFTER_HOURS' || (session === 'CLOSED' && et.getHours() >= 16)) {
    next.setDate(next.getDate() + 1);
  }
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);

  const isTomorrow = next.toDateString() === new Date(et.getTime() + 86400000).toDateString();
  const dayLabel = isTomorrow ? 'TOMORROW' : `${dayNames[next.getDay()]} ${next.getDate()}`;
  const ukTime = ukTimeFor930AMET(next);

  return {
    label: `ENTER ${dayLabel} ${ukTime} UK`,
    detail: `Market closed — place limit order for ${ukTime} UK open`,
    urgency: 'wait'
  };
}

export function getSession() {
  const et = getNYTime();
  const day = et.getDay();
  if (day === 0 || day === 6) return 'WEEKEND';
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins >= 240 && mins < 570)  return 'PRE_MARKET';
  if (mins >= 570 && mins < 960)  return 'MARKET_OPEN';
  if (mins >= 960 && mins < 1200) return 'AFTER_HOURS';
  return 'CLOSED';
}
