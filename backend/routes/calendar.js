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

export function getEconomicEvents() {
  const now = new Date();
  const dayNames   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const weeklyTemplates = {
    1: [{ name: 'NY Empire State Mfg Index', time: '1:30pm UK', impact: 'medium', expected: '–5.0', previous: '–8.1' }],
    2: [
      { name: 'Core CPI (MoM)',  time: '1:30pm UK', impact: 'high',   expected: '0.3%', previous: '0.4%' },
      { name: 'CPI (YoY)',       time: '1:30pm UK', impact: 'high',   expected: '2.4%', previous: '2.4%' }
    ],
    3: [
      { name: 'Core PPI (MoM)',              time: '1:30pm UK', impact: 'high',   expected: '0.3%',  previous: '0.1%'  },
      { name: 'Crude Oil Inventories (EIA)', time: '3:30pm UK', impact: 'medium', expected: '–1.2M', previous: '0.8M'  },
      { name: 'Retail Sales (MoM)',          time: '1:30pm UK', impact: 'high',   expected: '0.1%',  previous: '–0.9%' }
    ],
    4: [
      { name: 'Initial Jobless Claims',      time: '1:30pm UK', impact: 'medium', expected: '228K',   previous: '228K'   },
      { name: 'Philadelphia Fed Mfg Index',  time: '1:30pm UK', impact: 'medium', expected: '–10.9',  previous: '–26.4'  },
      { name: 'Building Permits',            time: '1:30pm UK', impact: 'medium', expected: '1.45M',  previous: '1.48M'  }
    ],
    5: [
      { name: 'Michigan Consumer Sentiment',      time: '3:00pm UK', impact: 'high',   expected: '52.0', previous: '52.2' },
      { name: 'Michigan Inflation Expectations',  time: '3:00pm UK', impact: 'medium', expected: '6.5%', previous: '6.5%' }
    ]
  };

  const events = [];
  let tradingDays = 0, offset = 0;
  while (tradingDays < 7 && offset < 14) {
    const date = new Date(now);
    date.setDate(date.getDate() + offset++);
    const wd = date.getDay();
    if (wd === 0 || wd === 6) continue;
    tradingDays++;
    (weeklyTemplates[wd] || []).forEach(tmpl => {
      events.push({
        ...tmpl,
        date: date.toISOString().split('T')[0],
        dayName: dayNames[wd],
        monthName: monthNames[date.getMonth()],
        dayNum: date.getDate()
      });
    });
  }
  return events.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function getTonightsCatalysts(events) {
  const today = new Date().toISOString().split('T')[0];
  return events
    .filter(e => e.date === today && e.impact === 'high')
    .map(e => ({
      ...e,
      longScenario:  `If ${e.name} beats expectations: expect risk-on momentum — bullish for equities, bearish for safe havens.`,
      shortScenario: `If ${e.name} misses expectations: expect risk-off rotation — bearish for growth stocks, bullish for Gold and bonds.`
    }));
}

router.get('/events', async (req, res) => {
  // Try live Forex Factory data first
  const liveEvents = await fetchLiveEconomicEvents();
  const events = liveEvents && liveEvents.length ? liveEvents : getEconomicEvents();
  const isLive = !!(liveEvents && liveEvents.length);

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
