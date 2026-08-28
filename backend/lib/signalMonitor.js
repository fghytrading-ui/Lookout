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

const TICK_MS = 5 * 60 * 1000; // 5 min

// Returns intraday/4h-ish candles from signaledAt to now, per market.
async function fetchCandlesSince(signal) {
  try {
    if (signal.market === 'crypto') {
      const hoursElapsed = (Date.now() - signal.signaledAt) / (60 * 60 * 1000);
      // Use 1h bars for fine MFE/MAE on crypto. Cap at 200 bars.
      const limit = Math.min(200, Math.max(24, Math.ceil(hoursElapsed) + 4));
      const candles = await fetchCryptoCandles(signal.ticker, { interval: '1h', limit });
      if (!candles) return [];
      // Only bars that OPEN at or after the signal. The old filter allowed
      // ts - 1h, which let in the bar the signal was formed inside — price
      // action that had already happened when the signal was written.
      const ts = signal.signaledAt;
      return candles.filter(c => new Date(c.date).getTime() >= ts);
    }

    // Stocks / forex / commodities — daily candles from Yahoo.
    //
    // This filter was `>= signaledAt - 24h`, and a daily bar is stamped at
    // midnight. A signal written at 22:00 therefore matched its OWN day's bar
    // — a bar covering the entire session that had already closed before the
    // signal existed — and often the previous day's too. That day's low then
    // took out a stop sitting a few percent below an entry set at the day's
    // close, so the trade was recorded as stopped out roughly 22 hours BEFORE
    // it was signalled.
    //
    // It affected 167 of 306 closed signals. Those recorded a 6.6% win rate
    // against 50.8% for the ones scored on genuine forward bars, which is why
    // the tracked record looked worse than random and made the entry logic
    // appear to have negative edge.
    //
    // A daily bar cannot represent "the rest of the signal's day" because it
    // includes the morning, so the first bar that can honestly be scored is
    // the next session's. Compare on the market's own calendar date.
    const { candles } = await fetchFull(signal.ticker, '1mo');
    if (!candles?.length) return [];
    const signalDay = new Date(signal.signaledAt)
      .toLocaleDateString('en-CA', { timeZone: 'America/New_York' });   // YYYY-MM-DD
    return candles.filter(c => c.date > signalDay);
  } catch {
    return [];
  }
}

// Walk candles and determine outcome.
// Returns { reason, closePrice, mfe, mae, closedAt } or null if still open.
export function determineOutcome(signal, candles) {
  if (!candles || candles.length === 0) {
    if (Date.now() > signal.expiresAt) {
      return { reason: 'EXPIRED', closePrice: signal.entry, mfe: 0, mae: 0, closedAt: signal.expiresAt };
    }
    return null;
  }

  const { direction, entry, tp, tp2, sl } = signal;
  // First scale-out. Older records predate it, so derive the same 30% level
  // rather than skipping them — otherwise historical comparisons break.
  const tp0 = signal.tp0 ?? (entry + (tp - entry) * 0.30);
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
  let filled = false;

  for (const c of candles) {
    const high = c.high;
    const low  = c.low;

    // A resting limit fills when price trades through it. Until then there is
    // no position, so nothing is measured — no excursion, no target, no stop.
    if (!filled) {
      filled = direction === 'LONG' ? low <= entry : high >= entry;
      if (!filled) continue;
    }
    // Bar open/close direction tiebreaker: when TP AND SL are both touched
    // inside the same bar, the open→close direction tells us which came first.
    // Green bar (close > open) after a long entry → price ran up first, so TP
    // was hit before any late reversal to SL. Red bar → SL came first.
    const barBullish = c.close > c.open;
    if (direction === 'LONG') {
      if (high > mfeRunning) mfeRunning = high;
      if (low < maeRunning)  maeRunning = low;
      // The stop in force DURING this bar. The breakeven promotion below only
      // applies from the next bar onward: within the bar where the scale
      // fills, that bar's low may have printed before the fill, and testing it
      // against the new breakeven stop closed winners as scratches.
      const slThisBar = effectiveSl;
      if (!scaledOut && high >= tp0) { scaledOut = true; effectiveSl = entry; }
      const slHit = low <= slThisBar;
      const tp2Hit = high >= tp2;
      const tp1Hit = high >= tp;
      if (slHit || tp1Hit || tp2Hit) {
        // Both TP and SL touched in same bar — use open/close direction to
        // decide which came first (removes the previous SL-first bias).
        if (slHit && (tp1Hit || tp2Hit)) {
          if (barBullish) {
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
    } else { // SHORT
      if (low < mfeRunning)  mfeRunning = low;
      if (high > maeRunning) maeRunning = high;
      const slThisBar = effectiveSl;
      if (!scaledOut && low <= tp0) { scaledOut = true; effectiveSl = entry; }
      const slHit = high >= slThisBar;
      const tp2Hit = low <= tp2;
      const tp1Hit = low <= tp;
      if (slHit || tp1Hit || tp2Hit) {
        if (slHit && (tp1Hit || tp2Hit)) {
          // For shorts: bearish bar (red) rallied down first → TP first
          if (!barBullish) {
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
    return { reason: closeReason, closePrice, mfe: mfeAbs, mae: maeAbs, mfePct, maePct, closedAt, scaledOut };
  }

  // No TP/SL hit — check expiration
  if (Date.now() > signal.expiresAt) {
    const lastClose = candles[candles.length - 1].close;
    return {
      reason: 'EXPIRED',
      closePrice: lastClose,
      mfe: mfeAbs, mae: maeAbs, mfePct, maePct,
      closedAt: signal.expiresAt,
      scaledOut
    };
  }
  return null;
}

// A trade that banked its first scale and then stopped at breakeven finished
// GREEN, not red. Scoring those as losses is what made the tracked hit rate
// look like 28% when 70% of trades actually went far enough to pay something.
function classifyOutcome(reason, scaledOut) {
  // Distinct from every other outcome: there was no position, so this is
  // neither a win nor a loss and must not be averaged in with trades that
  // were actually taken.
  if (reason === 'NEVER_FILLED') return 'NEVER_FILLED';
  if (reason === 'TP1' || reason === 'TP2') return 'WIN';
  if (reason === 'SCALED_BE') return 'SCRATCH';   // partial profit banked, runner flat
  if (reason === 'SL') return 'LOSS';
  return scaledOut ? 'SCRATCH' : 'EXPIRED';
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
      const candles = await fetchCandlesSince(sig);
      const outcome = determineOutcome(sig, candles);
      if (!outcome) return;
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
        scaledOut: !!outcome.scaledOut
      });
      closed++;
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
      const candles = await fetchCandlesSince(sig);
      const outcome = determineOutcome(sig, candles);
      if (!outcome) return;
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
        scaledOut: !!outcome.scaledOut
      });
      closed++;
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
