import { useState, useEffect, useCallback } from 'react';

const LOOKBACKS = [
  { days: 7,  label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' }
];

function pct(n) { return (n * 100).toFixed(1) + '%'; }

function rateColor(rate, sample) {
  if (sample < 10) return 'text-[#666]';
  if (rate >= 0.6)  return 'text-green-400';
  if (rate >= 0.5)  return 'text-green-500/70';
  if (rate >= 0.4)  return 'text-amber-400';
  return 'text-red-400';
}

function Card({ title, children, hint }) {
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded p-3 sm:p-4">
      <div className="text-[10px] uppercase tracking-widest text-[#555] font-mono mb-2">{title}</div>
      {children}
      {hint && <div className="text-[9px] text-[#333] font-mono mt-2">{hint}</div>}
    </div>
  );
}

function BreakdownTable({ title, rows, hint }) {
  if (!rows?.length) {
    return (
      <Card title={title} hint={hint}>
        <div className="text-[11px] text-[#444] font-mono">No closed signals yet.</div>
      </Card>
    );
  }
  return (
    <Card title={title} hint={hint}>
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-[#555] text-left">
            <th className="font-normal pb-1">Key</th>
            <th className="font-normal pb-1 text-right">N</th>
            <th className="font-normal pb-1 text-right">Win %</th>
            <th className="font-normal pb-1 text-right">SL %</th>
            <th className="font-normal pb-1 text-right">Avg MFE</th>
            <th className="font-normal pb-1 text-right">Avg MAE</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map(r => (
            <tr key={r.key} className="border-t border-[#161616]">
              <td className="py-1.5 text-[#ddd]">{r.key}</td>
              <td className="py-1.5 text-right text-[#888]">{r.total}</td>
              <td className={`py-1.5 text-right font-bold ${rateColor(r.winRate, r.total)}`}>{pct(r.winRate)}</td>
              <td className="py-1.5 text-right text-red-500/70">{pct(r.slHitRate)}</td>
              <td className="py-1.5 text-right text-green-500/70">{r.avgMFEPct}%</td>
              <td className="py-1.5 text-right text-amber-500/70">{r.avgMAEPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function OutcomeBadge({ outcome, closeReason }) {
  const map = {
    WIN:      { text: closeReason || 'WIN', cls: 'bg-green-500/10 border-green-500/30 text-green-300' },
    LOSS:     { text: 'SL',                 cls: 'bg-red-500/10   border-red-500/30   text-red-300' },
    EXPIRED:  { text: 'EXPIRED',            cls: 'bg-blue-500/10  border-blue-500/30  text-blue-300' }
  };
  const m = map[outcome] || { text: outcome, cls: 'bg-[#0a0a0a] border-[#2a2a2a] text-[#888]' };
  return <span className={`px-1.5 py-0.5 rounded border text-[10px] ${m.cls}`}>{m.text}</span>;
}

export default function PerformancePage() {
  const [lookback, setLookback] = useState(30);
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [sRes, oRes] = await Promise.all([
        fetch(`/api/performance?lookback=${lookback}`).then(r => r.json()),
        fetch('/api/performance/open').then(r => r.json())
      ]);
      setStats(sRes);
      setOpen(oRes);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [lookback]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const triggerMonitor = async () => {
    setLoading(true);
    await fetch('/api/performance/monitor-now', { method: 'POST' });
    await fetchAll();
  };

  if (loading && !stats) {
    return <div className="p-6 text-[12px] text-[#666] font-mono">Loading performance data…</div>;
  }
  if (error) {
    return <div className="p-6 text-[12px] text-red-400 font-mono">Error: {error}</div>;
  }
  if (!stats) return null;

  const tpHits = stats.byVerdict.find(v => v.key === 'PASS');

  return (
    <div className="pb-14 max-w-[1400px] mx-auto px-4">
      {/* Header */}
      <div className="pt-3 pb-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-condensed font-bold tracking-widest text-cyan-400">📊 PERFORMANCE</h1>
          <p className="text-[11px] text-[#444] font-mono">
            Auto-tracked signal outcomes · feeds back into signal confidence at scan time
          </p>
        </div>
        <div className="flex items-center gap-2">
          {LOOKBACKS.map(l => (
            <button
              key={l.days}
              onClick={() => setLookback(l.days)}
              className={`text-[10px] font-mono px-3 py-1.5 border rounded transition-colors ${
                lookback === l.days
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                  : 'border-[#2a2a2a] text-[#666] hover:text-[#ccc]'
              }`}
            >{l.label}</button>
          ))}
          <button
            onClick={triggerMonitor}
            className="text-[10px] font-mono px-3 py-1.5 border border-[#2a2a2a] hover:border-green-500/40 text-[#666] hover:text-green-400 rounded"
            title="Force the monitor to check all open signals now"
          >⟳ Tick now</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Card title="Total signals">
          <div className="text-2xl font-bold text-cyan-300 tabular-nums">{stats.totalSignals}</div>
          <div className="text-[10px] text-[#555] font-mono">last {lookback}d · {stats.open} open · {stats.closed} closed</div>
        </Card>
        <Card title="Overall win rate">
          <div className={`text-2xl font-bold tabular-nums ${rateColor(stats.overallWinRate || 0, stats.closed)}`}>
            {stats.overallWinRate != null ? pct(stats.overallWinRate) : '—'}
          </div>
          <div className="text-[10px] text-[#555] font-mono">{stats.wins} wins · {stats.losses} losses · {stats.expired} expired</div>
        </Card>
        <Card title="TP hit rate" hint="WIN includes both TP1 and TP2 outcomes">
          <div className="text-2xl font-bold text-green-400 tabular-nums">
            {stats.closed ? pct(stats.wins / stats.closed) : '—'}
          </div>
          <div className="text-[10px] text-[#555] font-mono">of closed signals</div>
        </Card>
        <Card title="SL hit rate" hint="Signals that got stopped out">
          <div className="text-2xl font-bold text-red-400 tabular-nums">
            {stats.closed ? pct(stats.losses / stats.closed) : '—'}
          </div>
          <div className="text-[10px] text-[#555] font-mono">of closed signals</div>
        </Card>
      </div>

      {/* Breakdown tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <BreakdownTable title="By market"           rows={stats.byMarket}     hint="Which markets the system performs best in" />
        <BreakdownTable title="By setup type"       rows={stats.bySetupType}  hint="Win rates feed back into signal confidence (boost if >60%, demote if <40%)" />
        <BreakdownTable title="By reviewer verdict" rows={stats.byVerdict}    hint="PASS verdicts should outperform CAUTION" />
        <BreakdownTable title="By probability tier" rows={stats.byProbability} hint="HIGH-prob signals should win more often than MEDIUM/LOW" />
      </div>

      {/* Open signals */}
      <Card title={`Currently monitored (${open?.count || 0})`} hint="Each signal updated every ~5 min until TP/SL hit or horizon expires">
        {open?.signals?.length ? (
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-[#555] text-left">
                <th className="font-normal pb-1">Ticker</th>
                <th className="font-normal pb-1">Market</th>
                <th className="font-normal pb-1">Dir</th>
                <th className="font-normal pb-1 text-right">Entry</th>
                <th className="font-normal pb-1 text-right">TP</th>
                <th className="font-normal pb-1 text-right">SL</th>
                <th className="font-normal pb-1 text-right">Setup</th>
                <th className="font-normal pb-1 text-right">Hrs open</th>
              </tr>
            </thead>
            <tbody>
              {open.signals.slice(0, 20).map(s => (
                <tr key={s.id} className="border-t border-[#161616]">
                  <td className="py-1.5 text-[#ddd]">{s.ticker}</td>
                  <td className="py-1.5 text-[#888] text-[10px]">{s.market}</td>
                  <td className={`py-1.5 font-bold ${s.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{s.direction}</td>
                  <td className="py-1.5 text-right text-[#aaa] tabular-nums">${s.entry}</td>
                  <td className="py-1.5 text-right text-green-500/70 tabular-nums">${s.tp}</td>
                  <td className="py-1.5 text-right text-red-500/70 tabular-nums">${s.sl}</td>
                  <td className="py-1.5 text-right text-[#888] text-[10px]">{s.setupType || '—'}</td>
                  <td className="py-1.5 text-right text-[#888] tabular-nums">{s.hoursSinceSignal}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-[11px] text-[#444] font-mono">No signals currently being monitored. They'll appear here as soon as the scanner generates one.</div>
        )}
      </Card>

      {/* Recent closed */}
      <div className="mt-3">
        <Card title="Recent closes" hint="The 20 most recently resolved signals">
          {stats.recentClosed?.length ? (
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-[#555] text-left">
                  <th className="font-normal pb-1">Ticker</th>
                  <th className="font-normal pb-1">Market</th>
                  <th className="font-normal pb-1">Dir</th>
                  <th className="font-normal pb-1">Outcome</th>
                  <th className="font-normal pb-1 text-right">MFE</th>
                  <th className="font-normal pb-1 text-right">MAE</th>
                  <th className="font-normal pb-1 text-right">Hrs</th>
                  <th className="font-normal pb-1 text-right">Setup</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentClosed.map(s => (
                  <tr key={s.id} className="border-t border-[#161616]">
                    <td className="py-1.5 text-[#ddd]">{s.ticker}</td>
                    <td className="py-1.5 text-[#888] text-[10px]">{s.market}</td>
                    <td className={`py-1.5 font-bold ${s.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{s.direction}</td>
                    <td className="py-1.5"><OutcomeBadge outcome={s.outcome} closeReason={s.closeReason} /></td>
                    <td className="py-1.5 text-right text-green-500/70 tabular-nums">{s.mfePct != null ? `${s.mfePct.toFixed(0)}%` : '—'}</td>
                    <td className="py-1.5 text-right text-amber-500/70 tabular-nums">{s.maePct != null ? `${s.maePct.toFixed(0)}%` : '—'}</td>
                    <td className="py-1.5 text-right text-[#888] tabular-nums">{s.timeToCloseHrs ?? '—'}</td>
                    <td className="py-1.5 text-right text-[#888] text-[10px]">{s.setupType || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[11px] text-[#444] font-mono">No closed signals yet — give the monitor time to resolve open ones.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
