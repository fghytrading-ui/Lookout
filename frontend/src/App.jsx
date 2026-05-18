import { useState } from 'react';
import DashboardPage from './pages/DashboardPage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import AnalystPage from './pages/AnalystPage.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '◎',  hint: 'Live swing setups' },
  { id: 'analyst',   label: 'Analyst',   icon: '🔍', hint: 'Analyze any stock' },
  { id: 'calendar',  label: 'Calendar',  icon: '📅', hint: 'Economic events' }
];

export default function App() {
  const [view, setView] = useState('dashboard');

  return (
    <div className="min-h-screen bg-[#080808] text-[#e8e8e8]">

      {/* ── Top navigation bar ─────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-[#080808]/95 backdrop-blur border-b border-[#151515] px-4 py-2.5">
        <div className="flex items-center gap-4 max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-green-500/20 border border-green-500/40 flex items-center justify-center">
              <span className="text-green-400 text-xs font-bold">◎</span>
            </div>
            <div>
              <div className="text-sm font-bold tracking-[0.2em] font-condensed uppercase">Project Look Out</div>
              <div className="text-[9px] text-[#333] font-mono tracking-widest">TRADING INTELLIGENCE</div>
            </div>
          </div>

          <div className="flex items-center gap-1 ml-auto">
            {NAV.map(item => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                title={item.hint}
                className={`px-3 py-1.5 rounded text-[11px] font-mono tracking-wider font-bold transition-colors border ${
                  view === item.id
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                    : 'border-transparent text-[#666] hover:text-[#ccc] hover:bg-[#1a1a1a]'
                }`}
              >
                <span className="mr-1.5">{item.icon}</span>{item.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* ── Active view ─────────────────────────────────────────────────── */}
      {view === 'dashboard' && <DashboardPage />}
      {view === 'analyst'   && <AnalystPage />}
      {view === 'calendar'  && <CalendarPage />}

      {/* ── Disclaimer ──────────────────────────────────────────────────── */}
      <div className="px-4 py-3 bg-[#060606] border-t border-[#111] mt-8">
        <p className="text-[9px] text-[#222] font-mono text-center leading-relaxed">
          Not financial advice · All prices live via Yahoo Finance (may be delayed up to 15min) · Always verify on TradingView before entering · Trading carries significant risk · Honour your stop loss
        </p>
      </div>

    </div>
  );
}
