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
      const ts = signal.signaledAt;
      return candles.filter(c => new Date(c.date).getTime() >= ts - 60 * 60 * 1000);
    }
    // Stocks / forex / commodities — daily candles from Yahoo
    const { candles } = await fetchFull(signal.ticker, '1mo');
    if (!candles?.length) return [];
    const ts = signal.signaledAt;
    return candles.filter(c => new Date(c.date).getTime() >= ts - 24 * 60 * 60 * 1000);
  } catch {
    return [];
  }
}

// Walk candles and determine outcome.
// Returns { reason, closePrice, mfe, mae, closedAt } or null if still open.
function determineOutcome(signal, candles) {
  if (!candles || candles.length === 0) {
    if (Date.now() > signal.expiresAt) {
      return { reason: 'EXPIRED', closePrice: signal.entry, mfe: 0, mae: 0, closedAt: signal.expiresAt };
    }
    return null;
  }

  const { direction, entry, tp, tp2, sl } = signal;
  let mfeRunning = entry;
  let maeRunning = entry;
  let closeReason = null;
  let closePrice = null;
  let closedAt = null;

  for (const c of candles) {
    const high = c.high;
    const low  = c.low;
    if (direction === 'LONG') {
      if (high > mfeRunning) mfeRunning = high;
      if (low < maeRunning)  maeRunning = low;
      // SL hit (intra-bar)
      if (low <= sl) {
        closeReason = 'SL';
        closePrice = sl;
        closedAt = new Date(c.date).getTime();
        break;
      }
      // TP2 hit (intra-bar) — prefer TP2 if both TP1 and TP2 in same bar
      if (high >= tp2) {
        closeReason = 'TP2';
        closePrice = tp2;
        closedAt = new Date(c.date).getTime();
        break;
      }
      // TP1 hit
      if (high >= tp) {
        closeReason = 'TP1';
        closePrice = tp;
        closedAt = new Date(c.date).getTime();
        break;
      }
    } else { // SHORT
      if (low < mfeRunning)  mfeRunning = low;
      if (high > maeRunning) maeRunning = high;
      if (high >= sl) {
        closeReason = 'SL';
        closePrice = sl;
        closedAt = new Date(c.date).getTime();
        break;
      }
      if (low <= tp2) {
        closeReason = 'TP2';
        closePrice = tp2;
        closedAt = new Date(c.date).getTime();
        break;
      }
      if (low <= tp) {
        closeReason = 'TP1';
        closePrice = tp;
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

  if (closeReason) {
    return { reason: closeReason, closePrice, mfe: mfeAbs, mae: maeAbs, mfePct, maePct, closedAt };
  }

  // No TP/SL hit — check expiration
  if (Date.now() > signal.expiresAt) {
    const lastClose = candles[candles.length - 1].close;
    return {
      reason: 'EXPIRED',
      closePrice: lastClose,
      mfe: mfeAbs, mae: maeAbs, mfePct, maePct,
      closedAt: signal.expiresAt
    };
  }
  return null;
}

function classifyOutcome(reason) {
  if (reason === 'TP1' || reason === 'TP2') return 'WIN';
  if (reason === 'SL') return 'LOSS';
  return 'EXPIRED'; // distinguished from outright loss since stop wasn't hit
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
        outcome: classifyOutcome(outcome.reason)
      });
      closed++;
    }));
  }
  if (closed > 0) console.log(`  ✓ Monitor: closed ${closed} of ${open.length} open signals`);
  return { checked: open.length, closed };
}

export function startSignalMonitor() {
  // First tick after a short delay so server boot finishes first
  setTimeout(() => monitorTick().catch(() => {}), 60_000);
  setInterval(() => monitorTick().catch(() => {}), TICK_MS);
  console.log('  ✓ Signal monitor started (tick every 5 min)');
}
