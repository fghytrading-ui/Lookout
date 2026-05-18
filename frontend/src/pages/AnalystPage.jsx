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
    <div className="max-w-[1200px] mx-auto px-4 py-5">
      <div className="mb-5">
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <h1 className="text-2xl font-condensed font-bold tracking-widest text-cyan-400">🔍 STOCK ANALYST</h1>
          <span className="text-[10px] font-mono font-bold px-2 py-1 rounded border border-purple-500/40 bg-purple-500/10 text-purple-300 tracking-widest">
            🛡 INDEPENDENCE MODE
          </span>
        </div>
        <p className="text-[11px] text-[#444] font-mono">Skeptical by default — only flashes BUY/SELL when sources strongly agree. Defaults to HOLD/WAIT.</p>
      </div>

      {/* Search input */}
      <form onSubmit={handleSubmit} className="mb-5">
        <div className="flex gap-2">
          <input
            type="text"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="Enter ticker (e.g. AAPL, NVDA, TSLA)…"
            className="flex-1 bg-[#0a0a0a] border border-[#2a2a2a] focus:border-cyan-500/50 focus:outline-none rounded px-4 py-3 text-lg font-condensed tracking-wider text-[#eee]"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !ticker.trim()}
            className="px-6 py-3 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 hover:border-cyan-500/70 text-cyan-300 rounded font-mono font-bold tracking-wider disabled:opacity-40"
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

          {/* ── 5-DAY FORECAST CONE ─────────────────────────────────────────── */}
          {data.forecast && (
            <div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded p-5">
              <div className="text-[10px] uppercase tracking-widest text-[#555] font-mono mb-3">📊 5-Day Forecast Cone</div>
              <div className="text-[10px] text-[#444] font-mono mb-3">Expected price range each day · widens with √days (probability cone)</div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1a1a1a]">
                    <th className="text-left py-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">Day</th>
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#444] font-mono">Entry Zone</div>
                  <div className="font-mono font-bold text-green-400 text-sm tabular-nums">${data.setup.entryLow?.toFixed(2)}–${data.setup.entryHigh?.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#444] font-mono">Take Profit</div>
                  <div className="font-mono font-bold text-blue-400 text-sm tabular-nums">${data.setup.tp?.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#444] font-mono">Stop Loss</div>
                  <div className="font-mono font-bold text-red-400 text-sm tabular-nums">${data.setup.sl?.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#444] font-mono">R:R · Confidence</div>
                  <div className="font-mono font-bold text-sm">{data.setup.rrRatio}:1 · {data.setup.confidence}%</div>
                </div>
              </div>
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
