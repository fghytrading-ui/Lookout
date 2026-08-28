import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import DashboardPage from './pages/DashboardPage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import AnalystPage from './pages/AnalystPage.jsx';
import ForexPage from './pages/ForexPage.jsx';
import CommoditiesPage from './pages/CommoditiesPage.jsx';
import CryptoPage from './pages/CryptoPage.jsx';
import PerformancePage from './pages/PerformancePage.jsx';
import { syncSignalBackup } from './utils/signalBackup.js';

// Nav is split in two: the four market scanners all render the same
// dashboard, so they collapse into one dropdown that shows whichever
// market you're currently in. The three tools stay as direct tabs.
// Keeps mobile to four tap targets instead of a seven-item scroll strip.
const MARKETS = [
  { id: 'dashboard',   label: 'Stocks',      icon: '\u25ce',  hint: 'Live stock swing setups' },
  { id: 'crypto',      label: 'Crypto',      icon: '\u20bf',  hint: '24/7 crypto intraday setups' },
  { id: 'forex',       label: 'Forex',       icon: '\ud83d\udcb1', hint: 'Currency pairs' },
  { id: 'commodities', label: 'Commodities', icon: '\ud83d\udee2', hint: 'Metals, energy, agriculture' }
];

const TOOLS = [
  { id: 'analyst',     label: 'Analyst',     icon: '\ud83d\udd0d', hint: 'Analyze any symbol' },
  { id: 'performance', label: 'Performance', short: 'Stats', icon: '\ud83d\udcca', hint: 'Auto-tracked signal outcomes + win rates' },
  { id: 'calendar',    label: 'Calendar',    icon: '\ud83d\udcc5', hint: 'Economic events' }
];

