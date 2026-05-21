// Risk guardrails: daily P&L limit + sector concentration check
import { loadJournal } from '../components/TradeJournal.jsx';

const STORAGE_KEY = 'lookout-risk-guard';

const DEFAULTS = {
  dailyLossLimitPct: 3,      // -3% daily account loss = lockout
  maxConcurrentPositions: 5, // never hold more than 5 positions
  maxSectorConcentration: 3  // never more than 3 positions in same sector
};

export function loadGuardSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch { return DEFAULTS; }
}
export function saveGuardSettings(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

// Calculate today's realized P&L from journal
export function getTodaysPnL() {
  const journal = loadJournal();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const start = startOfDay.getTime();
  const todayTrades = journal.filter(t => t.closedAt >= start);
  const pnl = todayTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  return { pnl, count: todayTrades.length };
}

// Decide whether to allow a new trade
export function evaluateRiskGuard(positions, accountSize, candidateTicker, candidateSector, sectorMap = {}) {
  const settings = loadGuardSettings();
  const { pnl, count } = getTodaysPnL();
  const dailyLossDollar = -accountSize * (settings.dailyLossLimitPct / 100);

  const issues = [];

  // 1. Daily loss limit
  if (pnl <= dailyLossDollar) {
    issues.push({
      severity: 'block',
      text: `Daily loss limit hit: ${pnl.toFixed(0)} ≤ ${dailyLossDollar.toFixed(0)}. No more trades today.`
    });
  } else if (pnl <= dailyLossDollar * 0.7) {
    issues.push({
      severity: 'warn',
      text: `Approaching daily loss limit (P&L $${pnl.toFixed(0)} of ${dailyLossDollar.toFixed(0)} limit).`
    });
  }

  // 2. Max concurrent positions
  if (positions.length >= settings.maxConcurrentPositions) {
    issues.push({
      severity: 'block',
      text: `Max ${settings.maxConcurrentPositions} concurrent positions. Close one first.`
    });
  }

  // 3. Sector concentration
  if (candidateSector && candidateSector !== 'N/A') {
    const sameSectorCount = positions.filter(p => sectorMap[p.ticker] === candidateSector).length;
    if (sameSectorCount >= settings.maxSectorConcentration) {
      issues.push({
        severity: 'block',
        text: `Already ${sameSectorCount} positions in ${candidateSector}. Sector concentration limit reached.`
      });
    } else if (sameSectorCount >= 2) {
      issues.push({
        severity: 'warn',
        text: `${sameSectorCount} other positions already in ${candidateSector} — high correlation risk.`
      });
    }
  }

  const blocked = issues.some(i => i.severity === 'block');
  return { blocked, issues, settings, todaysPnL: pnl, todaysCount: count };
}
