// Live-bar synthesis.
//
// PROBLEM: indicators (RSI, MACD, ATR, SMA) are computed from Yahoo's daily
// candles. The last completed bar is yesterday's close, so during a live
// session — and during pre/post market — every indicator ignores what price
// has actually done since. The displayed price was live while the analysis
// behind the signal was not.
//
// FIX: synthesise the current, still-forming bar from the live quote and
// append (or replace) it on the candle series before indicators run. This
// keeps the daily timeframe — correct for a 1-2 session hold — while making
// the indicators reflect current price action.
//
// Extended hours are included deliberately: a stock gapping 3% in pre-market
// has genuinely changed its technical picture before the bell, and post-market
// moves carry into the next session.

function ymd(d) { return new Date(d).toISOString().split('T')[0]; }

// Pick the most relevant live price and label which session it came from.
export function getLivePrice(quote) {
  if (!quote) return null;
  if (quote.preMarketPrice > 0)  return { price: quote.preMarketPrice,  session: 'pre'  };
  if (quote.postMarketPrice > 0) return { price: quote.postMarketPrice, session: 'post' };
  if (quote.price > 0)           return { price: quote.price,           session: 'regular' };
  return null;
}

/**
 * Append or update the forming bar so indicators see current price.
 * Returns a NEW array — the input is never mutated, so cached candle data
 * stays clean for other callers.
 */
export function withLiveBar(candles, quote) {
  if (!candles?.length || !quote) return candles;
  const live = getLivePrice(quote);
  if (!live) return candles;

  const out = candles.slice();
  const last = out[out.length - 1];
  const todayKey = ymd(Date.now());
  const lastKey = ymd(last.date);

  // Day high/low from the quote when available, otherwise derive from the
  // live price so the bar is at least internally consistent.
  const dayHigh = quote.dayHigh > 0 ? quote.dayHigh : null;
  const dayLow  = quote.dayLow  > 0 ? quote.dayLow  : null;

  if (lastKey === todayKey) {
    // Today's bar already exists but may be stale — refresh it in place.
    out[out.length - 1] = {
      ...last,
      high:  Math.max(last.high, dayHigh ?? live.price, live.price),
      low:   Math.min(last.low,  dayLow  ?? live.price, live.price),
      close: live.price,
      isLive: true,
      liveSession: live.session
    };
    return out;
  }

  // No bar for today yet (pre-market, or the feed hasn't produced one).
  // Build one seeded from the previous close.
  const prevClose = last.close;
  const open = quote.open > 0 ? quote.open : prevClose;
  out.push({
    date: new Date().toISOString(),
    open,
    high:  Math.max(dayHigh ?? live.price, open, live.price),
    low:   Math.min(dayLow  ?? live.price, open, live.price),
    close: live.price,
    volume: quote.volume || 0,
    isLive: true,
    liveSession: live.session
  });
  return out;
}

/**
 * Extended-hours move relative to the last regular close.
 * Pre-market gaps and post-market drifts are real, tradeable information —
 * this exposes them as a signal input rather than a display-only field.
 */
export function getExtendedHoursMove(quote) {
  if (!quote) return null;
  const ref = quote.previousClose > 0 ? quote.previousClose : quote.price;
  if (!ref) return null;

  let price = null, session = null;
  if (quote.preMarketPrice > 0)       { price = quote.preMarketPrice;  session = 'pre';  }
  else if (quote.postMarketPrice > 0) { price = quote.postMarketPrice; session = 'post'; }
  if (price == null) return null;

  const movePct = ((price - ref) / ref) * 100;
  if (Math.abs(movePct) < 0.25) return null;   // noise

  const magnitude = Math.abs(movePct) >= 3 ? 'large'
                  : Math.abs(movePct) >= 1.5 ? 'moderate'
                  : 'small';

  return {
    session,
    price,
    referenceClose: ref,
    movePct: parseFloat(movePct.toFixed(2)),
    direction: movePct > 0 ? 'up' : 'down',
    magnitude
  };
}

/**
 * Turn an extended-hours move into signal entries.
 * Large pre-market gaps cut both ways: they confirm direction but also mean
 * the easy part of the move has already happened, so they are flagged rather
 * than treated as pure confirmation.
 */
export function extendedHoursSignals(ext) {
  if (!ext) return { signals: [], warnings: [] };
  const signals = [], warnings = [];
  const label = ext.session === 'pre' ? 'Pre-market' : 'Post-market';
  const pct = `${ext.movePct > 0 ? '+' : ''}${ext.movePct}%`;

  if (ext.magnitude === 'large') {
    warnings.push({
      type: 'warning',
      text: `${label} ${ext.direction} ${pct} — large gap, much of the move may already be done`
    });
    signals.push({
      type: ext.direction === 'up' ? 'bullish' : 'bearish',
      text: `${label} ${pct} on strong extended-hours interest`
    });
  } else if (ext.magnitude === 'moderate') {
    signals.push({
      type: ext.direction === 'up' ? 'bullish' : 'bearish',
      text: `${label} ${pct} — extended-hours momentum ${ext.direction}`
    });
  } else {
    signals.push({
      type: ext.direction === 'up' ? 'bullish' : 'bearish',
      text: `${label} drift ${pct}`
    });
  }
  return { signals, warnings };
}
