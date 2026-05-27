import { useState, useEffect, useRef } from 'react';
import Sparkline from '../components/Sparkline.jsx';
import ShareMenu from '../components/ShareMenu.jsx';
import { formatAnalystText } from '../utils/share.js';

const VERDICT_STYLES = {
  'STRONG BUY':  { bg: 'bg-green-500/15', border: 'border-green-500/50', text: 'text-green-300', icon: '🚀', glow: 'shadow-[0_0_30px_rgba(0,255,136,0.3)]' },
  'BUY':         { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400', icon: '📈', glow: '' },
  'HOLD':        { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-300', icon: '⏸',  glow: '' },
  'WAIT':        { bg: 'bg-blue-500/10',  border: 'border-blue-500/30',  text: 'text-blue-300',  icon: '⏳', glow: '' },
  'SELL':        { bg: 'bg-red-500/10',   border: 'border-red-500/30',   text: 'text-red-400',   icon: '📉', glow: '' },
  'STRONG SELL': { bg: 'bg-red-500/15',   border: 'border-red-500/50',   text: 'text-red-300',   icon: '⬇',  glow: 'shadow-[0_0_30px_rgba(255,51,85,0.3)]' },
  'AVOID':       { bg: 'bg-[#1a1a1a]',    border: 'border-red-500/40',   text: 'text-red-300',   icon: '🚫', glow: '' }
};

function fmtDollar(n)   { return n != null ? `$${n.toFixed(2)}` : '—'; }
function fmtPct(n)      { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—'; }
function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Crypto quick-pick row — top liquidity coins for one-click analysis
const CRYPTO_PICKS = [
  ['BTC-USD', 'BTC'], ['ETH-USD', 'ETH'], ['SOL-USD', 'SOL'],
  ['BNB-USD', 'BNB'], ['XRP-USD', 'XRP'], ['ADA-USD', 'ADA'],
  ['DOGE-USD', 'DOGE'], ['AVAX-USD', 'AVAX'], ['LINK-USD', 'LINK'],
  ['MATIC-USD', 'MATIC'], ['DOT-USD', 'DOT'], ['ATOM-USD', 'ATOM']
];

const RECENT_KEY = 'lookout-analyst-recent';
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const pushRecent = (t) => {
  try {
    const recent = loadRecent().filter(x => x !== t);
    recent.unshift(t);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 8)));
  } catch {}
};

