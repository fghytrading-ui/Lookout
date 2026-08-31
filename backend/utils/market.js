function getNYTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

export function isMarketOpen() {
  return getSession() === 'MARKET_OPEN';
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
  if (session === 'AFTER_HOURS' || session === 'HOLIDAY' || (session === 'CLOSED' && et.getHours() >= 16)) {
    next.setDate(next.getDate() + 1);
  }
  // Skip weekends AND market holidays — landing on Christmas and calling it
  // the next open is the same error as ignoring Saturday.
  let guard = 0;
  while ((next.getDay() === 0 || next.getDay() === 6 || isMarketHoliday(next)) && guard++ < 14) {
    next.setDate(next.getDate() + 1);
  }

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
  if (isMarketHoliday(et)) return 'HOLIDAY';
  const mins = et.getHours() * 60 + et.getMinutes();
  // On a half-day the closing bell is 1pm ET, so after-hours starts then.
  const close = isEarlyClose(et) ? 780 : 960;
  if (mins >= 240 && mins < 570)   return 'PRE_MARKET';
  if (mins >= 570 && mins < close) return 'MARKET_OPEN';
  if (mins >= close && mins < 1200) return 'AFTER_HOURS';
  return 'CLOSED';
}

// ── INTRADAY ENTRY / EXIT WINDOWS ────────────────────────────────────────
// These used to be fixed strings ("2:30 PM UK", "Best: 2:30 – 4:30 PM UK")
// baked into every card. Two problems: they silently went an hour wrong for
// the ~4 weeks a year when US and UK clocks change on different dates, and
// they were identical for every ticker no matter what was actually scheduled.
//
// The session anchors below are the same trading logic as before — enter on
// the opening drive, stop opening new positions in the last two hours — but
// resolved against the real ET session clock, and annotated with any event
// that lands inside the window.

// Format a given ET hour/minute on a NY day as a UK time string.
export function ukTimeForET(nyDay, etHour, etMinute = 0) {
  const y = nyDay.getFullYear(), m = nyDay.getMonth(), d = nyDay.getDate();
  // Try the EST offset first, then correct to EDT if the ET hour disagrees.
  let utc = new Date(Date.UTC(y, m, d, etHour + 5, etMinute));
  const check = parseInt(utc.toLocaleString('en-US',
    { timeZone: 'America/New_York', hour: '2-digit', hour12: false }), 10);
  if (check !== etHour) utc = new Date(Date.UTC(y, m, d, etHour + 4, etMinute));
  return utc.toLocaleString('en-GB', {
    timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true
  }).replace(/\s?(AM|PM|am|pm)/i, (x) => x.trim().toLowerCase()) + ' UK';
}

// Pick the first genuinely market-moving event due inside the trade horizon,
// so the entry advice can say "wait for the print" instead of ignoring it.
// getUpcomingMacro scores impact 1-10 (FOMC 10, CPI/NFP 9) and already
// supplies a formatted `when` and an `hoursUntil`.
function nextRelevantEvent(macroEvents = [], earnings = null) {
  const macro = (macroEvents || [])
    .filter(e => e && Number(e.impact) >= 7 && Number(e.hoursUntil) > 0)
    .sort((a, b) => a.hoursUntil - b.hoursUntil)[0];

  // Earnings inside the hold window outrank a macro print further out.
  if (earnings && (earnings.status === 'BLOCK' || earnings.status === 'WARN')
      && Number.isFinite(earnings.daysAway)) {
    const earningsHrs = earnings.daysAway * 24;
    if (!macro || earningsHrs < macro.hoursUntil) {
      return { kind: 'earnings', name: 'Earnings', when: earnings.daysAway <= 1
        ? 'within a day' : `in ${earnings.daysAway} days` };
    }
  }
  return macro ? { kind: 'macro', name: macro.label || macro.title, when: macro.when } : null;
}

