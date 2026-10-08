// When to enter a stock card — one answer per card, right for the moment it is
// read.
//
// A card used to carry four timing hints that could contradict each other: a
// "When to enter" banner copied from the board ("ENTER NOW" on every card while
// the market was open, including cards that had to wait), a footer badge
// ("AT NEXT OPEN" on cards that enter near the close), a status line, and an
// "Enter between" box with an unsupported "avoid the last two hours". The
// server now sends each card's exact window (utils/market.js:
// stockEntryWindow) as absolute times, built from the exchange calendar, and
// everything on the page is derived from it here — so a card switches to ENTER
// NOW at 8:30pm on its own, and a half day or a holiday is right everywhere.
import { useEffect, useState } from 'react';

/** The current time, refreshed every `ms` so countdowns move. */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const UK = 'Europe/London';

/** "8:30pm" in UK time. */
export function ukTime(t) {
  return new Date(t).toLocaleTimeString('en-GB', { timeZone: UK, hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s/g, '').toLowerCase();
}

function ukDateKey(t) {
  return new Date(t).toLocaleDateString('en-CA', { timeZone: UK });
}

/** "today", "tomorrow" or "Mon 12 Oct", judged on the UK calendar. */
export function ukDay(t, now = Date.now()) {
  const key = ukDateKey(t);
  if (key === ukDateKey(now)) return 'today';
  if (key === ukDateKey(now + 86_400_000)) return 'tomorrow';
  return new Date(t).toLocaleDateString('en-GB', { timeZone: UK, weekday: 'short', day: 'numeric', month: 'short' });
}

/** "3h 20m", "28 min", "under a minute". */
export function countdown(ms) {
  if (ms <= 60_000) return 'under a minute';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24), hh = h % 24;
    return `${d}d ${hh}h`;
  }
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Where a stock card stands right now.
 *   state 'now'   — enter it now
 *   state 'later' — enter at the stated time (countdown)
 *   state 'off'   — do not enter (and why)
 * Returns null for cards without a window (crypto keeps its own display).
 */
export function entryState(trade, livePrice, now = Date.now()) {
  const w = trade?.entryWindow;
  if (!w) return null;
  const L = trade.direction === 'LONG';
  const px = Number.isFinite(livePrice) ? livePrice : trade.price;
  const past = Number.isFinite(px)
    ? (L ? (px <= trade.sl ? 'stop' : px >= trade.tp ? 'target' : null)
         : (px >= trade.sl ? 'stop' : px <= trade.tp ? 'target' : null))
    : null;
  if (past) {
    return { state: 'off', headline: "DON'T ENTER", detail: `Price is already past the ${past} — this trade is off.` };
  }
  if (trade.touchedToday) {
    return { state: 'off', headline: "DON'T ENTER", detail: `${trade.entryStatusText || 'The stop or target already traded today'}.` };
  }
  if (trade.heldBack) {
    return { state: 'off', headline: "DON'T ENTER YET", detail: trade.heldBack };
  }

  const opens = Date.parse(w.opensAt), closes = Date.parse(w.closesAt);
  if (now >= closes) {
    return { state: 'off', headline: 'WINDOW CLOSED', detail: 'The time to enter this one has passed. The next scan replaces it.' };
  }
  if (w.kind === 'now' || now >= opens) {
    return w.kind === 'lastHalfHour'
      ? { state: 'now', headline: 'ENTER NOW',
          detail: `Last 30 minutes — enter at market before ${ukTime(closes)} UK (${countdown(closes - now)} left). Keep the printed stop and target.`,
          closesAt: closes }
      : { state: 'now', headline: 'ENTER NOW',
          detail: `Enter at market — the US market is open until ${ukTime(closes)} UK. Keep the printed stop and target.`,
          closesAt: closes };
  }

  const day = ukDay(opens, now);
  if (w.kind === 'lastHalfHour') {
    return {
      state: 'later', opensAt: opens,
      headline: `ENTER ${day} ${ukTime(opens)}–${ukTime(closes)} UK`.toUpperCase(),
      when: `${day} ${ukTime(opens)}–${ukTime(closes)} UK`,
      countIn: countdown(opens - now),
      detail: 'In the last 30 minutes before the US close — not at the open. The session after an evening '
            + 'signal usually pulls back first. Skip it if the stop or target trades before then.'
    };
  }
  return {
    state: 'later', opensAt: opens,
    headline: `ENTER AT THE OPEN — ${day} ${ukTime(opens)} UK`.toUpperCase(),
    when: `${day} ${ukTime(opens)} UK`,
    countIn: countdown(opens - now),
    detail: 'At market when the US market opens — not before. Buying pre-market tested no better and costs more.'
  };
}

/** One line for the board: is the US market open, and when does that change. */
export function clockLine(clock, session, now = Date.now()) {
  if (!clock) return null;
  const closes = clock.closesAt ? Date.parse(clock.closesAt) : null;
  const opens = clock.opensAt ? Date.parse(clock.opensAt) : null;
  // Judged from the times themselves, so the line stays right between the
  // page's status checks: open once the opening time has passed.
  const isOpen = (opens ? now >= opens : clock.isOpen) && closes && now < closes;
  if (isOpen) {
    return { open: true, text: `US market OPEN — closes ${ukTime(closes)} UK (in ${countdown(closes - now)})${clock.halfDay ? ' · half day' : ''}` };
  }
  if (opens && now < opens) {
    const label = session === 'PRE_MARKET' ? 'PRE-MARKET' : session === 'WEEKEND' ? 'WEEKEND'
                : session === 'HOLIDAY' ? 'HOLIDAY' : 'US market CLOSED';
    return { open: false, text: `${label} — opens ${ukDay(opens, now)} ${ukTime(opens)} UK (in ${countdown(opens - now)})` };
  }
  return { open: false, text: 'US market CLOSED — checking the next open…' };
}
