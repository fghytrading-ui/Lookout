import { Router } from 'express';
import { fetchLiveEconomicEvents } from '../lib/economicCalendarLive.js';
import { fetchFull } from '../lib/yahoo.js';

const router = Router();

// Macro context was a hardcoded array written in 2025 and still being served
// as current market context — it claimed "Next FOMC: June 18, 2025", WTI at
// ~$63 (live: $86), DXY near 101 (live: 98.8) and QQQ resistance at 490 (live:
// $713). Stale numbers presented as fact are worse than no numbers, because
// the page invites you to plan trades around them.
//
// Everything here is now derived from live quotes, and any line whose data
// fails to load is dropped rather than guessed. Claims that cannot be verified
// from market data — central-bank policy, OPEC decisions, geopolitics — have
// been removed instead of being asserted from memory.
const sma = (candles, n) => {
  if (!candles || candles.length < n) return null;
  const slice = candles.slice(-n);
  return slice.reduce((a, c) => a + c.close, 0) / n;
};
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

async function getMacroContext() {
  const [wti, dxy, spy, qqq, vix, gold] = await Promise.all(
    ['CL=F', 'DX-Y.NYB', 'SPY', 'QQQ', '^VIX', 'GC=F']
      .map(t => fetchFull(t, '1y').catch(() => null))
  );

  const out = [];

  if (wti?.quote?.price) {
    out.push({ type: 'energy', icon: '🛢',
      text: `WTI Crude $${wti.quote.price.toFixed(2)}/bbl, ${pct(wti.quote.changePercent)} today` });
  }

  if (dxy?.quote?.price) {
    const d200 = sma(dxy.candles, 200);
    const tone = d200 ? (dxy.quote.price > d200
      ? 'dollar strength — a headwind for commodities and EM'
      : 'dollar weakness — supportive for commodities and EM') : null;
    out.push({ type: 'dollar', icon: '💵',
      text: `DXY ${dxy.quote.price.toFixed(2)}, ${pct(dxy.quote.changePercent)} today${tone ? ` · ${tone}` : ''}` });
  }

  if (gold?.quote?.price) {
    out.push({ type: 'metals', icon: '🥇',
      text: `Gold $${Math.round(gold.quote.price)}/oz, ${pct(gold.quote.changePercent)} today` });
  }

  if (spy?.quote?.price) {
    const s200 = sma(spy.candles, 200);
    out.push({ type: 'technicals', icon: '📈',
      text: s200
        ? `SPY $${spy.quote.price.toFixed(2)} — ${spy.quote.price > s200 ? 'above' : 'below'} its 200 SMA ($${s200.toFixed(2)})`
        : `SPY $${spy.quote.price.toFixed(2)}, ${pct(spy.quote.changePercent)} today` });
  }

  if (qqq?.quote?.price) {
    const q50 = sma(qqq.candles, 50);
    out.push({ type: 'technicals', icon: '💻',
      text: q50
        ? `QQQ $${qqq.quote.price.toFixed(2)} — ${qqq.quote.price > q50 ? 'above' : 'below'} its 50 SMA ($${q50.toFixed(2)})`
        : `QQQ $${qqq.quote.price.toFixed(2)}, ${pct(qqq.quote.changePercent)} today` });
  }

  if (vix?.quote?.price) {
    const v = vix.quote.price;
    const regime = v < 15 ? 'calm — trend-following favoured'
                 : v < 20 ? 'normal volatility'
                 : v < 30 ? 'elevated — size down and widen stops'
                          : 'high fear — expect violent two-way moves';
    out.push({ type: 'volatility', icon: '📊', text: `VIX ${v.toFixed(2)} · ${regime}` });
  }

  return out;
}

// getEconomicEvents() (a hand-written weekly event template) was removed —
// it was the source of the fabricated calendar described above.

// The scenarios were one fixed pair of sentences reused for every event:
// "beats expectations -> risk-on". That is backwards for the events that
// matter most. A hot CPI beats expectations and is risk-OFF, because it pushes
// rate expectations up; the same is true of PPI, and unemployment and jobless
// claims are inverted metrics where a higher number is the bad one.
//
// Each event is classified by how a HIGHER-than-expected print actually reads.
// Anything unrecognised gets no scenario at all rather than a confident guess.
const EVENT_POLARITY = [
  { match: /\bCPI\b|Consumer Price|Core PCE|\bPPI\b|Producer Price|Inflation Expectations/i,
    higherIs: 'hawkish' },
  { match: /Federal Funds Rate|Interest Rate Decision|\bFOMC\b/i, higherIs: 'hawkish' },
  { match: /Unemployment Rate|Jobless Claims/i, higherIs: 'weak' },
  { match: /Non[- ]?Farm|\bNFP\b|\bGDP\b|Retail Sales|\bPMI\b|Consumer Sentiment|Durable Goods|Industrial Production/i,
    higherIs: 'strong' }
];

function scenariosFor(name) {
  const hit = EVENT_POLARITY.find(p => p.match.test(name || ''));
  if (!hit) return { longScenario: null, shortScenario: null };

  if (hit.higherIs === 'hawkish') {
    return {
      longScenario:  `A COOLER ${name} than forecast is the bullish outcome — it eases rate pressure, lifting equities and gold.`,
      shortScenario: `A HOTTER ${name} than forecast is the bearish outcome — rate expectations rise, hitting growth stocks hardest.`
    };
  }
  if (hit.higherIs === 'weak') {
    return {
      longScenario:  `A LOWER ${name} than forecast points to a resilient economy — supportive for equities.`,
      shortScenario: `A HIGHER ${name} than forecast signals labour-market weakness — risk-off, bid for bonds and gold.`
    };
  }
  return {
    longScenario:  `A STRONGER ${name} than forecast is risk-on — bullish equities, bearish safe havens.`,
    shortScenario: `A WEAKER ${name} than forecast is risk-off — bearish growth stocks, bullish gold and bonds.`
  };
}

function getTonightsCatalysts(events) {
  const today = new Date().toISOString().split('T')[0];
  return events
    .filter(e => e.date === today && e.impact === 'high')
    .map(e => ({ ...e, ...scenariosFor(e.name || e.title) }));
}

router.get('/events', async (req, res) => {
  // Try live Forex Factory data first
  // Previously fell back to a fixed weekly template with invented forecast
  // figures, and the UI simply dropped its "LIVE" badge — so fabricated events
  // were indistinguishable from real ones. If the feed is down we now say so
  // and show nothing rather than inventing a calendar.
  const liveEvents = await fetchLiveEconomicEvents();
  const isLive = !!(liveEvents && liveEvents.length);
  const events = isLive ? liveEvents : [];

  const macro     = await getMacroContext().catch(() => []);
  const catalysts = getTonightsCatalysts(events);
  res.json({
    events,
    macro,
    catalysts,
    source: isLive ? 'live' : 'template',
    isLive,
    timestamp: new Date().toISOString()
  });
});

router.get('/macro', async (req, res) => {
  const context = await getMacroContext().catch(() => []);
  res.json({ context, timestamp: new Date().toISOString() });
});

export default router;