export function buildIntradayTiming({
  tradeStyle, macroEvents = [], earnings = null,
  expectedDays = null, expectedDays2 = null
} = {}) {
  if (tradeStyle !== 'sameDay' && tradeStyle !== 'commodities' && tradeStyle !== 'crypto') return null;

  const et = getNYTime();
  const ev = nextRelevantEvent(macroEvents, earnings);

  // Which session do these times refer to? Outside market hours "2:30pm UK"
  // reads as today, which on a Saturday is simply wrong — the card has to name
  // the session it means. Mirrors the walk used by getEntryTiming.
  const session = getSession();
  const marketLive = session === 'MARKET_OPEN';
  let dayPrefix = '';
  if ((tradeStyle === 'sameDay' || tradeStyle === 'commodities') && !marketLive) {
    const next = new Date(et);
    if (session === 'AFTER_HOURS' || session === 'HOLIDAY' ||
        (session === 'CLOSED' && et.getHours() >= 16)) next.setDate(next.getDate() + 1);
    let guard = 0;
    while ((next.getDay() === 0 || next.getDay() === 6 || isMarketHoliday(next)) && guard++ < 14) {
      next.setDate(next.getDate() + 1);
    }
    const sameDate = next.toDateString() === et.toDateString();
    dayPrefix = sameDate ? '' : `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][next.getDay()]} `;
  }

  // Hold length must agree with the card's own estimate. These were fixed
  // strings ("End of next session", "1-2 sessions") sitting beside a headline
  // that said "about 4 sessions" — the same card gave three different answers.
  const sess = (n) => `${n} session${n === 1 ? '' : 's'}`;
  const exitBy = expectedDays2 != null
    ? `Scale at target 1 by ~${sess(expectedDays)}; close the runner by ~${sess(expectedDays2)}`
    : expectedDays != null
      ? `Close by ~${sess(expectedDays)}${expectedDays > 1 ? ' (holds overnight)' : ''}`
      : 'End of next session (may hold overnight)';
  const totalSpan = expectedDays != null
    ? (expectedDays2 != null ? `${expectedDays}–${expectedDays2} sessions` : sess(expectedDays))
    : '1–2 sessions';

  if (tradeStyle === 'crypto') {
    return {
      entryFrom:        ukTimeForET(et, 9, 30),
      entryUntil:       ukTimeForET(et, 15, 0),
      mustExitBy:       'Within ~24h (no hard close — close on TP/SL or next peak)',
      totalSession:     '24/7 (peak liquidity tracks the US equity session)',
      bestEntryWindow:  `${ukTimeForET(et, 9, 30)} – ${ukTimeForET(et, 13, 0)} (NY open + ETF inflows + CME volume)`,
      avoidWindow:      `after ${ukTimeForET(et, 16, 0)} and all weekend (US-close drainage, Asia thin, weekend wicks)`,
      eventNote: ev ? `${ev.name} ${ev.when} — expect a volatility spike; enter after it prints` : null
    };
  }

  return {
    entryFrom:       `${dayPrefix}${ukTimeForET(et, 9, 30)}`,      // US open
    entryUntil:      ukTimeForET(et, 14, 0),                       // stop opening late
    mustExitBy:      exitBy,
    totalSession:    totalSpan,
    bestEntryWindow: `${dayPrefix}${ukTimeForET(et, 9, 30)} – ${ukTimeForET(et, 11, 30)} (opening drive — deepest liquidity)`,
    avoidWindow:     `${ukTimeForET(et, 14, 0)} – ${ukTimeForET(et, 16, 0)} (final two hours)`,
    eventNote: ev
      ? (ev.kind === 'earnings'
          ? `Earnings ${ev.when} — enter before it, or wait until the reaction settles`
          : `${ev.name} ${ev.when} — hold off until the print, then enter on the reaction`)
      : null
  };
}

// ── US MARKET HOLIDAYS ───────────────────────────────────────────────────
// getSession only ruled out Saturday and Sunday, so on Christmas Day or
// Thanksgiving the board reported MARKET_OPEN and told the user to enter a
// trade into a shut exchange — the same fault as the weekend case.
//
// These are computed from the NYSE rules rather than kept as a date table,
// so the calendar cannot silently go stale a year from now.

