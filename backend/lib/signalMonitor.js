// Outcome monitor for logged signals.
//
// Every 5 minutes, walks open signals, fetches recent candles since each
// signal fired, computes MAE/MFE, and closes the signal if TP1/TP2/SL was
// hit or the horizon expired. This is what turns "logged signals" into
// "learnable outcomes" the system can use to improve.
//
// Data sources per market:
//   crypto:      Binance 1h klines (existing helper)
//   stocks/fx/c: Yahoo daily candles (already cached)

import { getOpenSignals, updateSignal } from './signalLog.js';
import { fetchCryptoCandles } from './cryptoCandles.js';
import { fetchFull } from './yahoo.js';
import { fetchIntradayCandles } from './intradayCandles.js';

const TICK_MS = 5 * 60 * 1000; // 5 min

// Hourly stock bars from the signal on. undefined when no hourly series is
// available (fall back to daily), null when the series no longer reaches back
// to the signal, [] when nothing has printed since it yet.
async function stockHourlySince(signal) {
  const ageDays = (Date.now() - signal.signaledAt) / DAY;
  const range = ageDays < 80 ? '3mo' : ageDays < 170 ? '6mo' : ageDays < 350 ? '1y' : ageDays < 700 ? '2y' : null;
  if (!range) return undefined;
  const series = await fetchIntradayCandles(signal.ticker, { interval: '60m', range });
  if (!series?.length) return undefined;
  const after = series.filter(c => new Date(c.date).getTime() >= signal.signaledAt);
  if (!after.length) return [];
  // A weekend plus a holiday is the longest honest gap before the next bar.
  if (new Date(after[0].date).getTime() - signal.signaledAt > 5 * DAY) return null;
  return after;
}

// The bars a trade must be graded on: from the signal to the end of its
// horizon. Returns null when the source cannot reach back that far, which is
// different from [] (nothing printed yet) — null means grading now would be
// a guess.
//
// This used to ask for "the latest N bars" — 200 hourly bars for crypto (eight
// days) and one month of daily bars for stocks. That holds only while the
// monitor runs continuously. Render's free tier sleeps, so a trade is often
// graded days after its horizon ended, and once it was older than the window
// it was scored on bars from a different week. A trade can only be judged on
// the bars that followed it.
const DAY = 24 * 60 * 60 * 1000;
export async function fetchCandlesSince(signal) {
  try {
    const end = Math.min(Date.now(), signal.expiresAt || Date.now());
    if (signal.market === 'crypto') {
      // Bars that OPEN at or after the signal — the bar the signal was formed
      // inside holds price action that had already happened.
      const hours = Math.ceil((end - signal.signaledAt) / 3600_000) + 2;
      const candles = await fetchCryptoCandles(signal.ticker,
        { interval: '1h', limit: Math.min(1000, Math.max(4, hours)), start: signal.signaledAt });
      if (!candles) return [];
      const after = candles.filter(c => new Date(c.date).getTime() >= signal.signaledAt);
      if (after.length && new Date(after[0].date).getTime() - signal.signaledAt > 3 * 3600_000) return null;
      return after;
    }

    // Stocks: hourly bars from the moment the card was shown. A card raised at
    // 11:00 can be acted on at 11:00, and daily bars cannot see the rest of
    // that session — the daily grader below has to skip the whole signal day
    // because its bar includes the morning before the signal. Measured
    // 2026-10-02 on 366 stock trades: graded from the next session they
    // returned -0.144R, acted on when shown -0.074R; for cards raised during
    // market hours -0.042R against +0.058R. The record was understating what
    // the cards actually did. On the next session's bars the two graders
    // agree on 166 of 168 trades, so this changes only what daily bars
    // could not see.
    if (signal.market === 'stocks') {
      const hourly = await stockHourlySince(signal);
      if (hourly !== undefined) return hourly;   // undefined: no hourly series, use daily
    }

    // Forex / commodities, and stocks without an hourly series — daily candles
    // from Yahoo, over a range long enough to reach back to the signal.
    //
    // A daily bar is stamped at midnight, so a signal written at 22:00 used to
    // match its OWN day's bar — a session that had already closed before the
    // signal existed — and the day's low took out stops that were never live.
    // It affected 167 of 306 closed signals. The first bar that can honestly
    // be scored is the next session's; compare on the market's own date.
    const ageDays = (Date.now() - signal.signaledAt) / DAY;
    const range = ageDays < 25 ? '1mo' : ageDays < 80 ? '3mo' : ageDays < 170 ? '6mo' : '1y';
    const { candles } = await fetchFull(signal.ticker, range);
    if (!candles?.length) return [];
    const signalDay = new Date(signal.signaledAt)
      .toLocaleDateString('en-CA', { timeZone: 'America/New_York' });   // YYYY-MM-DD
    const after = candles.filter(c => c.date > signalDay);
    // Weekend plus a holiday is the longest honest wait for the next session.
    if (after.length && Date.parse(after[0].date) - Date.parse(signalDay) > 5 * DAY) return null;
    return after;
  } catch {
    return [];
  }
}

