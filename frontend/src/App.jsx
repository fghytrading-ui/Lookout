import { useState, useEffect } from 'react';
import DashboardPage from './pages/DashboardPage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import AnalystPage from './pages/AnalystPage.jsx';
import ForexPage from './pages/ForexPage.jsx';
import CommoditiesPage from './pages/CommoditiesPage.jsx';
import CryptoPage from './pages/CryptoPage.jsx';
import PerformancePage from './pages/PerformancePage.jsx';
import { syncSignalBackup } from './utils/signalBackup.js';

const NAV = [
  { id: 'dashboard',   label: 'Stocks',      icon: '◎',  hint: 'Live stock swing setups' },
  { id: 'crypto',      label: 'Crypto',      icon: '₿',  hint: '24/7 crypto intraday setups' },
  { id: 'forex',       label: 'Forex',       icon: '💱', hint: 'Currency pairs' },
  { id: 'commodities', label: 'Commodities', icon: '🛢', hint: 'Metals, energy, agriculture' },
  { id: 'analyst',     label: 'Analyst',     icon: '🔍', hint: 'Analyze any symbol' },
  { id: 'performance', label: 'Performance', icon: '📊', hint: 'Auto-tracked signal outcomes + win rates' },
  { id: 'calendar',    label: 'Calendar',    icon: '📅', hint: 'Economic events' }
];

export default function App() {
  const [view, setView] = useState('dashboard');
  const [dataSource, setDataSource] = useState(null);
  const [sources, setSources] = useState(null);
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    fetch('/api/system/status')
      .then(r => r.json())
      .then(d => setDataSource(d.finnhub?.throttled ? 'throttled' : d.dataSource))
      .catch(() => {});
    // Keep the browser mirror of the signal log in sync, and push it back if
    // the server lost its disk to a Render free-tier restart. Runs on every
    // app load so the learning history survives even if the user never opens
    // the Performance page.
    // Full source roster — the badge previously named only the price feed,
    // which made it look like just two sources were running.
    fetch('/api/system/sources')
      .then(r => r.json())
      .then(setSources)
      .catch(() => {});
    syncSignalBackup().catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#080808] text-[#e8e8e8]">

      {/* ── Top navigation bar ─────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-[#080808]/95 backdrop-blur border-b border-[#151515] px-2 sm:px-4 py-2">
        <div className="flex items-center gap-2 sm:gap-4 max-w-[1600px] mx-auto flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className="w-7 h-7 rounded bg-green-500/20 border border-green-500/40 flex items-center justify-center">
              <span className="text-green-400 text-xs font-bold">◎</span>
            </div>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-bold tracking-[0.15em] sm:tracking-[0.2em] font-condensed uppercase whitespace-nowrap">Project Look Out</div>
              <div className="text-[9px] text-[#333] font-mono tracking-widest hidden sm:block">TRADING INTELLIGENCE</div>
            </div>
            {dataSource && (
              <button
                onClick={() => setShowSources(v => !v)}
                title="Click to see every live data source"
                className={`text-[9px] font-mono px-2 py-0.5 rounded border ml-2 cursor-pointer ${
                dataSource === 'polygon'       ? 'border-green-500/40 text-green-300 bg-green-500/10' :
                dataSource === 'finnhub+yahoo' ? 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10' :
                dataSource === 'throttled'     ? 'border-amber-500/50 text-amber-300 bg-amber-500/10' :
                                                  'border-[#2a2a2a] text-[#555] bg-[#0e0e0e]'
              }`} title={
                dataSource === 'polygon'       ? 'Polygon.io real-time data' :
                dataSource === 'finnhub+yahoo' ? 'Finnhub real-time stocks + Yahoo for everything else' :
                dataSource === 'throttled'     ? 'Finnhub rate limit reached — running on Yahoo, which may be delayed up to 15 minutes' :
                                                  'Yahoo Finance (free, may be delayed)'
              }>
                {dataSource === 'polygon'       && '⚡ POLYGON LIVE'}
                {dataSource === 'finnhub+yahoo' && '⚡ FINNHUB + YAHOO'}
                {dataSource === 'throttled'     && '⚠ DELAYED — FINNHUB LIMIT'}
                {dataSource === 'yahoo'         && '🟡 YAHOO'}
                {sources && <span className="ml-1 opacity-70">· {sources.activeCount}/{sources.totalCount} feeds</span>}
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 sm:ml-auto overflow-x-auto w-full sm:w-auto -mx-2 px-2 sm:mx-0 sm:px-0 no-scrollbar">
            {NAV.map(item => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                title={item.hint}
                className={`flex-shrink-0 px-2.5 sm:px-3 py-1.5 rounded text-[10px] sm:text-[11px] font-mono tracking-wider font-bold transition-colors border ${
                  view === item.id
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                    : 'border-transparent text-[#666] hover:text-[#ccc] hover:bg-[#1a1a1a]'
                }`}
              >
                <span className="mr-1 sm:mr-1.5">{item.icon}</span>{item.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Data-source panel — every feed and what it drives */}
      {showSources && sources && (
        <div className="mx-4 mt-3 p-3 rounded border border-[#1a1a1a] bg-[#0a0a0a]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-[#666] font-mono">
              Live data sources — {sources.activeCount} of {sources.totalCount} active
            </span>
            <button onClick={() => setShowSources(false)}
              className="text-[10px] text-[#555] hover:text-[#999] font-mono">close ✕</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {sources.sources.map(s => (
              <div key={s.name} className="flex items-start gap-2 text-[11px] font-mono">
                <span className={s.active ? 'text-green-400' : 'text-red-400'}>
                  {s.active ? '✓' : '✗'}
                </span>
                <span className={`font-bold ${s.active ? 'text-[#ccc]' : 'text-[#555]'}`}>{s.name}</span>
                <span className="text-[#555] text-[10px]">— {s.drives}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Active view ─────────────────────────────────────────────────── */}
      {view === 'dashboard'   && <DashboardPage />}
      {view === 'crypto'      && <CryptoPage />}
      {view === 'forex'       && <ForexPage />}
      {view === 'commodities' && <CommoditiesPage />}
      {view === 'analyst'     && <AnalystPage />}
      {view === 'performance' && <PerformancePage />}
      {view === 'calendar'    && <CalendarPage />}

      {/* ── Disclaimer ──────────────────────────────────────────────────── */}
      <div className="px-4 py-3 bg-[#060606] border-t border-[#111] mt-8">
        <p className="text-[9px] text-[#222] font-mono text-center leading-relaxed">
          Not financial advice · All prices live via Yahoo Finance (may be delayed up to 15min) · Always verify on TradingView before entering · Trading carries significant risk · Honour your stop loss
        </p>
      </div>

    </div>
  );
}
