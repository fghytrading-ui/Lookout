import { Router } from 'express';

const router = Router();

function getMacroContext() {
  return [
    { type: 'policy',       icon: '🏦', text: 'Fed holding rates at 4.25–4.50%. Next FOMC: June 18, 2025' },
    { type: 'energy',       icon: '🛢', text: 'WTI Crude ~$63/bbl. OPEC+ extending output cuts through Q3' },
    { type: 'geopolitical', icon: '⚠', text: 'Middle East tensions elevated — safe-haven flows into Gold & Treasuries' },
    { type: 'macro',        icon: '📊', text: 'CPI trending lower. Markets pricing 2× cuts in H2 2025' },
    { type: 'dollar',       icon: '💵', text: 'DXY near 101. Dollar weakness supporting commodity and EM plays' },
    { type: 'technicals',   icon: '📈', text: 'SPX holding above 200 SMA. QQQ near key resistance at 490' }
  ];
}

function getEconomicEvents() {
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

router.get('/events', (req, res) => {
  const events    = getEconomicEvents();
  const macro     = getMacroContext();
  const catalysts = getTonightsCatalysts(events);
  res.json({ events, macro, catalysts, timestamp: new Date().toISOString() });
});

router.get('/macro', (req, res) => {
  res.json({ context: getMacroContext(), timestamp: new Date().toISOString() });
});

export default router;
