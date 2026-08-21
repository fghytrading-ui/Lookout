// Performance metrics for any ticker — YTD/MTD/WTD/1Y returns + beta vs SPY
import { fetchFull } from './yahoo.js';

const r2 = (n) => Math.round(n * 100) / 100;

// Find the closest candle to a target date, but only if it is genuinely close.
//
// Without the tolerance this clamped to the OLDEST available bar whenever the
// series did not reach back to the target — so an analyst request carrying six
// months of candles reported the same ~6-month return for both "YTD" and
// "1 Year" (TSLA showed -13.16% for both). Returning null instead lets the UI
// hide a figure it cannot honestly compute.
function findCandleNear(candles, target, maxDaysAway = 10) {
  if (!candles.length) return null;
  const targetTime = target.getTime();
  let best = candles[0];
  let bestDiff = Math.abs(new Date(best.date).getTime() - targetTime);
  for (const c of candles) {
    const diff = Math.abs(new Date(c.date).getTime() - targetTime);
    if (diff < bestDiff) { best = c; bestDiff = diff; }
  }
  return bestDiff <= maxDaysAway * 86_400_000 ? best : null;
}

function pctChange(from, to) {
  if (!from || !to) return null;
  return r2(((to - from) / from) * 100);
}

// Compute beta vs SPY using last 90 days of daily returns
function computeBeta(candles, spyCandles) {
  if (candles.length < 60 || spyCandles.length < 60) return null;
  const aligned = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const spy = spyCandles.find(s => s.date === c.date);
    if (!spy) continue;
    const prevC = candles[i - 1];
    const prevSpy = spyCandles.find(s => s.date === prevC.date);
    if (!prevSpy) continue;
    aligned.push({
      r: (c.close - prevC.close) / prevC.close,
      m: (spy.close - prevSpy.close) / prevSpy.close
    });
  }
  if (aligned.length < 30) return null;
  const meanR = aligned.reduce((s, x) => s + x.r, 0) / aligned.length;
  const meanM = aligned.reduce((s, x) => s + x.m, 0) / aligned.length;
  let cov = 0, varM = 0;
  for (const x of aligned) {
    cov += (x.r - meanR) * (x.m - meanM);
    varM += (x.m - meanM) ** 2;
  }
  return varM > 0 ? r2(cov / varM) : null;
}

export async function getPerformanceMetrics(ticker, candles) {
  // Callers pass whatever range they already had (the analyst passes 6mo),
  // which is not enough for YTD or 1Y. Pull a longer series when needed.
  let series = candles || [];
  const spanDays = series.length > 1
    ? (new Date(series[series.length - 1].date) - new Date(series[0].date)) / 86_400_000
    : 0;
  if (spanDays < 370) {
    try {
      const long = await fetchFull(ticker, '2y');
      if (long?.candles?.length > series.length) series = long.candles;
    } catch { /* keep what we were given */ }
  }
  candles = series;

  const now = new Date();
  const weekAgo  = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30);
  const yearAgo  = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const ytdStart = new Date(now.getFullYear(), 0, 1);

  const current = candles[candles.length - 1];
  const wtd = pctChange(findCandleNear(candles, weekAgo)?.close,  current?.close);
  const mtd = pctChange(findCandleNear(candles, monthAgo)?.close, current?.close);
  const ytd = pctChange(findCandleNear(candles, ytdStart)?.close, current?.close);
  const yr1 = pctChange(findCandleNear(candles, yearAgo)?.close,  current?.close);

  // Average daily range as % of price
  const recent20 = candles.slice(-20);
  const avgRangePct = recent20.length ? r2(
    recent20.reduce((s, c) => s + ((c.high - c.low) / c.close), 0) / recent20.length * 100
  ) : null;

  // Beta vs SPY
  let beta = null;
  try {
    const spy = await fetchFull('SPY', '6mo');
    beta = computeBeta(candles.slice(-90), spy.candles.slice(-90));
  } catch {}

  return { wtd, mtd, ytd, yr1, avgRangePct, beta };
}