// Has this bar's session closed? A daily bar once its 16:00 close has passed;
// an hourly bar only if it is the session's last (15:30-16:00) and finished.
function sessionComplete(c) {
  const start = barStartMs(c);
  if (String(c.date).length === 10) return Date.now() >= start + 6.5 * 3600_000;
  const [h, m] = new Date(start).toLocaleTimeString('en-GB',
    { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number);
  return (h % 24) * 60 + m >= 15 * 60 + 30 && Date.now() >= start + 30 * 60_000;
}

// Walk candles and determine outcome.
// Returns { reason, closePrice, mfe, mae, closedAt } or null if still open.
// When a bar's trading actually began. A daily bar is dated by its session,
// and a date read as midnight UTC is the evening BEFORE the session in New
// York — so a stock trade expiring at 08:19 ET on a Monday had that Monday's
// whole session counted against it, hours after it ended. CVX on 2026-06-01
// was booked as stopped at breakeven by a session that opened after its
// horizon. A daily bar starts at 09:30 New York time on its date.
function barStartMs(c) {
  const d = String(c.date);
  if (d.length === 10) {
    const noonUtc = new Date(d + 'T12:00:00Z');
    const nyHour = Number(noonUtc.toLocaleString('en-US',
      { timeZone: 'America/New_York', hour: '2-digit', hour12: false }));
    return Date.parse(d + 'T09:30:00Z') + (12 - nyHour) * 3600_000;   // 13:30Z in EDT, 14:30Z in EST
  }
  return new Date(d).getTime();
}

export function determineOutcome(signal, candles) {
  // No bars seen: not a result. This used to close the trade as EXPIRED at its
  // entry price — exactly 0R — whenever a fetch came back empty, which is a
  // fabricated scratch; 13 of 74 expiries in the record were that. In a system
  // running negative, invented zeros flatter it. Wait and retry instead; the
  // monitor gives up honestly (UNGRADED, excluded) only when data never comes.
  if (!candles || candles.length === 0) return null;

  const { direction, tp, tp2, sl } = signal;
  let entry = signal.entry;
  // A market entry fills at the first price after the card — the open of the
  // first bar — with the printed stop and target unchanged. If that price is
  // already past a printed level the trade as drawn does not exist, so it is
  // recorded as never taken rather than as an instant win or loss.
  let fillPrice = null;
  let preFilled = false;      // the position exists before the first bar walked
  if (signal.entryType === 'market') {
    const px = candles[0].open;
    const L = direction === 'LONG';
    if ((L && (px <= sl || px >= tp)) || (!L && (px >= sl || px <= tp))) {
      return { reason: 'NEVER_FILLED', closePrice: px, mfe: 0, mae: 0, mfePct: 0, maePct: 0,
               closedAt: new Date(candles[0].date).getTime(), scaledOut: false, fillPrice: null };
    }
    entry = px; fillPrice = px;
  }
  // A card raised after the close fills at the END of the next session, not
  // its open: that first session gives back. Measured 2026-10-08 on 133
  // evening stock cards, the session after the card moved 0.90% against it
  // (z=-3.86; -0.80% averaged per evening over 15 evenings), and the one
  // after that ran +0.83% its way. Entered at that session's close instead of
  // its open, same stop, target and expiry: +0.262R per card (z=3.31),
  // positive in all four quarters and on 14 of 19 evenings. Cards raised
  // pre-market or during the session show no giveback and keep the market
  // entry. If the first session touches the stop or the target the card said
  // to stand aside, so the trade never existed.
  if (signal.entryType === 'sessionClose') {
    const dayOf = (c) => String(c.date).length === 10 ? String(c.date)
      : new Date(c.date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const first = dayOf(candles[0]);
    const session = candles.filter(c => dayOf(c) === first);
    const rest = candles.slice(session.length);
    const L = direction === 'LONG';
    for (const c of session) {
      if ((L && (c.low <= sl || c.high >= tp)) || (!L && (c.high >= sl || c.low <= tp))) {
        return { reason: 'NEVER_FILLED', closePrice: c.close, mfe: 0, mae: 0, mfePct: 0, maePct: 0,
                 closedAt: new Date(c.date).getTime(), scaledOut: false, fillPrice: null };
      }
    }
    // Wait for the session to finish before filling at its close.
    const last = session[session.length - 1];
    if (!rest.length && !sessionComplete(last)) return null;
    const px = last.close;
    entry = px; fillPrice = px; preFilled = true;
    if (!rest.length) {
      // Filled, and nothing after the fill yet. If the trade's time has run
      // out regardless, it ends where it was entered.
      if (Date.now() > signal.expiresAt) {
        return { reason: 'EXPIRED', closePrice: px, mfe: 0, mae: 0, mfePct: 0, maePct: 0,
                 closedAt: signal.expiresAt, scaledOut: false, fillPrice: px };
      }
      return null;
    }
    candles = rest;
  }
  // Everything graded now is graded single-exit: the whole position closes at
  // TP1. This comment used to say older records "keep their tp0" and are graded
  // as thirds — they never did, because logSignal never stored tp0, so every
  // open trade has been graded single-exit since the change. That is the right
  // behaviour (it is the plan in force), but the claim was false and it misled
  // the scoring code into the same assumption. Scoring now reads the plan off
  // the grading date instead — see exitPlanOf in realisedR.js.
  //
  // tp0 is set beyond any reachable price, which makes the scale-out branches
  // below unreachable without duplicating the walk. TP1 then closes the
  // position outright. A record explicitly carrying a numeric tp0 would still
  // scale, so the thirds path stays available should the plan ever return.
  const singleExit = !Number.isFinite(signal.tp0);
  const tp0 = singleExit
    ? (direction === 'LONG' ? Infinity : -Infinity)
    : signal.tp0;
  let mfeRunning = entry;
  let maeRunning = entry;
  let closeReason = null;
  let closePrice = null;
  let closedAt = null;
  let scaledOut = false;      // first target filled — a third is already banked
  let effectiveSl = sl;       // moves to breakeven once the scale fills

  // ── HAS THE ENTRY ACTUALLY FILLED? ──────────────────────────────────
  //
  // This walker used to book the position from the signal onward without ever
  // asking whether price traded at the entry. The entry is a limit: for a long
  // on a strong RSI it is set 0.6% BELOW the market, so the trade only exists
  // if the stock dips to it. When a stock instead ran straight up, no order
  // filled, the trader held nothing — and this loop still followed the price
  // to the target and recorded a win.
  //
  // Across the tracked record that was 53 of 477 closed trades, every single
  // one of them a winner (30 TP1, 11 TP2, no stops at all — of course, since
  // an unfilled trade cannot lose), worth a phantom +58.5R. Their absence from
  // the loss column is exactly why they were invisible. Removing them takes
  // measured expectancy from -0.077R to -0.229R: the performance page has been
  // reporting a system markedly better than the one that could be traded, and
  // the gap was concentrated in the trades that looked best.
  let filled = preFilled;
  let lastInHorizon = null;   // the last bar before the trade's time ran out
  // Time stop, when the card carried one: if the trade has not gone
  // minProgress of the way to its target afterHours after the fill, close it
  // at that bar's close. Applied only to trades whose card stated it, so every
  // trade is graded under the rules it was offered with.
  const ts = signal.timeStop && Number.isFinite(signal.timeStop.afterHours) ? signal.timeStop : null;
  let fillStart = preFilled ? barStartMs(candles[0]) : null, bestProgress = 0;

  for (const c of candles) {
    // The trade ends at its horizon. Walking past it recorded stops and
    // targets hit days after the trade had expired — 8 trades in the record,
    // INJ-USD among them: expired 5 Aug, booked as stopped out on 10 Aug.
    if (signal.expiresAt && barStartMs(c) >= signal.expiresAt) break;
    lastInHorizon = c;
    const high = c.high;
    const low  = c.low;

    // A resting limit fills when price trades through it. Until then there is
    // no position, so nothing is measured — no excursion, no target, no stop.
    // On the bar the order fills, only part of the bar happened afterwards.
    // The entry is a limit away from the market, so a long fills on a dip —
    // and that bar's high usually printed BEFORE the dip. Counting it credited
    // targets reached before the trade existed and overstated how far trades
    // ran, which is what learning picks targets from. What is provable after a
    // long's fill: the low (price passed through the entry on its way down to
    // it) and the close (the last trade of the bar). Mirrored for shorts.
    let fillBar = false;
    if (!filled) {
      filled = direction === 'LONG' ? low <= entry : high >= entry;
      if (!filled) continue;
      fillBar = true;
      fillStart = barStartMs(c);
    }
    // Bar open/close direction tiebreaker: when TP AND SL are both touched
    // inside the same bar, the open→close direction tells us which came first.
    // Green bar (close > open) after a long entry → price ran up first, so TP
    // was hit before any late reversal to SL. Red bar → SL came first.
    const barBullish = c.close > c.open;
    if (direction === 'LONG') {
      const reachHigh = fillBar ? Math.max(entry, c.close) : high;   // provably after the fill
      if (reachHigh > mfeRunning) mfeRunning = reachHigh;
      bestProgress = Math.max(bestProgress, reachHigh - entry);
      if (low < maeRunning)  maeRunning = low;
      // The stop in force DURING this bar. The breakeven promotion below only
      // applies from the next bar onward: within the bar where the scale
      // fills, that bar's low may have printed before the fill, and testing it
      // against the new breakeven stop closed winners as scratches.
      const slThisBar = effectiveSl;
      if (!scaledOut && reachHigh >= tp0) { scaledOut = true; effectiveSl = entry; }
      const slHit = low <= slThisBar;
      // A single exit closes everything at TP1; a bar that also reached TP2
      // still exits at TP1. Only the thirds plan had a runner to carry on.
      const tp2Hit = !singleExit && reachHigh >= tp2;
      const tp1Hit = reachHigh >= tp;
      if (slHit || tp1Hit || tp2Hit) {
        // Both TP and SL touched in same bar — use open/close direction to
        // decide which came first (removes the previous SL-first bias).
        if (slHit && (tp1Hit || tp2Hit)) {
          // On the fill bar the stop is provably after the fill and the only
          // provable target touch is the close, which comes later still — the
          // stop was first. Elsewhere the bar's direction decides.
          if (barBullish && !fillBar) {
            // Bar rallied first, so TP was reached before any reversal
            closeReason = tp2Hit ? 'TP2' : 'TP1';
            closePrice = tp2Hit ? tp2 : tp;
          } else {
            closeReason = 'SL';
            closePrice = sl;
          }
        } else if (slHit) {
          closeReason = slThisBar === entry ? 'SCALED_BE' : 'SL';
          closePrice = slThisBar;
        } else if (tp2Hit) {
          closeReason = 'TP2'; closePrice = tp2;
        } else {
          closeReason = 'TP1'; closePrice = tp;
        }
        closedAt = new Date(c.date).getTime();
        break;
      }
      if (ts && !fillBar && barStartMs(c) >= fillStart + ts.afterHours * 3600_000 &&
          bestProgress < ts.minProgress * Math.abs(tp - entry)) {
        closeReason = 'TIME_STOP'; closePrice = c.close; closedAt = new Date(c.date).getTime();
        break;
      }
    } else { // SHORT
      const reachLow = fillBar ? Math.min(entry, c.close) : low;      // provably after the fill
      if (reachLow < mfeRunning)  mfeRunning = reachLow;
      bestProgress = Math.max(bestProgress, entry - reachLow);
      if (high > maeRunning) maeRunning = high;
      const slThisBar = effectiveSl;
      if (!scaledOut && reachLow <= tp0) { scaledOut = true; effectiveSl = entry; }
      const slHit = high >= slThisBar;
      // A single exit closes everything at TP1; a bar that also reached TP2
      // still exits at TP1. Only the thirds plan had a runner to carry on.
      const tp2Hit = !singleExit && reachLow <= tp2;
      const tp1Hit = reachLow <= tp;
      if (slHit || tp1Hit || tp2Hit) {
        if (slHit && (tp1Hit || tp2Hit)) {
          // For shorts: bearish bar (red) rallied down first → TP first —
          // except on the fill bar, where the stop is provably first.
          if (!barBullish && !fillBar) {
            closeReason = tp2Hit ? 'TP2' : 'TP1';
            closePrice = tp2Hit ? tp2 : tp;
          } else {
            closeReason = 'SL'; closePrice = sl;
          }
        } else if (slHit) {
          closeReason = slThisBar === entry ? 'SCALED_BE' : 'SL';
          closePrice = slThisBar;
        } else if (tp2Hit) {
          closeReason = 'TP2'; closePrice = tp2;
        } else {
          closeReason = 'TP1'; closePrice = tp;
        }
        closedAt = new Date(c.date).getTime();
        break;
      }
      if (ts && !fillBar && barStartMs(c) >= fillStart + ts.afterHours * 3600_000 &&
          bestProgress < ts.minProgress * Math.abs(tp - entry)) {
        closeReason = 'TIME_STOP'; closePrice = c.close; closedAt = new Date(c.date).getTime();
        break;
      }
    }
  }

  // Compute MFE/MAE in % of TP/SL distance
  let mfeAbs, maeAbs;
  if (signal.direction === 'LONG') {
    mfeAbs = mfeRunning - entry;
    maeAbs = entry - maeRunning;
  } else {
    mfeAbs = entry - mfeRunning;
    maeAbs = maeRunning - entry;
  }
  const tpDistance = Math.abs(tp - entry);
  const slDistance = Math.abs(entry - sl);
  const mfePct = tpDistance > 0 ? (mfeAbs / tpDistance) * 100 : 0;
  const maePct = slDistance > 0 ? (maeAbs / slDistance) * 100 : 0;

  // Never got in. Not a win and not a loss — the trader was flat throughout,
  // and calling it either would misstate the record.
  if (!filled) {
    if (Date.now() > signal.expiresAt) {
      return { reason: 'NEVER_FILLED', closePrice: signal.entry, mfe: 0, mae: 0,
               mfePct: 0, maePct: 0, closedAt: signal.expiresAt, scaledOut: false };
    }
    return null;   // still inside its window — the entry may yet be reached
  }

  if (closeReason) {
    return { reason: closeReason, closePrice, mfe: mfeAbs, mae: maeAbs, mfePct, maePct, closedAt, scaledOut, fillPrice };
  }

  // No TP/SL hit — check expiration. Settle at the last close inside the
  // horizon: the latest bar fetched is TODAY's, and a trade graded a week late
  // used to settle at a price from a week after it ended.
  if (Date.now() > signal.expiresAt) {
    if (!lastInHorizon) return null;   // no bar inside its window yet
    const lastClose = lastInHorizon.close;
    return {
      reason: 'EXPIRED',
      closePrice: lastClose,
      mfe: mfeAbs, mae: maeAbs, mfePct, maePct,
      closedAt: signal.expiresAt,
      scaledOut, fillPrice
    };
  }
  return null;
}

// A trade that banked its first scale and then stopped at breakeven finished
// GREEN, not red. Scoring those as losses is what made the tracked hit rate
// look like 28% when 70% of trades actually went far enough to pay something.
export function classifyOutcome(reason, scaledOut) {
  // Distinct from every other outcome: there was no position, so this is
  // neither a win nor a loss and must not be averaged in with trades that
  // were actually taken.
  if (reason === 'NEVER_FILLED') return 'NEVER_FILLED';
  if (reason === 'TP1' || reason === 'TP2') return 'WIN';
  if (reason === 'SCALED_BE') return 'SCRATCH';   // partial profit banked, runner flat
  if (reason === 'SL') return 'LOSS';
  if (reason === 'TIME_STOP') return 'TIME_STOP';   // closed early at the market: small win or small loss
  return scaledOut ? 'SCRATCH' : 'EXPIRED';
}

// How long after its horizon a trade may wait for price data before it is
// given up on. A sleeping host or a flaky feed delays grading; it should not
// decide it. Past this, guessing would be worse than leaving it out.
const GIVE_UP_AFTER = 30 * DAY;
const GIVE_UP_ATTEMPTS = 6;   // about half an hour of awake ticks, across any number of wakes

// Grade one open signal. 'closed' when it resolved, 'ungraded' when its price
// history can no longer be reached, null when it should simply wait.
//
// UNGRADED is a status of its own, neither OPEN nor CLOSED, so every
// calculation that reads closed trades leaves it out without needing to know
// it exists — an unknowable outcome is excluded, never scored as a zero.
async function gradeOne(sig) {
  const candles = await fetchCandlesSince(sig);
  const outcome = candles === null ? null : determineOutcome(sig, candles);
  if (!outcome) {
    if (Date.now() > sig.expiresAt + GIVE_UP_AFTER) {
      // One empty answer is not proof the data is gone — a rate-limited burst
      // after a long sleep looks identical. Give up only after it has failed
      // repeatedly, so a bad minute cannot write off real trades.
      const attempts = (sig.gradeAttempts || 0) + 1;
      if (attempts < GIVE_UP_ATTEMPTS) {
        updateSignal(sig.id, { gradeAttempts: attempts });
        return null;
      }
      updateSignal(sig.id, {
        status: 'UNGRADED',
        ungradedReason: candles === null
          ? 'price history no longer reaches back to the signal'
          : 'no price data for its window',
        ungradedAt: Date.now()
      });
      return 'ungraded';
    }
    return null;
  }
  updateSignal(sig.id, {
    status: 'CLOSED',
    closeReason: outcome.reason,
    closePrice: outcome.closePrice,
    mfe: outcome.mfe,
    mae: outcome.mae,
    mfePct: outcome.mfePct ?? null,
    maePct: outcome.maePct ?? null,
    closedAt: outcome.closedAt,
    timeToCloseHrs: parseFloat(((outcome.closedAt - sig.signaledAt) / (60 * 60 * 1000)).toFixed(1)),
    outcome: classifyOutcome(outcome.reason, outcome.scaledOut),
    scaledOut: !!outcome.scaledOut,
    ...(outcome.fillPrice != null ? { fillPrice: outcome.fillPrice } : {})
  });
  return 'closed';
}

export async function monitorTick() {
  const open = getOpenSignals();
  if (!open.length) return { checked: 0, closed: 0 };

  let closed = 0;
  // Conservative concurrency — be nice to Yahoo
  const concurrency = 4;
  for (let i = 0; i < open.length; i += concurrency) {
    const chunk = open.slice(i, i + concurrency);
    await Promise.allSettled(chunk.map(async (sig) => {
      if ((await gradeOne(sig)) === 'closed') closed++;
    }));
  }
  if (closed > 0) console.log(`  ✓ Monitor: closed ${closed} of ${open.length} open signals`);
  return { checked: open.length, closed };
}

// Catch-up pass: the free tier sleeps after ~15 min idle, so scheduled ticks
// are missed for hours or days at a time. Any signal already past its horizon
// is resolved immediately on wake — otherwise they pile up as permanently OPEN
// and never feed the learning loop.
export async function catchUpOverdue() {
  const open = getOpenSignals();
  const now = Date.now();
  const overdue = open.filter(s => now > s.expiresAt);
  if (!overdue.length) return { overdue: 0, closed: 0 };

  let closed = 0;
  const concurrency = 4;
  for (let i = 0; i < overdue.length; i += concurrency) {
    const chunk = overdue.slice(i, i + concurrency);
    await Promise.allSettled(chunk.map(async (sig) => {
      if ((await gradeOne(sig)) === 'closed') closed++;
    }));
  }
  console.log(`  ✓ Catch-up: resolved ${closed} of ${overdue.length} overdue signals`);
  return { overdue: overdue.length, closed };
}

export function startSignalMonitor() {
  // Catch-up runs first — clears the backlog the free tier's sleeping created.
  setTimeout(() => catchUpOverdue().catch(() => {}), 30_000);
  // [FAST-SYSTEM-101] Regular first tick delayed to 5 min so it doesn't compete
  // with the user's initial cold-cache scan for Yahoo bandwidth.
  setTimeout(() => monitorTick().catch(() => {}), 5 * 60_000);
  setInterval(() => monitorTick().catch(() => {}), TICK_MS);
  console.log('  ✓ Signal monitor started (catch-up in 30s, tick every 5 min)');
}