export default function App() {
  const [view, setView] = useState('dashboard');
  const [dataSource, setDataSource] = useState(null);
  const [sources, setSources] = useState(null);
  const [showSources, setShowSources] = useState(false);
  const [health, setHealth] = useState(null);
  const [learning, setLearning] = useState(null);
  const [goals, setGoals] = useState(null);
  const [marketsOpen, setMarketsOpen] = useState(false);
  const headerRef = useRef(null);
  const marketsRef = useRef(null);

  const activeMarket = MARKETS.find(m => m.id === view);

  // Publish the real header height as --nav-h so sub-headers can stick
  // directly beneath it. This was hardcoded to 52px, which broke on mobile
  // where the header is taller — the dashboard bar sat on top of the nav.
  // Runs after every render, so the offset stays exact when the header
  // grows (e.g. the feeds badge arriving from /api/system/status).
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (el) document.documentElement.style.setProperty('--nav-h', `${el.offsetHeight}px`);
  });

  // And catch changes React isn't involved in — font loads, rotation, resize.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty('--nav-h', `${el.offsetHeight}px`);
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    // resize/orientationchange are the reliable path; RO is the extra net for
    // reflows that don't move the window (font swap, badge arriving late).
    window.addEventListener('resize', publish);
    window.addEventListener('orientationchange', publish);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('orientationchange', publish);
    };
  }, []);

  // Dismiss the markets dropdown on outside click or Escape.
  useEffect(() => {
    if (!marketsOpen) return;
    const onDown = e => {
      if (marketsRef.current && !marketsRef.current.contains(e.target)) setMarketsOpen(false);
    };
    const onKey = e => { if (e.key === 'Escape') setMarketsOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [marketsOpen]);

  const go = id => { setView(id); setMarketsOpen(false); };

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
    // Self-check. Every fault found in the audit had run for weeks unnoticed
    // because nothing was looking; this runs on load so a new one surfaces on
    // its own rather than waiting to be stumbled on.
    fetch('/api/system/selfcheck')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => {});
    // What the tracked record currently says the settings should be.
    fetch('/api/system/learning')
      .then(r => r.json())
      .then(setLearning)
      .catch(() => {});
    // Whether it is doing what it exists to do.
    fetch('/api/system/goals')
      .then(r => r.json())
      .then(setGoals)
      .catch(() => {});
    syncSignalBackup().catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#080808] text-[#e8e8e8]">

      {/* ── Header: brand banner + nav row ──────────────────────── */}
      <header ref={headerRef} className="sticky top-0 z-50 bg-[#080808]/95 backdrop-blur border-b border-[#151515]">

        {/* Banner — brand always visible, never scrolls away */}
        <div className="flex items-center gap-3 px-3 sm:px-4 py-2 border-b border-[#111]">
          <div className="w-7 h-7 rounded bg-green-500/20 border border-green-500/40 flex items-center justify-center flex-shrink-0">
            <span className="text-green-400 text-xs font-bold">◎</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs sm:text-sm font-bold tracking-[0.15em] sm:tracking-[0.2em] font-condensed uppercase whitespace-nowrap">Project Look Out</div>
            <div className="text-[9px] text-[#333] font-mono tracking-widest">TRADING INTELLIGENCE</div>
          </div>
          {/* Only appears when a check fails. A green tick nobody reads is
              worse than nothing; silence is the healthy state. */}
          {health && health.status !== 'ok' && (
            <button
              onClick={() => setShowSources(v => !v)}
              title="Self-check found something — click for detail"
              className={`text-[9px] font-mono px-2 py-1 rounded border flex-shrink-0 cursor-pointer ${
                health.status === 'fail'
                  ? 'border-red-500/50 text-red-300 bg-red-500/10'
                  : 'border-amber-500/50 text-amber-300 bg-amber-500/10'
              }`}>
              {health.status === 'fail' ? '✕' : '⚠'} {health.summary}
            </button>
          )}
          {dataSource && (
            <button
              onClick={() => setShowSources(v => !v)}
              className={`text-[9px] font-mono px-2 py-1 rounded border flex-shrink-0 cursor-pointer ${
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
              {dataSource === 'polygon'       && '⚡'}
              {dataSource === 'finnhub+yahoo' && '⚡'}
              {dataSource === 'throttled'     && '⚠'}
              {dataSource === 'yahoo'         && '🟡'}
              {sources && <span className="ml-1 opacity-80">{sources.activeCount}/{sources.totalCount}</span>}
              <span className="hidden sm:inline ml-1 opacity-70">feeds</span>
            </button>
          )}
        </div>

        {/* Nav row — markets dropdown + tool tabs */}
        {/* Wraps rather than scrolls on very narrow phones — a scroll container
            would clip the markets dropdown. --nav-h re-measures either way. */}
        <nav className="flex flex-wrap items-center gap-1 sm:gap-1.5 px-1.5 sm:px-4 py-1.5 max-w-[1600px] mx-auto">

          <div className="relative flex-shrink-0" ref={marketsRef}>
            <button
              onClick={() => setMarketsOpen(v => !v)}
              aria-expanded={marketsOpen}
              aria-haspopup="menu"
              title="Switch market"
              className={`flex items-center gap-1.5 px-2 sm:px-3 py-2 rounded text-[10px] sm:text-[11px] font-mono tracking-wider font-bold transition-colors border ${
                activeMarket
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                  : 'border-[#222] text-[#666] hover:text-[#ccc] hover:bg-[#1a1a1a]'
              }`}
            >
              <span>{activeMarket ? activeMarket.icon : '◎'}</span>
              <span>{(activeMarket ? activeMarket.label : 'Markets').toUpperCase()}</span>
              <span className={`text-[8px] transition-transform ${marketsOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>

            {marketsOpen && (
              <div role="menu"
                className="absolute left-0 top-full mt-1 w-56 rounded border border-[#222] bg-[#0c0c0c] shadow-xl shadow-black/60 overflow-hidden z-50">
                <div className="px-3 py-1.5 text-[9px] uppercase tracking-widest text-[#444] font-mono border-b border-[#1a1a1a]">
                  Markets
                </div>
                {MARKETS.map(m => (
                  <button key={m.id} role="menuitem" onClick={() => go(m.id)}
                    className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                      view === m.id ? 'bg-cyan-500/10 text-cyan-300' : 'text-[#999] hover:bg-[#151515] hover:text-[#ddd]'
                    }`}>
                    <span className="text-sm leading-none mt-0.5">{m.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-mono font-bold tracking-wider">{m.label.toUpperCase()}</span>
                      <span className="block text-[9px] text-[#555] font-mono leading-tight mt-0.5">{m.hint}</span>
                    </span>
                    {view === m.id && <span className="ml-auto text-cyan-400 text-[10px]">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="hidden sm:block w-px h-5 bg-[#1c1c1c] flex-shrink-0" />

          {TOOLS.map(item => (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              title={item.hint}
              className={`flex-shrink-0 px-1.5 sm:px-3 py-2 rounded text-[10px] sm:text-[11px] font-mono tracking-wider font-bold transition-colors border ${
                view === item.id
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                  : 'border-transparent text-[#666] hover:text-[#ccc] hover:bg-[#1a1a1a]'
              }`}
            >
              <span className="mr-1 sm:mr-1.5">{item.icon}</span>
              {/* Short label on phones so all four tabs stay on one row even
                  when the markets button reads COMMODITIES. */}
              <span className="sm:hidden">{(item.short || item.label).toUpperCase()}</span>
              <span className="hidden sm:inline">{item.label.toUpperCase()}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* Data-source panel — every feed and what it drives */}
      {showSources && health && health.checks && (
        <div className="mx-4 mt-3 p-3 rounded border border-[#1a1a1a] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-widest text-[#666] font-mono mb-2">
            Self-check — {health.summary}
          </div>
          <div className="space-y-1.5">
            {health.checks.filter(c => c.status !== 'skip').map(c => (
              <div key={c.id} className="flex items-start gap-2 text-[11px] font-mono">
                <span className={
                  c.status === 'ok' ? 'text-green-400' :
                  c.status === 'warn' ? 'text-amber-400' : 'text-red-400'
                }>{c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✕'}</span>
                <span className="text-[#888] w-44 flex-shrink-0">{c.title}</span>
                <span className="text-[#666] flex-1">
                  {c.detail}
                  {c.action && <span className="block text-amber-500/70 mt-0.5">{c.action}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MEASURED EDGE ────────────────────────────────────────────────
          Always visible, not behind a panel. When the tracked record says
          these signals lose money, that has to be the first thing on the page
          — showing entry prices and targets above a hidden warning is how a
          losing system keeps getting traded. */}
      {goals?.edge && goals.edge.verdict !== 'POSITIVE' && (
        <div className={`mx-4 mt-3 p-3 rounded border ${
          goals.edge.verdict === 'NEGATIVE'
            ? 'border-red-500/50 bg-red-500/10'
            : 'border-amber-500/40 bg-amber-500/[0.07]'
        }`}>
          <div className="flex items-start gap-2">
            <span className="text-sm leading-none mt-0.5">
              {goals.edge.verdict === 'NEGATIVE' ? '🛑' : '⚠'}
            </span>
            <div className="min-w-0">
              <div className={`text-[11px] font-mono font-bold tracking-wide ${
                goals.edge.verdict === 'NEGATIVE' ? 'text-red-300' : 'text-amber-300'
              }`}>
                {goals.edge.verdict === 'NEGATIVE'
                  ? 'THE TRACKED RECORD SAYS THESE LOSE MONEY'
                  : 'NO PROVEN EDGE YET'}
              </div>
              <p className="text-[11px] font-mono text-[#999] mt-1 leading-snug">
                {goals.edge.headline}
              </p>
              <p className="text-[10px] font-mono text-[#666] mt-1 leading-snug">
                {goals.edge.expectancy}R per trade across {goals.edge.n} entered trades
                {' '}({goals.edge.totalR}R in total), 95% range {goals.edge.low} to {goals.edge.high}.
                {goals.edge.neverFilled > 0 &&
                  ` A further ${goals.edge.neverFilled} signals never reached their entry — you would have been flat on those, and they are not counted here.`}
              </p>
              {goals.edge.verdict === 'NEGATIVE' && (
                <p className="text-[10px] font-mono text-red-400/80 mt-1.5 leading-snug">
                  Treat what follows as research, not recommendations. Paper-trade until this turns positive.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {showSources && goals && (
        <div className="mx-4 mt-3 p-3 rounded border border-[#1a1a1a] bg-[#0a0a0a]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-[#666] font-mono">
              Is it working
            </span>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
              goals.status === 'ok' ? 'border-green-500/40 text-green-300 bg-green-500/10' :
              goals.status === 'off' ? 'border-red-500/40 text-red-300 bg-red-500/10' :
              goals.status === 'marginal' ? 'border-amber-500/40 text-amber-300 bg-amber-500/10' :
              'border-[#2a2a2a] text-[#666]'
            }`}>{goals.headline}</span>
          </div>
          <div className="space-y-1.5">
            {goals.goals.map(g => (
              <div key={g.key} className="flex items-start gap-2 text-[11px] font-mono">
                <span className={
                  g.status === 'ok' ? 'text-green-400' :
                  g.status === 'off' ? 'text-red-400' :
                  g.status === 'marginal' ? 'text-amber-400' : 'text-[#555]'
                }>{g.status === 'ok' ? '✓' : g.status === 'off' ? '✕' : g.status === 'marginal' ? '◐' : '·'}</span>
                <span className="text-[#888] w-44 flex-shrink-0">{g.label}</span>
                <span className="text-[#666] flex-1">
                  {g.detail}
                  {g.note && <span className="block text-[9px] text-[#444] mt-0.5 leading-tight">{g.note}</span>}
                </span>
              </div>
            ))}
            {goals.trend && (
              <div className="flex items-start gap-2 text-[11px] font-mono pt-1.5 border-t border-[#161616]">
                <span className={goals.trend.direction === 'improving' ? 'text-green-400'
                              : goals.trend.direction === 'degrading' ? 'text-red-400' : 'text-[#555]'}>
                  {goals.trend.direction === 'improving' ? '↑' : goals.trend.direction === 'degrading' ? '↓' : '→'}
                </span>
                <span className="text-[#888] w-44 flex-shrink-0">vs previous settings</span>
                <span className="text-[#666] flex-1">{goals.trend.detail}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {showSources && learning?.markets && (
        <div className="mx-4 mt-3 p-3 rounded border border-[#1a1a1a] bg-[#0a0a0a]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-[#666] font-mono">
              Learning from tracked outcomes
            </span>
            <span className="text-[9px] font-mono text-[#444]">
              needs {learning.guardrails?.minSample} trades · moves ≤{Math.round((learning.guardrails?.step || 0) * 100)}% per day
            </span>
          </div>
          <div className="space-y-1.5">
            {learning.markets.map(m => (
              <div key={m.market} className="text-[11px] font-mono">
                <div className="flex items-start gap-2">
                  <span className="text-[#888] w-24 flex-shrink-0">{m.market}</span>
                  <span className="text-[#555] w-20 flex-shrink-0">{m.sample} trades</span>
                  <span className="flex-1 text-[#666]">
                    {m.reason
                      ? <span className="text-[#555]">{m.reason}</span>
                      : m.findings.map((f, i) => (
                          <span key={i} className="block">
                            <span className={f.accepted ? 'text-amber-300' : 'text-[#666]'}>
                              {f.parameter}
                              {f.accepted ? ` ${f.from} → ${f.to}` : ` holding at ${f.from}`}
                            </span>
                            <span className="block text-[9px] text-[#444] leading-tight">{f.evidence}</span>
                          </span>
                        ))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                <span className="text-[#555] text-[10px]">
                  — {s.drives}
                  {s.note && <span className="text-amber-500/70"> ({s.note})</span>}
                </span>
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
