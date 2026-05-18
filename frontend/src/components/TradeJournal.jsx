import { useState, useEffect } from 'react';

const STORAGE_KEY = 'lookout-trade-journal';

export function loadJournal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveJournal(entries) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
}

export function logTradeClose({ ticker, direction, entry, exit, shares, sl, tp, enteredAt }) {
  const journal = loadJournal();
  const isLong = direction === 'LONG';
  const pnl = (isLong ? (exit - entry) : (entry - exit)) * shares;
  const pnlPct = (isLong ? (exit - entry) : (entry - exit)) / entry * 100;
  // R multiple — how many SL distances did the trade move
  const slDist = Math.abs(entry - sl);
  const rMultiple = slDist > 0 ? (isLong ? (exit - entry) : (entry - exit)) / slDist : 0;
  const win = pnl > 0;

  journal.unshift({
    id: Date.now(),
    ticker, direction, entry, exit, shares, sl, tp,
    pnl: Math.round(pnl * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100,
    rMultiple: Math.round(rMultiple * 10) / 10,
    win,
    enteredAt, closedAt: Date.now()
  });
  saveJournal(journal.slice(0, 200)); // keep last 200
  return journal[0];
}

function computeStats(journal) {
  if (!journal.length) return null;
  const wins = journal.filter(t => t.win);
  const losses = journal.filter(t => !t.win);
  const totalPnl = journal.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const avgR = journal.reduce((s, t) => s + (t.rMultiple || 0), 0) / journal.length;
  const winRate = (wins.length / journal.length) * 100;
  const longs = journal.filter(t => t.direction === 'LONG');
  const shorts = journal.filter(t => t.direction === 'SHORT');
  return {
    total: journal.length,
    winRate, wins: wins.length, losses: losses.length,
    totalPnl, avgWin, avgLoss, avgR,
    longWinRate: longs.length ? longs.filter(t => t.win).length / longs.length * 100 : null,
    shortWinRate: shorts.length ? shorts.filter(t => t.win).length / shorts.length * 100 : null,
    bestTrade: journal.reduce((b, t) => !b || t.pnl > b.pnl ? t : b, null),
    worstTrade: journal.reduce((w, t) => !w || t.pnl < w.pnl ? t : w, null)
  };
}

function Stat({ label, value, color = 'text-[#ccc]' }) {
  return (
    <div className="text-center">
      <div className="text-[9px] uppercase tracking-widest text-[#333] font-mono">{label}</div>
      <div className={`font-mono font-bold text-sm tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

export default function TradeJournal({ refreshKey }) {
  const [journal, setJournal] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { setJournal(loadJournal()); }, [refreshKey]);

  const stats = computeStats(journal);

  const exportCSV = () => {
    if (!journal.length) return;
    const headers = ['Ticker','Direction','Entry','Exit','Shares','P&L','P&L%','R','Win','Entered','Closed'];
    const rows = journal.map(t => [
      t.ticker, t.direction, t.entry, t.exit, t.shares, t.pnl, t.pnlPct, t.rMultiple,
      t.win ? 'Y' : 'N',
      new Date(t.enteredAt).toISOString(), new Date(t.closedAt).toISOString()
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lookout-journal-${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const clearJournal = () => {
    if (confirm('Delete all trade history? This cannot be undone.')) {
      saveJournal([]); setJournal([]);
    }
  };

  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 px-5 py-3 rounded-t border border-purple-500/20 bg-purple-500/5">
        <span className="text-xl">📈</span>
        <div className="flex-1">
          <h2 className="text-sm font-bold tracking-widest font-condensed text-purple-400">TRADE JOURNAL</h2>
          <p className="text-[10px] text-[#444] font-mono mt-0.5">Your live performance — closed trades, win rate, R multiples</p>
        </div>
        {journal.length > 0 && (
          <>
            <button onClick={exportCSV} className="text-[10px] font-mono px-2 py-1 border border-[#2a2a2a] hover:border-purple-500/40 text-[#555] hover:text-purple-400 rounded">Export CSV</button>
            <button onClick={clearJournal} className="text-[10px] font-mono px-2 py-1 border border-[#2a2a2a] hover:border-red-500/40 text-[#555] hover:text-red-400 rounded">Clear</button>
          </>
        )}
      </div>

      <div className="border border-t-0 border-purple-500/20 rounded-b p-4">
        {!journal.length ? (
          <div className="text-center py-8">
            <div className="text-[#2a2a2a] text-2xl mb-2">○</div>
            <p className="text-[#444] text-xs font-mono">No trades logged yet</p>
            <p className="text-[#333] text-[10px] font-mono mt-1">Closing a position from the Position Tracker will log it here automatically</p>
          </div>
        ) : (
          <>
            {/* Stats overview */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4 pb-4 border-b border-[#1a1a1a]">
                <Stat label="Total Trades" value={stats.total} />
                <Stat label="Win Rate" value={`${stats.winRate.toFixed(0)}%`}
                  color={stats.winRate >= 60 ? 'text-green-400' : stats.winRate >= 50 ? 'text-amber-400' : 'text-red-400'} />
                <Stat label="Total P&L" value={`${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(0)}`}
                  color={stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'} />
                <Stat label="Avg R" value={stats.avgR.toFixed(2)}
                  color={stats.avgR >= 1 ? 'text-green-400' : stats.avgR >= 0 ? 'text-amber-400' : 'text-red-400'} />
                <Stat label="Avg Win" value={`+$${stats.avgWin.toFixed(0)}`} color="text-green-400" />
                <Stat label="Avg Loss" value={`-$${Math.abs(stats.avgLoss).toFixed(0)}`} color="text-red-400" />
              </div>
            )}

            {/* Trade history table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1a1a1a]">
                    <th className="text-left py-2 px-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">Ticker</th>
                    <th className="text-center py-2 px-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">Dir</th>
                    <th className="text-right py-2 px-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">Entry</th>
                    <th className="text-right py-2 px-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">Exit</th>
                    <th className="text-right py-2 px-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">P&L</th>
                    <th className="text-right py-2 px-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">P&L %</th>
                    <th className="text-right py-2 px-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">R</th>
                    <th className="text-right py-2 px-2 text-[9px] uppercase tracking-widest text-[#333] font-mono">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {(expanded ? journal : journal.slice(0, 10)).map(t => (
                    <tr key={t.id} className="border-b border-[#141414] hover:bg-[#0d0d0d]">
                      <td className="py-2 px-2 font-mono font-bold text-[12px]">{t.ticker}</td>
                      <td className={`py-2 px-2 text-center text-[10px] font-mono font-bold ${t.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{t.direction}</td>
                      <td className="py-2 px-2 text-right font-mono text-[11px] tabular-nums">${t.entry.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-mono text-[11px] tabular-nums">${t.exit.toFixed(2)}</td>
                      <td className={`py-2 px-2 text-right font-mono text-[11px] tabular-nums font-bold ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</td>
                      <td className={`py-2 px-2 text-right font-mono text-[11px] tabular-nums ${t.pnlPct >= 0 ? 'text-green-400/80' : 'text-red-400/80'}`}>{t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%</td>
                      <td className={`py-2 px-2 text-right font-mono text-[11px] tabular-nums ${t.rMultiple >= 1 ? 'text-green-400' : t.rMultiple >= 0 ? 'text-amber-400' : 'text-red-400'}`}>{t.rMultiple >= 0 ? '+' : ''}{t.rMultiple}R</td>
                      <td className="py-2 px-2 text-right font-mono text-[10px] text-[#555]">{new Date(t.closedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {journal.length > 10 && (
                <button onClick={() => setExpanded(!expanded)} className="w-full text-center py-2 mt-2 text-[10px] text-[#555] hover:text-purple-400 font-mono">
                  {expanded ? `Show 10 most recent` : `Show all ${journal.length} trades`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