export default function AnalystPage() {
  const [ticker, setTicker]   = useState('');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [recent, setRecent]   = useState(loadRecent());
  const refreshRef = useRef(null);
  const reportRef  = useRef(null);

  const fetchAnalysis = async (sym) => {
    if (!sym) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/analyst/${sym.toUpperCase()}`);
      if (!r.ok) throw new Error((await r.json()).error || `Failed`);
      const d = await r.json();
      setData(d);
      pushRecent(sym.toUpperCase());
      setRecent(loadRecent());
    } catch (e) {
      setError(e.message);
      setData(null);
    }
    setLoading(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    fetchAnalysis(ticker.trim());
  };

  // Auto-refresh every 30s while analysis is showing
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    if (data?.ticker) {
      refreshRef.current = setInterval(() => fetchAnalysis(data.ticker), 30_000);
    }
    return () => refreshRef.current && clearInterval(refreshRef.current);
  }, [data?.ticker]);

  const verdictStyle = data ? (VERDICT_STYLES[data.verdict] || VERDICT_STYLES.WAIT) : null;

  return (
    <div className="max-w-[1200px] mx-auto px-2 sm:px-4 py-3 sm:py-5">
      <div className="mb-5">
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <h1 className="text-2xl font-condensed font-bold tracking-widest text-cyan-400">
            🔍 ASSET ANALYST
          </h1>
          <span className="text-[10px] font-mono font-bold px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 tracking-widest">
            ⚖ BALANCED MODE
          </span>
          {data?.market === 'crypto' && (
            <span className="text-[10px] font-mono font-bold px-2 py-1 rounded border border-purple-500/40 bg-purple-500/10 text-purple-300 tracking-widest">
              ₿ CRYPTO MODE
            </span>
          )}
        </div>
        <p className="text-[11px] text-[#444] font-mono">
          {data?.market === 'crypto'
            ? '4h candles · crypto calibration · BTC trend + Fear & Greed + funding · VWAP'
            : 'Decisive when conviction is there — flashes BUY/SELL when sources agree. Still rejects clearly bad setups.'}
        </p>
      </div>

      {/* Search input */}
      <form onSubmit={handleSubmit} className="mb-5">
        <div className="flex gap-2 flex-col sm:flex-row">
          <input
            type="text"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="Enter ticker (e.g. AAPL, NVDA, TSLA)…"
            className="flex-1 bg-[#0a0a0a] border border-[#2a2a2a] focus:border-cyan-500/50 focus:outline-none rounded px-4 py-3 text-base sm:text-lg font-condensed tracking-wider text-[#eee] w-full"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !ticker.trim()}
            className="px-6 py-3 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 hover:border-cyan-500/70 text-cyan-300 rounded font-mono font-bold tracking-wider disabled:opacity-40 w-full sm:w-auto"
          >
            {loading ? 'ANALYZING…' : 'ANALYZE'}
          </button>
        </div>
        {recent.length > 0 && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-[10px] text-[#333] font-mono">Recent:</span>
            {recent.map(r => (
              <button key={r} onClick={() => { setTicker(r); fetchAnalysis(r); }}
                className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#1f1f1f] hover:border-cyan-500/30 text-[#666] hover:text-cyan-400">
                {r}
              </button>
            ))}
          </div>
        )}
        {/* Crypto quick-pick — one-click analysis for top coins */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-[10px] text-[#333] font-mono">₿ Crypto:</span>
          {CRYPTO_PICKS.map(([t, label]) => (
            <button key={t} type="button" onClick={() => { setTicker(t); fetchAnalysis(t); }}
              className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#1f1f1f] hover:border-purple-500/40 text-[#666] hover:text-purple-300">
              {label}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded text-[12px] text-red-400 font-mono">
          ⚠ {error}
        </div>
      )}

      {data && (
        <div className="space-y-4 fade-in" ref={reportRef}>

          {/* ── Share toolbar (top right) ──────────────────────────────────── */}
          <div className="flex items-center justify-end gap-2">
            <span className="text-[10px] text-[#444] font-mono">Share this report:</span>
            <ShareMenu
              analystData={data}
              filename={`${data.ticker}-analyst-lookout.png`}
              textFormatter={() => formatAnalystText(data)}
            />
          </div>

          {/* ── VERDICT HERO ─────────────────────────────────────────────────── */}
          <div className={`relative p-5 rounded-lg border ${verdictStyle.border} ${verdictStyle.bg} ${verdictStyle.glow}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-3xl">{verdictStyle.icon}</span>
                  <span className={`text-3xl font-condensed font-bold tracking-widest ${verdictStyle.text}`}>{data.verdict}</span>
                </div>
                <p className={`text-[12px] font-mono leading-relaxed ${verdictStyle.text} opacity-80`}>{data.verdictDetail}</p>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-green-400 live-dot" />
                  <span className="text-3xl font-bold font-mono tabular-nums">{fmtDollar(data.price)}</span>
                </div>
                <div className={`text-sm font-mono tabular-nums ${data.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmtPct(data.changePercent)} today
                </div>
                <div className="text-[10px] text-[#555] font-mono mt-1">{data.name} · {data.exchange}</div>
              </div>
            </div>
            <Sparkline data={data.sparkline} direction={data.verdictTone === 'bullish' ? 'LONG' : data.verdictTone === 'bearish' ? 'SHORT' : null} width={300} height={36} />
          </div>

          {/* ── CRYPTO CONTEXT (only when ticker is crypto) ─────────────────── */}
          {data.market === 'crypto' && (data.cryptoContext || data.vwap) && (
            <div className="rounded-lg p-3 border border-purple-500/30 bg-purple-500/5">
              <div className="text-[10px] uppercase tracking-widest text-purple-400/70 font-mono mb-2">
                ₿ Crypto context for {data.ticker}
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-[11px] font-mono">
                {data.cryptoContext?.btcTrend && (
                  <div className={`px-2.5 py-1.5 rounded border flex items-center gap-2 ${
                    data.cryptoContext.btcTrend === 'BULLISH' ? 'border-green-500/40 text-green-300 bg-green-500/10' :
                    data.cryptoContext.btcTrend === 'BEARISH' ? 'border-red-500/40 text-red-300 bg-red-500/10' :
                                                                 'border-[#2a2a2a] text-[#888]'
                  }`}>
                    <span className="text-[10px] opacity-70">BTC trend</span>
                    <span className="font-bold">{data.cryptoContext.btcTrend}</span>
                  </div>
                )}
                {data.cryptoContext?.fearGreed && (
                  <div className={`px-2.5 py-1.5 rounded border flex items-center gap-2 ${
                    data.cryptoContext.fearGreed.value <= 25 ? 'border-red-500/40 text-red-300 bg-red-500/10' :
                    data.cryptoContext.fearGreed.value >= 75 ? 'border-red-500/40 text-red-300 bg-red-500/10' :
                    data.cryptoContext.fearGreed.value <= 45 ? 'border-amber-500/30 text-amber-300' :
                    data.cryptoContext.fearGreed.value >= 55 ? 'border-amber-500/30 text-amber-300' :
                                                                'border-[#2a2a2a] text-[#aaa]'
                  }`}>
                    <span className="font-bold text-[12px]">{data.cryptoContext.fearGreed.value}</span>
                    <span className="text-[10px]">Fear & Greed · {data.cryptoContext.fearGreed.interpretation}</span>
                  </div>
                )}
                {data.cryptoContext?.btcDominance != null && (
                  <div className="px-2.5 py-1.5 rounded border border-[#2a2a2a] text-[#aaa] flex items-center gap-2">
                    <span className="text-[10px] opacity-70">BTC.D</span>
                    <span className="font-bold">{data.cryptoContext.btcDominance.toFixed(1)}%</span>
                  </div>
                )}
                {data.cryptoContext?.funding != null && (
                  <div className={`px-2.5 py-1.5 rounded border flex items-center gap-2 ${
                    Math.abs(data.cryptoContext.funding) > 0.0005 ? 'border-red-500/40 text-red-300 bg-red-500/10' :
                                                                     'border-[#2a2a2a] text-[#aaa]'
                  }`}>
                    <span className="text-[10px] opacity-70">Funding {data.ticker}</span>
                    <span className="font-bold tabular-nums">{(data.cryptoContext.funding * 100).toFixed(4)}%</span>
                    <span className="text-[9px] opacity-70">/8h</span>
                  </div>
                )}
                {data.vwap && (
                  <div className="px-2.5 py-1.5 rounded border border-[#2a2a2a] text-[#aaa] flex items-center gap-2">
                    <span className="text-[10px] opacity-70">VWAP</span>
                    <span className="font-bold text-cyan-300 tabular-nums">${data.vwap.vwap}</span>
                    <span className={`text-[10px] ${
                      Math.abs(data.vwap.distancePct) < 1 ? 'text-[#888]' :
                      data.vwap.side === 'ABOVE' ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {data.vwap.distancePct >= 0 ? '+' : ''}{data.vwap.distancePct}% {data.vwap.side}
                    </span>
                  </div>
                )}
                {data.cryptoContext?.session && (
                  <div className={`px-2.5 py-1.5 rounded border flex items-center gap-2 ${
                    data.cryptoContext.session.liquidity === 'HIGH'   ? 'border-green-500/40 text-green-300' :
                    data.cryptoContext.session.liquidity === 'MEDIUM' ? 'border-amber-500/30 text-amber-300' :
                                                                        'border-red-500/30 text-red-300'
                  }`}>
                    <span className="text-[10px] opacity-70">Session</span>
                    <span className="font-bold">{data.cryptoContext.session.activeSession}</span>
                    <span className="text-[9px] opacity-80">· {data.cryptoContext.session.liquidity} liq</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TRADE GRADE (top-level synthesis) ────────────────────────────── */}
          {data.tradeGrade && data.tradeGrade.grade !== '—' && (
            <div className={`rounded-lg p-5 border-2 ${
              data.tradeGrade.color === 'green'  ? 'bg-green-500/10 border-green-500/40' :
              data.tradeGrade.color === 'amber'  ? 'bg-amber-500/10 border-amber-500/40' :
              data.tradeGrade.color === 'orange' ? 'bg-orange-500/10 border-orange-500/40' :
                                                    'bg-red-500/10 border-red-500/40'
            }`}>
              <div className="flex items-start justify-between mb-3 flex-wrap gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[#666] font-mono mb-1">📋 Overall Trade Grade</div>
                  <div className={`text-6xl font-condensed font-bold tracking-wider leading-none ${
                    data.tradeGrade.color === 'green'  ? 'text-green-300' :
                    data.tradeGrade.color === 'amber'  ? 'text-amber-300' :
                    data.tradeGrade.color === 'orange' ? 'text-orange-300' :
                                                          'text-red-300'
                  }`}>{data.tradeGrade.grade}</div>
                  <div className="text-[13px] font-mono text-[#bbb] mt-1">{data.tradeGrade.label} · {data.tradeGrade.score}/100</div>
                </div>
              </div>
              {/* Breakdown bars */}
              <div className="space-y-1.5 mt-3">
                {data.tradeGrade.breakdown.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-[#888] w-32 flex-shrink-0">{b.factor}</span>
                    <div className="flex-1 h-2 bg-[#1a1a1a] rounded overflow-hidden">
                      <div className="h-full bg-cyan-500/60" style={{ width: `${(b.points / b.max) * 100}%` }} />
                    </div>
                    <span className="text-[#666] tabular-nums text-right w-14">{b.points}/{b.max}</span>
                    <span className="text-[#555] flex-1 hidden md:block truncate">{b.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PERFORMANCE METRICS (YTD/MTD/WTD + beta) ────────────────────── */}
          {data.performance && (
            <div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded p-4">
              <div className="text-[10px] uppercase tracking-widest text-[#555] font-mono mb-3">📈 Performance Context</div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-[11px] font-mono">
                {data.performance.wtd != null && (
                  <div><div className="text-[#555]">Week</div><div className={`text-sm font-bold tabular-nums ${data.performance.wtd >= 0 ? 'text-green-400' : 'text-red-400'}`}>{data.performance.wtd >= 0 ? '+' : ''}{data.performance.wtd}%</div></div>
                )}
                {data.performance.mtd != null && (
                  <div><div className="text-[#555]">Month</div><div className={`text-sm font-bold tabular-nums ${data.performance.mtd >= 0 ? 'text-green-400' : 'text-red-400'}`}>{data.performance.mtd >= 0 ? '+' : ''}{data.performance.mtd}%</div></div>
                )}
                {data.performance.ytd != null && (
                  <div><div className="text-[#555]">YTD</div><div className={`text-sm font-bold tabular-nums ${data.performance.ytd >= 0 ? 'text-green-400' : 'text-red-400'}`}>{data.performance.ytd >= 0 ? '+' : ''}{data.performance.ytd}%</div></div>
                )}
                {data.performance.yr1 != null && (
                  <div><div className="text-[#555]">1 Year</div><div className={`text-sm font-bold tabular-nums ${data.performance.yr1 >= 0 ? 'text-green-400' : 'text-red-400'}`}>{data.performance.yr1 >= 0 ? '+' : ''}{data.performance.yr1}%</div></div>
                )}
                {data.performance.avgRangePct != null && (
                  <div><div className="text-[#555]">Daily Range</div><div className="text-sm font-bold tabular-nums text-[#ccc]">{data.performance.avgRangePct}%</div></div>
                )}
                {data.performance.beta != null && (
                  <div><div className="text-[#555]">Beta vs SPY</div><div className={`text-sm font-bold tabular-nums ${data.performance.beta > 1.3 ? 'text-amber-400' : data.performance.beta < 0.7 ? 'text-blue-400' : 'text-[#ccc]'}`}>{data.performance.beta}</div></div>
                )}
              </div>
            </div>
          )}

          {/* ── MULTI-TIMEFRAME ALIGNMENT ───────────────────────────────────── */}
          {data.mtfTrends && (
            <div className={`rounded p-5 border ${
              data.mtfAlignment?.aligned >= 3 ? 'bg-green-500/8 border-green-500/30' :
              data.mtfAlignment?.aligned >= 2 ? 'bg-amber-500/8 border-amber-500/30' :
                                                  'bg-[#0e0e0e] border-[#1f1f1f]'
            }`}>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[#555] font-mono">⏱ Multi-Timeframe Alignment</div>
                  <div className="text-[10px] text-[#444] font-mono mt-0.5">
                    {data.mtfAlignment ? `${data.mtfAlignment.aligned}/4 timeframes agree — ${data.mtfAlignment.label}` : 'Trend snapshot'}
                  </div>
                </div>
                {data.mtfAlignment && (
                  <span className={`text-xl font-condensed font-bold tracking-wider ${
                    data.mtfAlignment.aligned >= 3 ? 'text-green-400' :
                    data.mtfAlignment.aligned >= 2 ? 'text-amber-400' : 'text-red-400'
                  }`}>{data.mtfAlignment.score}%</span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {['h4','daily','weekly','monthly'].map(tf => {
                  const trend = data.mtfTrends[tf];
                  const labels = { h4: '4-Hour', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
                  return (
                    <div key={tf} className={`rounded p-2.5 border ${
                      trend === 'UP'   ? 'bg-green-500/8 border-green-500/25' :
                      trend === 'DOWN' ? 'bg-red-500/8 border-red-500/25' :
                                          'bg-[#1a1a1a] border-[#252525]'
                    }`}>
                      <div className="text-[9px] text-[#555] uppercase tracking-widest font-mono mb-1">{labels[tf]}</div>
                      <div className={`text-sm font-mono font-bold ${
                        trend === 'UP'   ? 'text-green-400' :
                        trend === 'DOWN' ? 'text-red-400' : 'text-[#777]'
                      }`}>
                        {trend === 'UP' && '↑ '}{trend === 'DOWN' && '↓ '}{trend}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── SECTOR CONTEXT (small badge near top) ───────────────────────── */}
          {data.sectorContext && (
            <div className={`rounded p-3 border text-[12px] font-mono ${
              data.sectorContext.verdict === 'leader'  ? 'bg-green-500/10 border-green-500/30 text-green-300' :
              data.sectorContext.verdict === 'laggard' ? 'bg-red-500/10 border-red-500/30 text-red-300' :
                                                          'bg-[#0e0e0e] border-[#1f1f1f] text-[#888]'
            }`}>
              <span className="text-[9px] uppercase tracking-widest opacity-60 mr-2">Sector ({data.sectorContext.sectorETF}):</span>
              {data.sectorContext.text}
              <span className="text-[10px] opacity-60 ml-2">· Today {data.sectorContext.stockDay >= 0 ? '+' : ''}{data.sectorContext.stockDay}% vs sector {data.sectorContext.sectorDay >= 0 ? '+' : ''}{data.sectorContext.sectorDay}%</span>
            </div>
          )}

          {/* ── SETUP TYPE — what KIND of swing trade this is ─────────────── */}
          {data.setupType && (
            <div className="bg-cyan-500/5 border-2 border-cyan-500/30 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <span className="text-lg font-condensed font-bold tracking-wider text-cyan-300">{data.setupType.label}</span>
                <div className="flex items-center gap-3 text-[11px] font-mono">
                  <span><span className="text-[#555]">Win rate:</span> <span className={`font-bold ${
                    data.setupType.historicalWinRate >= 60 ? 'text-green-400' :
                    data.setupType.historicalWinRate >= 50 ? 'text-amber-400' : 'text-orange-400'
                  }`}>{data.setupType.historicalWinRate}%</span></span>
                  <span><span className="text-[#555]">Hold:</span> <span className="text-[#ccc]">{data.setupType.idealHold}</span></span>
                  <span><span className="text-[#555]">Risk:</span> <span className={`font-bold ${
                    data.setupType.risk === 'high' ? 'text-red-400' :
                    data.setupType.risk?.includes('high') ? 'text-orange-400' :
                    'text-amber-400'
                  }`}>{data.setupType.risk}</span></span>
                </div>
              </div>
              <p className="text-[12px] text-[#ccc] font-mono leading-relaxed mb-2">{data.setupType.description}</p>
              <p className="text-[11px] text-[#888] font-mono leading-relaxed mb-2">{data.setupType.reasoning}</p>
              <p className="text-[11px] text-cyan-200/80 font-mono italic">💡 {data.setupType.action}</p>
            </div>
          )}

          {/* ── BEST PLAY (synthesized recommendation) ──────────────────────── */}
          {data.bestPlay && (
            <div className="bg-cyan-500/8 border-2 border-cyan-500/40 rounded-lg p-5">
              <div className="text-[10px] uppercase tracking-widest text-cyan-500/70 font-mono mb-2">💡 Best Play Right Now</div>
              <div className="text-xl font-condensed font-bold tracking-wider text-cyan-200 mb-2">{data.bestPlay.headline}</div>
              <p className="text-[13px] font-mono text-[#ccc] leading-relaxed mb-3">{data.bestPlay.action}</p>
              <div className="flex flex-wrap gap-4 text-[11px] font-mono">
                {data.bestPlay.timeframe && <div><span className="text-[#555]">Timeframe: </span><span className="text-cyan-300">{data.bestPlay.timeframe}</span></div>}
                {data.bestPlay.sizing && <div><span className="text-[#555]">Sizing: </span><span className="text-cyan-300">{data.bestPlay.sizing}</span></div>}
              </div>
            </div>
          )}

          {/* ── RELIABILITY SCORE WITH BREAKDOWN ────────────────────────────── */}
          {data.reliability && (
            <div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[#555] font-mono">⚖ Reliability Score</div>
                  <div className={`text-2xl font-condensed font-bold tracking-wider ${
                    data.reliability.score >= 80 ? 'text-green-400' :
                    data.reliability.score >= 65 ? 'text-amber-400' :
                    data.reliability.score >= 50 ? 'text-orange-400' :
                                                    'text-red-400'
                  }`}>
                    {data.reliability.score}/100 — {data.reliability.label}
                  </div>
                </div>
                <div className="text-[10px] text-[#444] font-mono text-right">
                  Cross-validates 7 independent<br />sources against direction
                </div>
              </div>
              <div className="h-2 bg-[#1a1a1a] rounded overflow-hidden mb-4">
                <div className={`h-full ${data.reliability.score >= 80 ? 'bg-green-400' : data.reliability.score >= 65 ? 'bg-amber-400' : data.reliability.score >= 50 ? 'bg-orange-400' : 'bg-red-400'}`}
                  style={{ width: `${data.reliability.score}%` }} />
              </div>
              <div className="space-y-1.5">
                {data.reliability.components.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className={`w-4 ${
                      c.verdict === 'pass' ? 'text-green-400' :
                      c.verdict === 'partial' ? 'text-amber-400' : 'text-red-400'
                    }`}>{c.verdict === 'pass' ? '✓' : c.verdict === 'partial' ? '◐' : '✗'}</span>
                    <span className="text-[#888] w-36 flex-shrink-0">{c.name}</span>
                    <span className="text-[#666] flex-1">{c.text}</span>
                    <span className="text-[#444] tabular-nums text-right w-12">{c.points}/{c.max}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── INTRADAY FORECAST CONE ──────────────────────────────────────── */}
          {data.forecast && (
            <div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded p-5">
              <div className="text-[10px] uppercase tracking-widest text-[#555] font-mono mb-3">📊 Intraday Forecast Cone</div>
              <div className="text-[10px] text-[#444] font-mono mb-3">Expected price range hour-by-hour within today's session · widens with √hours</div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1a1a1a]">
                    <th className="text-left py-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">Time</th>
                    <th className="text-right py-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">Low Estimate</th>
                    <th className="text-right py-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">Expected</th>
                    <th className="text-right py-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">High Estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecast.map((f, i) => (
                    <tr key={i} className="border-b border-[#141414]">
                      <td className="py-2 text-[11px] font-mono text-[#888]">{f.label}</td>
                      <td className="py-2 text-right text-[11px] font-mono tabular-nums text-red-400/70">${f.low.toFixed(2)} <span className="text-[9px] text-red-500/40">({f.pctLow >= 0 ? '+' : ''}{f.pctLow}%)</span></td>
                      <td className="py-2 text-right text-[12px] font-mono tabular-nums text-[#ccc] font-bold">${f.expected.toFixed(2)} <span className="text-[9px] text-[#555]">({f.pctExpected >= 0 ? '+' : ''}{f.pctExpected}%)</span></td>
                      <td className="py-2 text-right text-[11px] font-mono tabular-nums text-green-400/70">${f.high.toFixed(2)} <span className="text-[9px] text-green-500/40">({f.pctHigh >= 0 ? '+' : ''}{f.pctHigh}%)</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── PRICE TARGETS ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-green-500/8 border border-green-500/30 rounded p-4">
              <div className="text-[10px] uppercase tracking-widest text-green-500/70 font-mono mb-1">🎯 Bullish Target</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-green-400 mb-1">{fmtDollar(data.targets.bullish.price)}</div>
              <div className="text-sm font-mono text-green-300/80">+{data.targets.bullish.pct}% upside · {data.targets.bullish.timeframe}</div>
              <div className="text-[10px] text-[#666] font-mono mt-2">{data.targets.bullish.reasoning}</div>
            </div>
            <div className="bg-red-500/8 border border-red-500/30 rounded p-4">
              <div className="text-[10px] uppercase tracking-widest text-red-500/70 font-mono mb-1">🎯 Bearish Target</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-red-400 mb-1">{fmtDollar(data.targets.bearish.price)}</div>
              <div className="text-sm font-mono text-red-300/80">{data.targets.bearish.pct}% downside · {data.targets.bearish.timeframe}</div>
              <div className="text-[10px] text-[#666] font-mono mt-2">{data.targets.bearish.reasoning}</div>
            </div>
          </div>

          {/* ── RECOMMENDED TRADE SETUP ──────────────────────────────────────── */}
          {data.setup && (
            <div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded p-4">
              <div className="text-[10px] uppercase tracking-widest text-[#555] font-mono mb-3">💡 Recommended Trade Setup ({data.setup.direction})</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#444] font-mono">Entry Zone</div>
                  <div className="font-mono font-bold text-green-400 text-sm tabular-nums">${data.setup.entryLow?.toFixed(2)}–${data.setup.entryHigh?.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#444] font-mono">TP1 — Safe</div>
                  <div className="font-mono font-bold text-blue-400 text-sm tabular-nums">${data.setup.tp?.toFixed(2)}</div>
                  <div className="text-[9px] text-blue-500/60 font-mono">R:R {data.setup.rrRatio}:1</div>
                </div>
                {data.setup.tp2 != null && (
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-[#444] font-mono">TP2 — Extended</div>
                    <div className="font-mono font-bold text-cyan-400 text-sm tabular-nums">${data.setup.tp2?.toFixed(2)}</div>
                    <div className="text-[9px] text-cyan-500/60 font-mono">R:R {data.setup.rrRatio2}:1</div>
                  </div>
                )}
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#444] font-mono">Stop Loss</div>
                  <div className="font-mono font-bold text-red-400 text-sm tabular-nums">${data.setup.sl?.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#444] font-mono">Same-Day Probability</div>
                  <div className={`font-mono font-bold text-sm ${
                    data.setup.confidence >= 75 ? 'text-green-400' :
                    data.setup.confidence >= 60 ? 'text-amber-400' : 'text-orange-400'
                  }`}>{data.setup.confidence}%</div>
                </div>
              </div>

              {data.setup.trendStrengthLabel && (
                <div className="text-[11px] font-mono mb-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[#555]">Trend strength:</span>
                  <span className={`font-bold px-2 py-0.5 rounded border ${
                    data.setup.trendStrength >= 2.5 ? 'bg-green-500/15 border-green-500/40 text-green-300' :
                    data.setup.trendStrength >= 1.5 ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                    data.setup.trendStrength >= 0.5 ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                                                       'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}>{data.setup.trendStrengthLabel}</span>
                  <span className="text-[10px] text-[#666]">→ {data.setup.trendStrengthLabel === 'Very Strong' || data.setup.trendStrengthLabel === 'Strong' ? 'TPs scaled wider (let it run)' : 'TPs scaled tighter (cautious)'}</span>
                </div>
              )}
              {data.setup.tp2 != null && (
                <div className="text-[11px] text-[#888] font-mono mb-3 italic">
                  💡 Pro tip: scale out 50–70% of position at <span className="text-blue-400">TP1</span> (lock in safe profit), let the remainder run to <span className="text-cyan-400">TP2</span> for extended gains. Move SL to break-even after TP1 hits.
                </div>
              )}

              {/* Time horizon row */}
              <div className="pt-3 border-t border-[#1a1a1a] grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] font-mono">
                {data.setup.timeSpan && (
                  <div>
                    <span className="text-[#555]">Hold duration: </span>
                    <span className="text-[#ccc] font-bold">⏱ {data.setup.timeSpan}</span>
                  </div>
                )}
                {data.setup.exitWindow && (
                  <div>
                    <span className="text-[#555]">Target exit: </span>
                    <span className="text-[#ccc] font-bold">📅 {data.setup.exitWindow}</span>
                  </div>
                )}
                {(data.setup.expectedHours || data.setup.expectedDays) && (
                  <div>
                    <span className="text-[#555]">Realistic reach: </span>
                    <span className="text-cyan-400 font-bold">
                      {data.setup.expectedHours
                        ? `~${data.setup.expectedHours} hour${data.setup.expectedHours !== 1 ? 's' : ''}`
                        : `~${data.setup.expectedDays} day${data.setup.expectedDays !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── WALL STREET CONSENSUS (independent cross-check) ─────────────── */}
          {data.wallStreet && data.wallStreet.analystCount > 0 && (
            <div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[#555] font-mono">🏛 Wall Street Consensus</div>
                  <div className="text-[10px] text-[#444] font-mono mt-0.5">{data.wallStreet.analystCount} analysts covering · independent cross-check</div>
                </div>
                {data.wallStreet.recommendationLabel && (
                  <span className={`text-sm font-mono font-bold tracking-widest px-3 py-1 rounded border ${
                    data.wallStreet.recommendationLabel.includes('BUY')  ? 'bg-green-500/10 border-green-500/30 text-green-300' :
                    data.wallStreet.recommendationLabel.includes('SELL') ? 'bg-red-500/10 border-red-500/30 text-red-300' :
                                                                            'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  }`}>{data.wallStreet.recommendationLabel}</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3 text-[11px] font-mono">
                {data.wallStreet.targetLow != null && (
                  <div className="bg-red-500/8 border border-red-500/20 rounded p-2">
                    <div className="text-[9px] uppercase text-red-500/60">Low Target</div>
                    <div className="text-red-400 font-bold tabular-nums">${data.wallStreet.targetLow.toFixed(2)}</div>
                    <div className="text-[9px] text-red-500/50">{((data.wallStreet.targetLow - data.price) / data.price * 100).toFixed(1)}%</div>
                  </div>
                )}
                {data.wallStreet.targetMean != null && (
                  <div className="bg-blue-500/8 border border-blue-500/20 rounded p-2">
                    <div className="text-[9px] uppercase text-blue-500/60">Mean Target</div>
                    <div className="text-blue-400 font-bold tabular-nums">${data.wallStreet.targetMean.toFixed(2)}</div>
                    <div className="text-[9px] text-blue-500/50">{((data.wallStreet.targetMean - data.price) / data.price * 100 >= 0 ? '+' : '')}{((data.wallStreet.targetMean - data.price) / data.price * 100).toFixed(1)}%</div>
                  </div>
                )}
                {data.wallStreet.targetHigh != null && (
                  <div className="bg-green-500/8 border border-green-500/20 rounded p-2">
                    <div className="text-[9px] uppercase text-green-500/60">High Target</div>
                    <div className="text-green-400 font-bold tabular-nums">${data.wallStreet.targetHigh.toFixed(2)}</div>
                    <div className="text-[9px] text-green-500/50">+{((data.wallStreet.targetHigh - data.price) / data.price * 100).toFixed(1)}%</div>
                  </div>
                )}
              </div>
              <div className="text-[10px] font-mono text-[#555]">
                Ratings split:{' '}
                <span className="text-green-400">Strong Buy {data.wallStreet.strongBuy}</span> ·{' '}
                <span className="text-green-500/70">Buy {data.wallStreet.buy}</span> ·{' '}
                <span className="text-amber-400">Hold {data.wallStreet.hold}</span> ·{' '}
                <span className="text-red-500/70">Sell {data.wallStreet.sell}</span> ·{' '}
                <span className="text-red-400">Strong Sell {data.wallStreet.strongSell}</span>
              </div>
            </div>
          )}

          {/* ── BACKTEST VALIDATION (historical win rate) ──────────────────── */}
          {data.backtest && (
            <div className={`rounded p-5 border ${
              data.backtest.winRate >= 65 ? 'bg-green-500/8 border-green-500/30' :
              data.backtest.winRate >= 50 ? 'bg-amber-500/8 border-amber-500/30' :
              data.backtest.winRate != null ? 'bg-red-500/8 border-red-500/30' :
                                                'bg-[#0e0e0e] border-[#1f1f1f]'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-[10px] uppercase tracking-widest font-mono text-[#888]">📊 Backtest — Historical Performance on {data.ticker}</div>
                  <div className="text-[10px] text-[#444] font-mono mt-0.5">This exact setup pattern simulated over the last 6 months</div>
                </div>
                {data.backtest.winRate != null && (
                  <div className={`text-2xl font-condensed font-bold tracking-wider ${
                    data.backtest.winRate >= 65 ? 'text-green-400' :
                    data.backtest.winRate >= 50 ? 'text-amber-400' : 'text-red-400'
                  }`}>{data.backtest.winRate}% WIN</div>
                )}
              </div>
              <p className="text-[12px] font-mono text-[#aaa] mb-2">{data.backtest.message}</p>
              {data.backtest.sampleSize > 0 && (
                <>
                  <div className="text-[10px] font-mono text-[#555] flex gap-4 flex-wrap">
                    <span>Sample size: <span className="text-[#aaa]">{data.backtest.sampleSize}</span></span>
                    <span>✓ Wins: <span className="text-green-400">{data.backtest.wins}</span></span>
                    <span>✗ Losses: <span className="text-red-400">{data.backtest.losses}</span></span>
                    {data.backtest.timeouts > 0 && <span>⏱ Timeouts: <span className="text-amber-400">{data.backtest.timeouts}</span></span>}
                    <span>Confidence: <span className="text-[#aaa]">{data.backtest.confidence}</span></span>
                  </div>
                  {data.backtest.recentMatches?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#1a1a1a]">
                      <div className="text-[9px] uppercase tracking-widest text-[#444] font-mono mb-2">Most recent historical matches:</div>
                      <ul className="space-y-1">
                        {data.backtest.recentMatches.map((m, i) => (
                          <li key={i} className="text-[11px] font-mono flex items-center gap-2">
                            <span className={`w-12 text-center text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              m.result === 'WIN'  ? 'bg-green-500/20 text-green-300' :
                              m.result === 'LOSS' ? 'bg-red-500/20 text-red-300' :
                                                     'bg-amber-500/20 text-amber-300'
                            }`}>{m.result === 'WIN' ? '✓ WIN' : m.result === 'LOSS' ? '✗ LOSS' : '— TIME'}</span>
                            <span className="text-[#888]">Setup detected {m.date}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── KEY SUPPORT & RESISTANCE LEVELS ─────────────────────────────── */}
          {data.keyLevels && (data.keyLevels.supports?.length > 0 || data.keyLevels.resistances?.length > 0) && (
            <div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded p-5">
              <div className="text-[10px] uppercase tracking-widest text-[#555] font-mono mb-1">📐 Key Support & Resistance Levels</div>
              <div className="text-[10px] text-[#444] font-mono mb-3">Horizontal levels where price has reacted multiple times — high-probability bounce/break zones</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Resistances (above current price) */}
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-red-400/60 font-mono mb-2">↑ Resistance (above)</div>
                  {data.keyLevels.resistances.length === 0 ? (
                    <div className="text-[11px] text-[#333] font-mono">No major resistance — clear sky upward</div>
                  ) : (
                    <ul className="space-y-1">
                      {data.keyLevels.resistances.map((r, i) => (
                        <li key={i} className="text-[11px] font-mono flex items-center justify-between border-b border-[#141414] py-1">
                          <div>
                            <span className={`tabular-nums font-bold ${r.strength === 'strong' ? 'text-red-300' : r.strength === 'medium' ? 'text-red-400/80' : 'text-red-500/60'}`}>${r.price.toFixed(2)}</span>
                            <span className="text-[9px] text-[#555] ml-2">tested {r.hits}× · {r.strength}</span>
                          </div>
                          <span className="text-[10px] text-red-400/70 tabular-nums">+{r.distancePct}% away</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Supports (below current price) */}
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-green-400/60 font-mono mb-2">↓ Support (below)</div>
                  {data.keyLevels.supports.length === 0 ? (
                    <div className="text-[11px] text-[#333] font-mono">No major support — air pocket downward</div>
                  ) : (
                    <ul className="space-y-1">
                      {data.keyLevels.supports.map((s, i) => (
                        <li key={i} className="text-[11px] font-mono flex items-center justify-between border-b border-[#141414] py-1">
                          <div>
                            <span className={`tabular-nums font-bold ${s.strength === 'strong' ? 'text-green-300' : s.strength === 'medium' ? 'text-green-400/80' : 'text-green-500/60'}`}>${s.price.toFixed(2)}</span>
                            <span className="text-[9px] text-[#555] ml-2">tested {s.hits}× · {s.strength}</span>
                          </div>
                          <span className="text-[10px] text-green-400/70 tabular-nums">-{s.distancePct}% away</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── BULLS CASE vs BEARS CASE ────────────────────────────────────── */}
          {data.bullsBears && (data.bullsBears.bullPoints.length > 0 || data.bullsBears.bearPoints.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-green-500/5 border border-green-500/20 rounded p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] uppercase tracking-widest text-green-400 font-mono font-bold">📈 BULLS CASE</span>
                  <span className="text-[9px] text-green-500/50">{data.bullsBears.bullPoints.length} reasons</span>
                </div>
                {data.bullsBears.bullPoints.length === 0 ? (
                  <p className="text-[11px] text-[#444] font-mono italic">No bullish factors found</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.bullsBears.bullPoints.map((p, i) => (
                      <li key={i} className="text-[11px] font-mono text-green-200/80 flex gap-2">
                        <span className="text-green-400 flex-shrink-0">✓</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="bg-red-500/5 border border-red-500/20 rounded p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] uppercase tracking-widest text-red-400 font-mono font-bold">📉 BEARS CASE</span>
                  <span className="text-[9px] text-red-500/50">{data.bullsBears.bearPoints.length} risks</span>
                </div>
                {data.bullsBears.bearPoints.length === 0 ? (
                  <p className="text-[11px] text-[#444] font-mono italic">No bearish factors found</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.bullsBears.bearPoints.map((p, i) => (
                      <li key={i} className="text-[11px] font-mono text-red-200/80 flex gap-2">
                        <span className="text-red-400 flex-shrink-0">⚠</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* ── INVALIDATION TRIGGERS (explicit exit rules) ─────────────────── */}
          {data.invalidation?.length > 0 && (
            <div className="bg-[#0e0e0e] border-2 border-amber-500/30 rounded p-5">
              <div className="text-[10px] uppercase tracking-widest text-amber-400 font-mono font-bold mb-1">🛑 Invalidation Triggers — Exit If ANY of These Happen</div>
              <div className="text-[10px] text-[#444] font-mono mb-3">If any of these conditions are met, the trade premise is broken. Exit without second-guessing.</div>
              <ul className="space-y-2">
                {data.invalidation.map((t, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] font-mono">
                    <span className={`text-[10px] font-bold flex-shrink-0 px-1.5 py-0.5 rounded ${
                      t.severity === 'hard'   ? 'bg-red-500/20 text-red-300'    :
                      t.severity === 'medium' ? 'bg-amber-500/20 text-amber-300' :
                                                 'bg-blue-500/20 text-blue-300'
                    }`}>{t.severity === 'hard' ? 'HARD' : t.severity === 'medium' ? 'MED' : 'SOFT'}</span>
                    <span className="text-[#bbb] leading-relaxed">{t.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── REVIEWER VERDICT ─────────────────────────────────────────────── */}
          {data.review && data.review.verdict !== 'NO_SETUP' && (
            <div className={`rounded p-4 border ${
              data.review.verdict === 'PASS'    ? 'bg-green-500/8 border-green-500/30' :
              data.review.verdict === 'CAUTION' ? 'bg-amber-500/8 border-amber-500/30' :
                                                   'bg-red-500/8 border-red-500/30'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] font-bold uppercase tracking-widest font-mono px-2 py-0.5 rounded ${
                  data.review.verdict === 'PASS' ? 'bg-green-500/20 text-green-300' :
                  data.review.verdict === 'CAUTION' ? 'bg-amber-500/20 text-amber-300' :
                                                       'bg-red-500/20 text-red-300'
                }`}>REVIEWER · {data.review.verdict}</span>
              </div>
              <p className="text-[11px] font-mono text-[#aaa] mb-2">{data.review.summary}</p>
              {data.review.issues?.length > 0 && (
                <ul className="space-y-0.5">
                  {data.review.issues.map((iss, i) => (
                    <li key={i} className={`text-[10px] font-mono ${iss.severity === 'reject' ? 'text-red-400/80' : 'text-amber-400/80'}`}>• {iss.text}</li>
                  ))}
                </ul>
              )}
              {data.review.strengths?.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {data.review.strengths.map((s, i) => (
                    <li key={i} className="text-[10px] font-mono text-green-400/80">+ {s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── TECHNICALS GRID ─────────────────────────────────────────────── */}
          <div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded p-4">
            <div className="text-[10px] uppercase tracking-widest text-[#555] font-mono mb-3">📊 Technical Snapshot</div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-[11px] font-mono">
              <div><div className="text-[#444]">RSI (14)</div><div className={`text-sm ${data.technicals.rsi > 70 ? 'text-red-400' : data.technicals.rsi < 30 ? 'text-green-400' : 'text-[#ccc]'}`}>{data.technicals.rsi ?? '—'}</div></div>
              <div><div className="text-[#444]">ATR</div><div className="text-sm text-[#ccc]">${data.technicals.atr ?? '—'}</div></div>
              <div><div className="text-[#444]">SMA 20</div><div className="text-sm text-[#ccc]">${data.technicals.sma20 ?? '—'}</div></div>
              <div><div className="text-[#444]">SMA 50</div><div className="text-sm text-[#ccc]">${data.technicals.sma50 ?? '—'}</div></div>
              <div><div className="text-[#444]">SMA 200</div><div className="text-sm text-[#ccc]">${data.technicals.sma200 ?? '—'}</div></div>
              <div><div className="text-[#444]">Weekly Trend</div><div className={`text-sm font-bold ${data.weeklyTrend === 'UP' ? 'text-green-400' : data.weeklyTrend === 'DOWN' ? 'text-red-400' : 'text-[#888]'}`}>{data.weeklyTrend}</div></div>
              <div><div className="text-[#444]">52W High</div><div className="text-sm text-[#aaa]">${data.fiftyTwoWeekHigh?.toFixed(2)}</div></div>
              <div><div className="text-[#444]">52W Low</div><div className="text-sm text-[#aaa]">${data.fiftyTwoWeekLow?.toFixed(2)}</div></div>
              <div><div className="text-[#444]">Day High</div><div className="text-sm text-[#aaa]">${data.dayHigh?.toFixed(2)}</div></div>
              <div><div className="text-[#444]">Day Low</div><div className="text-sm text-[#aaa]">${data.dayLow?.toFixed(2)}</div></div>
              <div><div className="text-[#444]">Volume</div><div className="text-sm text-[#aaa]">{data.volume ? (data.volume / 1e6).toFixed(1) + 'M' : '—'}</div></div>
              <div><div className="text-[#444]">vs Avg Vol</div><div className={`text-sm ${data.volRatio > 1.5 ? 'text-green-400' : data.volRatio < 0.5 ? 'text-red-400' : 'text-[#aaa]'}`}>{data.volRatio?.toFixed(1)}×</div></div>
            </div>
          </div>

          {/* ── EARNINGS WARNING ────────────────────────────────────────────── */}
          {data.earnings && data.earnings.status !== 'OK' && (
            <div className={`p-3 rounded border text-[11px] font-mono ${
              data.earnings.status === 'BLOCK' ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            }`}>
              📅 Earnings in {data.earnings.daysAway} days — {data.earnings.status === 'BLOCK' ? 'DO NOT hold through report' : 'plan to close position before report'}
            </div>
          )}

          {/* ── NEWS + SENTIMENT ────────────────────────────────────────────── */}
          {data.news?.length > 0 && (
            <div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] uppercase tracking-widest text-[#555] font-mono">📰 Latest News</span>
                {data.sentiment && data.sentiment.total > 0 && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    data.sentiment.score >= 60 ? 'bg-green-500/10 border-green-500/30 text-green-300' :
                    data.sentiment.score <= 40 ? 'bg-red-500/10 border-red-500/30 text-red-300' :
                                                  'bg-[#1a1a1a] border-[#252525] text-[#888]'
                  }`}>
                    Sentiment: {data.sentiment.label} {data.sentiment.score}%
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {data.news.map((n, i) => (
                  <li key={i} className="text-[12px] leading-snug">
                    <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-[#ccc] hover:text-cyan-400 transition-colors">{n.title}</a>
                    <div className="text-[10px] text-[#444] font-mono">— {n.publisher} · {timeAgo(n.time)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── ANALYST FOOTER ──────────────────────────────────────────────── */}
          <div className="text-center text-[10px] text-[#333] font-mono mt-4">
            Auto-refreshes every 30 seconds · Last analysed {new Date(data.timestamp).toLocaleTimeString('en-US', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()} UK · Verify all prices on TradingView before entering
          </div>
        </div>
      )}
    </div>
  );
}