const nthWeekdayOfMonth = (y, month, weekday, n) => {
  const first = new Date(Date.UTC(y, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(y, month, 1 + offset + (n - 1) * 7));
};
const lastWeekdayOfMonth = (y, month, weekday) => {
  const last = new Date(Date.UTC(y, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(y, month + 1, 0 - offset));
};
// Anonymous Gregorian algorithm.
const easterSunday = (y) => {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month, day));
};
// A fixed-date holiday falling at the weekend is observed on the adjacent weekday.
const observed = (d) => {
  const day = d.getUTCDay();
  if (day === 6) return new Date(d.getTime() - 86400000);
  if (day === 0) return new Date(d.getTime() + 86400000);
  return d;
};
const ymd = (d) => d.toISOString().slice(0, 10);

function marketHolidays(y) {
  const easter = easterSunday(y);
  return new Set([
    observed(new Date(Date.UTC(y, 0, 1))),                    // New Year's Day
    nthWeekdayOfMonth(y, 0, 1, 3),                            // MLK Day
    nthWeekdayOfMonth(y, 1, 1, 3),                            // Presidents' Day
    new Date(easter.getTime() - 2 * 86400000),                // Good Friday
    lastWeekdayOfMonth(y, 4, 1),                              // Memorial Day
    observed(new Date(Date.UTC(y, 5, 19))),                   // Juneteenth
    observed(new Date(Date.UTC(y, 6, 4))),                    // Independence Day
    nthWeekdayOfMonth(y, 8, 1, 1),                            // Labor Day
    nthWeekdayOfMonth(y, 10, 4, 4),                           // Thanksgiving
    observed(new Date(Date.UTC(y, 11, 25)))                   // Christmas
  ].map(ymd));
}

export function isMarketHoliday(nyDate = getNYTime()) {
  const key = `${nyDate.getFullYear()}-${String(nyDate.getMonth() + 1).padStart(2, '0')}-${String(nyDate.getDate()).padStart(2, '0')}`;
  return marketHolidays(nyDate.getFullYear()).has(key);
}

// NYSE closes at 1pm ET the day after Thanksgiving and on Christmas Eve,
// and the day before Independence Day when that falls on a weekday.
export function isEarlyClose(nyDate = getNYTime()) {
  const y = nyDate.getFullYear();
  const key = `${y}-${String(nyDate.getMonth() + 1).padStart(2, '0')}-${String(nyDate.getDate()).padStart(2, '0')}`;
  const dayAfterThanksgiving = new Date(nthWeekdayOfMonth(y, 10, 4, 4).getTime() + 86400000);
  const christmasEve = new Date(Date.UTC(y, 11, 24));
  const julyThird = new Date(Date.UTC(y, 6, 3));
  const weekday = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
  const dates = [dayAfterThanksgiving];
  if (weekday(christmasEve)) dates.push(christmasEve);
  if (weekday(julyThird)) dates.push(julyThird);
  return dates.map(ymd).includes(key);
}

// ── FOREX AND FUTURES SESSIONS ──────────────────────────────────────────
//
// Both markets were falling through to getEntryTiming(), which models the US
// equity day. That is simply the wrong calendar for either of them, and it
// showed: on a Saturday the board told you to place a forex order for "Mon
// 2:30pm UK" when FX actually reopens Sunday evening, and on any weekday
// evening it reported forex closed while it was trading normally.

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Minutes since Sunday 00:00 ET — makes "is it inside the week's session"
// a single comparison instead of a pile of day/hour special cases.
function etWeekMinutes(et = getNYTime()) {
  return et.getDay() * 24 * 60 + et.getHours() * 60 + et.getMinutes();
}

function nextWeekday(et, targetDow) {
  const d = new Date(et);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== targetDow);
  return d;
}

/**
 * Spot FX: continuous from Sunday 17:00 ET to Friday 17:00 ET.
 * No daily close, no exchange holidays — liquidity thins, it does not stop.
 */
export function getForexEntryTiming(et = getNYTime()) {
  const OPEN  = 0 * 1440 + 17 * 60;   // Sunday 17:00 ET
  const CLOSE = 5 * 1440 + 17 * 60;   // Friday  17:00 ET
  const now = etWeekMinutes(et);

  if (now >= OPEN && now < CLOSE) {
    return { label: 'ENTER NOW', urgency: 'now',
             detail: 'Forex trades around the clock Sunday evening to Friday evening — the market is open' };
  }
  // Closed: the weekend gap between Friday 5pm and Sunday 5pm ET.
  const sunday = et.getDay() === 0 && now < OPEN ? new Date(et) : nextWeekday(et, 0);
  const uk = ukTimeForET(sunday, 17);
  const sameDay = sunday.toDateString() === et.toDateString();
  return {
    label: `ENTER ${sameDay ? '' : DAY[0] + ' '}${uk}`.replace(/\s+/g, ' ').trim(),
    detail: `Forex is shut for the weekend — it reopens Sunday at ${uk}`,
    urgency: 'wait'
  };
}

