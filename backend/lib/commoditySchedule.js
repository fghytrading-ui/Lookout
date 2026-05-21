// Commodity-specific market schedules — inventory reports, agency updates, OPEC.
// Returns the next ~7 days of relevant events.

// Map weekday → events. CME data times.
const RECURRING = {
  // Mondays
  1: [
    { name: 'Cocoa & Coffee Inventory', time: '3:30pm UK', impact: 'low', affects: ['CC=F', 'KC=F'] }
  ],
  // Tuesdays
  2: [
    { name: 'API Crude Oil Inventory (private)', time: '9:30pm UK', impact: 'medium', affects: ['CL=F','BZ=F','USO'] }
  ],
  // Wednesdays — BIG day for commodities
  3: [
    { name: 'EIA Crude Oil Inventory', time: '3:30pm UK', impact: 'high', affects: ['CL=F','BZ=F','USO'] },
    { name: 'EIA Gasoline & Distillate Stocks', time: '3:30pm UK', impact: 'medium', affects: ['RB=F','HO=F'] }
  ],
  // Thursdays
  4: [
    { name: 'EIA Natural Gas Storage', time: '3:30pm UK', impact: 'high', affects: ['NG=F','UNG'] },
    { name: 'USDA Export Sales', time: '1:30pm UK', impact: 'medium', affects: ['ZC=F','ZS=F','ZW=F'] }
  ],
  // Fridays
  5: [
    { name: 'CFTC Commitments of Traders', time: '8:30pm UK', impact: 'medium', affects: 'all' },
    { name: 'Baker Hughes Oil Rig Count', time: '6:00pm UK', impact: 'medium', affects: ['CL=F','BZ=F'] }
  ]
};

// Monthly events (approximate dates)
const MONTHLY = [
  { day: 12, name: 'OPEC Monthly Oil Report', time: '12:00pm UK', impact: 'high', affects: ['CL=F','BZ=F'] },
  { day: 15, name: 'IEA Monthly Oil Report', time: '9:00am UK', impact: 'high', affects: ['CL=F','BZ=F'] },
  { day: 10, name: 'USDA WASDE Crop Report', time: '5:00pm UK', impact: 'high', affects: ['ZC=F','ZS=F','ZW=F','SB=F'] }
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
