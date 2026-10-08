// The stock trade the board would offer, built in one place.
//
// The analyst page used to build its own setup from the same engine with
// different inputs: no market regime, no learned stop ceiling or target, no
// hourly refinement, and no shorts rule. So the same stock could show one set
// of levels on the board and another on the analyst page, with the analyst's
// version never graded or learned from. Both now call these.
import { fetchFull } from './yahoo.js';
import { calculateSMA, analyzeSignals, generateTradeSetup } from '../utils/signals.js';
import { getSession, inLastHalfHour } from '../utils/market.js';

// Market regime on the horizon this software actually trades.
//
// This used to require SPY below its 50-day average AND the 50-day below the
// 200-day — a structural bear market that takes months to form. Measured over
// the last 2 years that was true on 0 of 300 sessions, so the SHORT gate was
// not a filter at all: it was an off switch.
//
// It is also the wrong question. A trade held 24-72 hours does not care where
// price sits against a 200-day average; it cares what the market has done in
// the last few sessions. The same rule on a 1-5 day window reads BEARISH on
// about 30% of sessions, which is what a day-trading system needs.
export async function getMarketRegime() {
  try {
    const spy = await fetchFull('SPY', '3mo');
    const closes = spy.candles.map(c => c.close);
    const price  = spy.quote.price;
    if (closes.length < 12) return 'NEUTRAL';

    const ret = (n) => ((price - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100;
    const d1 = ret(1);          // today
    const d3 = ret(3);          // this week so far
    const sma10 = calculateSMA(closes, 10);

    // A sharp single session, a sustained three-day slide, or trading under the
    // 10-day average while still drifting down — any of those is risk-off for a
    // position measured in hours.
    if (d1 <= -1.0 || d3 <= -1.5 || (sma10 && price < sma10 && d3 < -0.3)) return 'BEARISH';
    if (d1 >=  1.0 || d3 >=  1.5 || (sma10 && price > sma10 && d3 >  0.3)) return 'BULLISH';
    return 'NEUTRAL';
  } catch { return 'NEUTRAL'; }
}

// A short needs EITHER a risk-off market OR evidence the stock itself is
// breaking down: falling hard today under its own 20 and 50-day averages, or
// a slower bleed that is still clearly one-directional. The index gets a vote,
// not a veto — on the day that prompted this the index moved -0.26% while
// RGTI fell 8.3%, SMCI 5.5% and SOUN 3.5% on their own news.
export function shortAllowed({ changePercent, price, signalData, marketRegime }) {
  const chgToday = changePercent ?? 0;
  const below20  = signalData.sma20 && price < signalData.sma20;
  const below50  = signalData.sma50 && price < signalData.sma50;
  const stockBreakingDown = chgToday <= -3 && below20 && below50;
  const sustainedWeakness = chgToday <= -1.5 && below20 && below50
                            && signalData.rsi != null && signalData.rsi < 45;
  const allowed = marketRegime === 'BEARISH' || stockBreakingDown || sustainedWeakness;
  return { allowed, onOwnMerit: allowed && marketRegime !== 'BEARISH' };
}

// The board re-places a stock's levels on hourly bars when the hourly setup
// agrees on direction and stays a short-term trade; otherwise the daily setup
// stands. Returns the hourly setup to use, or null.
export function hourlyRefinement(quote, hourly, { direction, market, marketRegime, dailyAtr, maxStopPct }) {
  if (!quote || !hourly || hourly.length < 120) return null;
  const hSignals = analyzeSignals(quote, hourly, marketRegime);
  const hSetup = generateTradeSetup(quote, hourly, hSignals, {
    market, tradeStyle: 'intradayStock', dailyAtr, maxStopPct
  });
  if (!hSetup || hSetup.direction !== direction) return null;
  // A refinement that turns a short-term trade into a multi-week hold is no
  // longer the trade being offered.
  if (!(hSetup.expectedDays > 0) || hSetup.expectedDays > 8) return null;
  return hSetup;
}

// Where a stock card stands right now. Market entries are off only once price
// is past a printed level. A card raised after the close (closeEntry) also
// waits for the last half hour of its session, and is off if that session
// has already traded through a level — the grader records that as never taken.
// Called again after hourly refinement moves the levels.
export function stockEntryStatus({ direction, price, sl, tp, closeEntry, dayHigh, dayLow }) {
  const L = direction === 'LONG';
  const past = L ? (price <= sl ? 'stop' : price >= tp ? 'target' : null)
                 : (price >= sl ? 'stop' : price <= tp ? 'target' : null);
  const touched = closeEntry && getSession() === 'MARKET_OPEN' && Number.isFinite(dayHigh) && Number.isFinite(dayLow)
    ? (L ? (dayLow <= sl ? 'stop' : dayHigh >= tp ? 'target' : null)
         : (dayHigh >= sl ? 'stop' : dayLow <= tp ? 'target' : null))
    : null;
  if (past || touched) {
    return { entryStatus: 'MISSED', touchedToday: !past && !!touched,
             entryStatusText: past ? `Price is already beyond the ${past} — this trade is off`
                                   : `The ${touched} already traded today — this trade is off` };
  }
  if (closeEntry && !inLastHalfHour()) {
    return { entryStatus: 'WAIT_CLOSE', touchedToday: false,
             entryStatusText: 'Raised after the close — enter in the last 30 minutes of the session, not at the open. '
                            + 'Skip it if the stop or target trades first.' };
  }
  return { entryStatus: 'IN_ZONE', touchedToday: false,
           entryStatusText: closeEntry ? 'Last half hour — enter at market now, keep the printed stop and target'
                                       : 'Enter at market — keep the printed stop and target' };
}
