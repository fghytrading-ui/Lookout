// Commodity-specific market schedules — inventory reports, agency updates, OPEC.
// Returns the next ~7 days of relevant events.
//
// Release times are stored as the ET clock time the agency actually publishes
// at (EIA crude is 10:30am ET), then formatted to UK at render. They used to
// be hardcoded UK strings, which are only right while US and UK clocks are in
// step — during the ~3 weeks each March when the US has moved and the UK has
// not, every one of them was an hour late.
import { ukTimeForET } from '../utils/market.js';

// Map weekday → events. Times are ET (agency publication time).
const RECURRING = {
  // Mondays
  1: [
    { name: 'Cocoa & Coffee Inventory', et: { h: 10, m: 30 }, impact: 'low', affects: ['CC=F', 'KC=F'] }
  ],
  // Tuesdays
  2: [
    { name: 'API Crude Oil Inventory (private)', et: { h: 16, m: 30 }, impact: 'medium', affects: ['CL=F','BZ=F','USO'] }
  ],
  // Wednesdays — BIG day for commodities
  3: [
    { name: 'EIA Crude Oil Inventory', et: { h: 10, m: 30 }, impact: 'high', affects: ['CL=F','BZ=F','USO'] },
    { name: 'EIA Gasoline & Distillate Stocks', et: { h: 10, m: 30 }, impact: 'medium', affects: ['RB=F','HO=F'] }
  ],
  // Thursdays
  4: [
    { name: 'EIA Natural Gas Storage', et: { h: 10, m: 30 }, impact: 'high', affects: ['NG=F','UNG'] },
    { name: 'USDA Export Sales', et: { h: 8,  m: 30 }, impact: 'medium', affects: ['ZC=F','ZS=F','ZW=F'] }
  ],
  // Fridays
  5: [
    { name: 'CFTC Commitments of Traders', et: { h: 15, m: 30 }, impact: 'medium', affects: 'all' },
    { name: 'Baker Hughes Oil Rig Count', et: { h: 13, m: 0  }, impact: 'medium', affects: ['CL=F','BZ=F'] }
  ]
};

// Monthly events (approximate dates)
const MONTHLY = [
  { day: 12, name: 'OPEC Monthly Oil Report', et: { h: 7,  m: 0  }, impact: 'high', affects: ['CL=F','BZ=F'] },
  { day: 15, name: 'IEA Monthly Oil Report', et: { h: 4,  m: 0  }, impact: 'high', affects: ['CL=F','BZ=F'] },
  { day: 10, name: 'USDA WASDE Crop Report', et: { h: 12, m: 0  }, impact: 'high', affects: ['ZC=F','ZS=F','ZW=F','SB=F'] }
];

// One-off OPEC+ meetings (would be loaded from API in production)
const FIXED_EVENTS = [
  // Format: { date: 'YYYY-MM-DD', name, time, impact, affects }
];

export function getCommoditySchedule(daysAhead = 7) {
  const now = new Date();
  const events = [];
  const dayNames   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const wd = d.getDay();
    const dayNum = d.getDate();
    const isoDate = d.toISOString().split('T')[0];

    // Weekly recurring events (skip weekends)
    if (wd !== 0 && wd !== 6 && RECURRING[wd]) {
      for (const ev of RECURRING[wd]) {
        events.push({
          ...ev,
          // Format the stored ET publication time against THIS date, so the
          // UK time shown tracks daylight saving on both sides.
          time: ev.et ? ukTimeForET(d, ev.et.h, ev.et.m) : ev.time,
          date: isoDate,
          dayName: dayNames[wd],
          monthName: monthNames[d.getMonth()],
          dayNum,
          type: 'recurring'
        });
      }
    }
    // Monthly events
    for (const ev of MONTHLY) {
      if (ev.day === dayNum) {
        events.push({
          ...ev,
          time: ev.et ? ukTimeForET(d, ev.et.h, ev.et.m) : ev.time,
          date: isoDate,
          dayName: dayNames[wd],
          monthName: monthNames[d.getMonth()],
          dayNum,
          type: 'monthly'
        });
      }
    }
    // Fixed (manually added) events
    for (const ev of FIXED_EVENTS) {
      if (ev.date === isoDate) {
        events.push({ ...ev, dayName: dayNames[wd], monthName: monthNames[d.getMonth()], dayNum, type: 'fixed' });
      }
    }
  }

  return events.sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Drivers / fundamentals to know about for each commodity group
export const COMMODITY_DRIVERS = {
  'GC=F': { name: 'Gold', drivers: ['USD strength (DXY)', 'Real yields', 'Fed policy', 'Geopolitical risk'], inverse: ['DXY','TNX'] },
  'SI=F': { name: 'Silver', drivers: ['Industrial demand', 'USD strength', 'Gold ratio'], inverse: ['DXY'] },
  'PL=F': { name: 'Platinum', drivers: ['Auto demand', 'South African supply'], inverse: [] },
  'PA=F': { name: 'Palladium', drivers: ['Auto demand', 'Russian supply'], inverse: [] },
  'HG=F': { name: 'Copper', drivers: ['China demand', 'Industrial cycle'], inverse: ['DXY'] },
  'CL=F': { name: 'WTI Crude', drivers: ['EIA inventories (Wed)', 'OPEC+', 'US production', 'Geopolitics'], inverse: ['DXY'] },
  'BZ=F': { name: 'Brent Crude', drivers: ['OPEC+', 'Global supply/demand', 'Geopolitics'], inverse: ['DXY'] },
  'NG=F': { name: 'Natural Gas', drivers: ['EIA storage (Thu)', 'Weather forecasts', 'LNG exports'], inverse: [] },
  'HO=F': { name: 'Heating Oil', drivers: ['Winter weather', 'Crude oil'], inverse: [] },
  'RB=F': { name: 'Gasoline', drivers: ['Summer demand', 'Refinery capacity'], inverse: [] },
  'ZC=F': { name: 'Corn', drivers: ['USDA WASDE (mid-month)', 'Weather', 'Ethanol demand'], inverse: [] },
  'ZS=F': { name: 'Soybeans', drivers: ['China demand', 'USDA reports', 'Brazil harvest'], inverse: [] },
  'ZW=F': { name: 'Wheat', drivers: ['Global supply', 'Black Sea exports', 'Weather'], inverse: [] }
};