/**
 * CME futures (the =F tickers): Sunday 18:00 ET to Friday 17:00 ET, with a
 * one-hour maintenance halt each weekday at 17:00 ET.
 */
export function getFuturesEntryTiming(et = getNYTime()) {
  const OPEN  = 0 * 1440 + 18 * 60;   // Sunday 18:00 ET
  const CLOSE = 5 * 1440 + 17 * 60;   // Friday  17:00 ET
  const now = etWeekMinutes(et);
  const inWeek = now >= OPEN && now < CLOSE;

  if (inWeek) {
    // Daily halt 17:00-18:00 ET, Monday through Thursday.
    const mins = et.getHours() * 60 + et.getMinutes();
    if (mins >= 17 * 60 && mins < 18 * 60) {
      const uk = ukTimeForET(et, 18);
      return { label: `ENTER ${uk}`, urgency: 'soon',
               detail: `Daily maintenance break — futures reopen at ${uk}` };
    }
    return { label: 'ENTER NOW', urgency: 'now',
             detail: 'Futures trade almost around the clock — the market is open' };
  }
  const sunday = et.getDay() === 0 && now < OPEN ? new Date(et) : nextWeekday(et, 0);
  const uk = ukTimeForET(sunday, 18);
  const sameDay = sunday.toDateString() === et.toDateString();
  return {
    label: `ENTER ${sameDay ? '' : 'Sun '}${uk}`.replace(/\s+/g, ' ').trim(),
    detail: `Futures are shut for the weekend — they reopen Sunday at ${uk}`,
    urgency: 'wait'
  };
}

/** A commodity board holds both futures (=F) and US-listed ETFs. */
export function getCommodityEntryTiming(ticker, et = getNYTime()) {
  return String(ticker || '').endsWith('=F')
    ? getFuturesEntryTiming(et)
    : getEntryTiming();
}


/**
 * How much of the regular session has elapsed, 0 to 1.
 *
 * Volume compared against a FULL DAY'S average is meaningless eight minutes
 * after the bell: every stock is trading at 3% of its daily average because
 * 97% of the day has not happened. That comparison sat harmless while the
 * average-volume field was null and the check never ran; the moment it was
 * fixed, the reviewer began rejecting every setup each morning for "no
 * conviction" and the board came up empty until late in the session.
 *
 * Returns 1 outside regular hours, so a completed or not-yet-started session
 * compares against the whole day as before.
 */
export function sessionProgress(et = getNYTime()) {
  const mins = et.getHours() * 60 + et.getMinutes();
  const open = 9 * 60 + 30, close = 16 * 60;
  if (mins <= open) return 1;          // pre-market: yesterday's full day
  if (mins >= close) return 1;         // done
  return Math.max(0.02, (mins - open) / (close - open));
}

/**
 * Volume so far against what would be normal BY NOW.
 *
 * Intraday volume is U-shaped rather than flat — roughly a third of the day
 * trades in the first hour and the last — so a straight linear expectation
 * understates the early session and would still flag healthy opens as thin.
 * The curve below is a coarse fit to that shape: ahead of linear early,
 * catching up by the close.
 */
export function volumeVsExpected(volumeSoFar, avgDailyVolume, et = getNYTime(), opts = {}) {
  if (!(volumeSoFar > 0) || !(avgDailyVolume > 0)) return null;
  // A 24/7 market has no session to be partway through, so scaling by the US
  // equity clock would read a normal crypto day as several times its average.
  const p = opts.alwaysOpen ? 1 : sessionProgress(et);
  const expectedFraction = p >= 1 ? 1 : Math.min(1, Math.pow(p, 0.62));
  return volumeSoFar / (avgDailyVolume * expectedFraction);
}
