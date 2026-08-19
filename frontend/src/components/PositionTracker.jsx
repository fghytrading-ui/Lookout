import { useState, useEffect, useRef } from 'react';

function elapsed(since) {
  const secs = Math.floor((Date.now() - since) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function PositionRow({ pos, livePrice, onRemove, onUpdate }) {
  const [timer, setTimer] = useState(elapsed(pos.enteredAt));
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    entry: pos.entry, tp: pos.tp, sl: pos.sl, shares: pos.shares
  });

  useEffect(() => {
    const t = setInterval(() => setTimer(elapsed(pos.enteredAt)), 1000);
    return () => clearInterval(t);
  }, [pos.enteredAt]);

  const startEdit = () => {
    setEditForm({ entry: pos.entry, tp: pos.tp, sl: pos.sl, shares: pos.shares });
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const saveEdit = () => {
    const e = parseFloat(editForm.entry);
    const t = parseFloat(editForm.tp);
    const s = parseFloat(editForm.sl);
    const sh = parseFloat(editForm.shares);
    if ([e, t, s, sh].some(isNaN)) { alert('All fields must be valid numbers'); return; }
    onUpdate(pos.id, { entry: e, tp: t, sl: s, shares: sh });
    setEditing(false);
  };

  const price = livePrice?.price ?? null;
  const isLong = pos.direction === 'LONG';

  let pnlDollar = null, pnlPct = null, distToTP = null, distToSL = null;
  let nearSL = false;

  if (price != null) {
    pnlDollar = isLong ? (price - pos.entry) * pos.shares : (pos.entry - price) * pos.shares;
    pnlPct    = isLong ? (price - pos.entry) / pos.entry * 100 : (pos.entry - price) / pos.entry * 100;
    distToTP  = isLong ? pos.tp  - price : price - pos.tp;
    distToSL  = isLong ? price - pos.sl  : pos.sl - price;
    const slPct = Math.abs((price - pos.sl) / pos.sl * 100);
    nearSL = slPct <= 2;
  }

  const pnlColor = pnlDollar == null ? 'text-[#555]' : pnlDollar >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className={`bg-[#0e0e0e] border rounded-lg p-4 fade-in ${
      nearSL ? 'border-red-500/70 warn-pulse' : isLong ? 'border-green-500/30' : 'border-red-500/30'
    }`}>
      {/* SCALE-OUT PROMPT — the step that turns a trade green.
          Once price reaches the first target you bank a third and move the
          stop to entry; from then on the position cannot become a loss.
          Without this reminder in the tracker the plan lives only on the
          scan card and is easy to miss while a trade is running. */}
      {pos.tp0 != null && price != null && (() => {
        const reached = isLong ? price >= pos.tp0 : price <= pos.tp0;
        const dist = isLong ? pos.tp0 - price : price - pos.tp0;
        const distPct = (dist / price) * 100;
        if (pos.scaledOut) {
          return (
            <div className="rounded p-2 border border-green-500/40 bg-green-500/10 mb-2">
              <div className="text-[11px] font-mono text-green-300">
                ✓ First third banked · stop at breakeven (${pos.entry}) — this trade can no longer lose
              </div>
            </div>
          );
        }
        if (reached) {
          return (
            <div className="rounded p-2 border border-green-500/50 bg-green-500/15 mb-2 warn-pulse">
              <div className="text-[11px] font-mono text-green-300 font-bold mb-1">
                🎯 First target hit (${pos.tp0}) — take a third off and move your stop to ${pos.entry}
              </div>
              <button
                onClick={() => onUpdate(pos.id, { scaledOut: true, sl: pos.entry })}
                className="text-[10px] font-mono font-bold bg-green-500/20 hover:bg-green-500/30 border border-green-500/50 text-green-200 rounded px-3 py-1">
                ✓ Done — move stop to breakeven
              </button>
            </div>
          );
        }
        return (
          <div className="rounded p-2 border border-[#242424] bg-[#0a0a0a] mb-2">
            <div className="text-[10px] font-mono text-[#888]">
              Next: take a third at <span className="text-green-400">${pos.tp0}</span>
              <span className="text-[#555]"> · {distPct.toFixed(1)}% away, then stop moves to breakeven</span>
            </div>
          </div>
        );
      })()}

      {nearSL && (
        <div className="bg-red-500/15 border border-red-500/40 rounded px-3 py-1.5 mb-3 text-[11px] text-red-400 font-mono font-bold">
          ⚠ APPROACHING STOP LOSS — Within 2% of SL
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold font-condensed tracking-wider">{pos.ticker}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded border font-mono font-bold ${
              isLong ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>
              {pos.direction}
            </span>
          </div>
          <div className="text-[10px] text-[#444] font-mono mt-0.5">
            {pos.shares} shares · Held {timer}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-xl font-mono font-bold tabular-nums ${pnlColor}`}>
            {pnlDollar != null ? `${pnlDollar >= 0 ? '+' : ''}$${pnlDollar.toFixed(2)}` : '—'}
          </div>
          <div className={`text-xs font-mono tabular-nums ${pnlColor}`}>
            {pnlPct != null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` : '—'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center">
          <div className="text-[9px] text-[#333] uppercase tracking-widest font-mono mb-1">Entry</div>
          <div className="text-green-400 font-mono text-sm tabular-nums">${pos.entry.toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-[#333] uppercase tracking-widest font-mono mb-1">Live Price</div>
          <div className="font-mono text-sm tabular-nums flex items-center justify-center gap-1">
            {price != null ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 live-dot" />
                <span>${price.toFixed(2)}</span>
              </>
            ) : <span className="text-[#444]">Loading…</span>}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-[#333] uppercase tracking-widest font-mono mb-1">P&L / Share</div>
          <div className={`font-mono text-sm tabular-nums ${pnlColor}`}>
            {pnlDollar != null && pos.shares > 0
              ? `${(pnlDollar / pos.shares) >= 0 ? '+' : ''}$${(pnlDollar / pos.shares).toFixed(2)}`
              : '—'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-blue-500/8 border border-blue-500/20 rounded p-2">
          <div className="text-[9px] text-blue-500/50 uppercase tracking-widest font-mono mb-1">
            TP ${pos.tp.toFixed(2)} · Distance
          </div>
          <div className="font-mono text-xs text-blue-400 tabular-nums">
            {distToTP != null ? `$${Math.abs(distToTP).toFixed(2)} ${distToTP >= 0 ? '→' : '✓ PAST'}` : '—'}
          </div>
        </div>
        <div className={`rounded p-2 border ${nearSL ? 'bg-red-500/15 border-red-500/40' : 'bg-red-500/8 border-red-500/20'}`}>
          <div className="text-[9px] text-red-500/50 uppercase tracking-widest font-mono mb-1">
            SL ${pos.sl.toFixed(2)} · Distance
          </div>
          <div className={`font-mono text-xs tabular-nums ${nearSL ? 'text-red-400 font-bold' : 'text-red-400'}`}>
            {distToSL != null ? `$${Math.abs(distToSL).toFixed(2)} ${distToSL >= 0 ? '←' : '⚠ BREACHED'}` : '—'}
          </div>
        </div>
      </div>

      {/* Edit form (inline) */}
      {editing && (
        <div className="bg-[#0a0a0a] border border-amber-500/30 rounded p-3 mb-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400 font-mono mb-2">Edit Position</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <div>
              <label className="text-[9px] text-[#555] font-mono">Entry $</label>
              <input type="number" step="0.01" value={editForm.entry}
                onChange={e => setEditForm({...editForm, entry: e.target.value})}
                className="w-full bg-[#0e0e0e] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs font-mono text-green-300" />
            </div>
            <div>
              <label className="text-[9px] text-[#555] font-mono">Take Profit $</label>
              <input type="number" step="0.01" value={editForm.tp}
                onChange={e => setEditForm({...editForm, tp: e.target.value})}
                className="w-full bg-[#0e0e0e] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs font-mono text-blue-300" />
            </div>
            <div>
              <label className="text-[9px] text-[#555] font-mono">Stop Loss $</label>
              <input type="number" step="0.01" value={editForm.sl}
                onChange={e => setEditForm({...editForm, sl: e.target.value})}
                className="w-full bg-[#0e0e0e] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs font-mono text-red-300" />
            </div>
            <div>
              <label className="text-[9px] text-[#555] font-mono">Shares</label>
              <input type="number" step="1" value={editForm.shares}
                onChange={e => setEditForm({...editForm, shares: e.target.value})}
                className="w-full bg-[#0e0e0e] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs font-mono text-[#ccc]" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveEdit}
              className="flex-1 text-[10px] font-mono font-bold bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-300 rounded py-1.5">
              ✓ Save Changes
            </button>
            <button onClick={cancelEdit}
              className="flex-1 text-[10px] font-mono bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-[#888] rounded py-1.5">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={startEdit}
          disabled={editing}
          className="flex-1 text-[10px] text-[#555] hover:text-amber-400 font-mono border border-[#1a1a1a] hover:border-amber-500/30 rounded py-1.5 transition-colors disabled:opacity-40"
        >
          ✏ Edit Entry / TP / SL
        </button>
        <button
          onClick={() => onRemove(pos.id)}
          className="flex-1 text-[10px] text-[#333] hover:text-red-400 font-mono border border-[#1a1a1a] hover:border-red-500/30 rounded py-1.5 transition-colors"
        >
          ✕ Close / Remove Position
        </button>
      </div>
    </div>
  );
}

function AddPositionForm({ onAdd }) {
  const [form, setForm] = useState({ ticker: '', direction: 'LONG', entry: '', shares: '', tp: '', sl: '' });
  const [error, setError] = useState('');

  const handle = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = () => {
    const { ticker, direction, entry, shares, tp, sl } = form;
    if (!ticker || !entry || !shares || !tp || !sl) { setError('All fields are required'); return; }
    const e = parseFloat(entry), sh = parseFloat(shares), t = parseFloat(tp), s = parseFloat(sl);
    if ([e, sh, t, s].some(isNaN)) { setError('Entry, Shares, TP and SL must be numbers'); return; }
    setError('');
    onAdd({ id: Date.now(), ticker: ticker.toUpperCase(), direction, entry: e, shares: sh, tp: t, sl: s, enteredAt: Date.now() });
    setForm({ ticker: '', direction: 'LONG', entry: '', shares: '', tp: '', sl: '' });
  };

  const inp = "bg-[#0a0a0a] border border-[#1f1f1f] rounded px-2.5 py-2 text-xs font-mono text-[#ccc] focus:outline-none focus:border-[#333] w-full";

  return (
    <div className="bg-[#0e0e0e] border border-[#1a1a1a] rounded-lg p-4">
      <div className="text-[10px] text-[#444] uppercase tracking-widest font-mono mb-3">Add Position</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
        <input className={inp} placeholder="Ticker (e.g. AAPL)" value={form.ticker} onChange={e => handle('ticker', e.target.value.toUpperCase())} />
        <select className={inp} value={form.direction} onChange={e => handle('direction', e.target.value)}>
          <option value="LONG">🟢 LONG</option>
          <option value="SHORT">🔴 SHORT</option>
        </select>
        <input className={inp} placeholder="Shares" type="number" value={form.shares} onChange={e => handle('shares', e.target.value)} />
        <input className={inp} placeholder="Entry $" type="number" value={form.entry} onChange={e => handle('entry', e.target.value)} />
        <input className={inp} placeholder="Take Profit $" type="number" value={form.tp} onChange={e => handle('tp', e.target.value)} />
        <input className={inp} placeholder="Stop Loss $" type="number" value={form.sl} onChange={e => handle('sl', e.target.value)} />
      </div>
      {error && <p className="text-red-400 text-[10px] font-mono mb-2">{error}</p>}
      <button
        onClick={submit}
        className="w-full py-2 text-xs font-mono font-bold tracking-wider bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] hover:border-green-500/30 text-[#888] hover:text-green-400 rounded transition-colors"
      >
        + ADD POSITION
      </button>
    </div>
  );
}

// localStorage helpers — persist positions across browser refreshes
const POS_KEY = 'lookout-open-positions';
export function loadPositions() {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || '[]'); } catch { return []; }
}
function savePositions(positions) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(positions)); } catch {}
}

export default function PositionTracker({ positions, setPositions, livePrices, onCloseTrade }) {
  // Sync to localStorage on every change
  useEffect(() => { savePositions(positions); }, [positions]);

  const addPosition = (pos) => setPositions(p => [pos, ...p]);
  const updatePosition = (id, updates) => {
    setPositions(p => p.map(x => x.id === id ? { ...x, ...updates } : x));
  };
  const removePosition = (id) => {
    const pos = positions.find(p => p.id === id);
    if (pos && onCloseTrade) {
      const live = livePrices[pos.ticker];
      const exit = live?.price;
      if (exit != null) {
        // Auto-log the close to the journal at the current live price
        onCloseTrade(pos, exit);
      } else {
        // Prompt for exit if no live price
        const userExit = prompt(`Closing ${pos.ticker} ${pos.direction}. Enter exit price:`, pos.entry);
        if (userExit && !isNaN(parseFloat(userExit))) {
          onCloseTrade(pos, parseFloat(userExit));
        }
      }
    }
    setPositions(p => p.filter(x => x.id !== id));
  };

  return (
    <section className="mb-8" data-section="position-tracker">
      <div className="flex items-center gap-3 px-5 py-3 rounded-t border border-cyan-500/20 bg-cyan-500/5">
        <span className="text-xl">📊</span>
        <div className="flex-1">
          <h2 className="text-sm font-bold tracking-widest font-condensed text-cyan-400">POSITION TRACKER</h2>
          <p className="text-[10px] text-[#444] font-mono mt-0.5">Live P&L · Distance to TP & SL · Time held</p>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-cyan-500/25 text-cyan-400 bg-cyan-500/10">
          {positions.length} position{positions.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="border border-t-0 border-cyan-500/20 rounded-b p-4">
        <div className="mb-4">
          <AddPositionForm onAdd={addPosition} />
        </div>
        {positions.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {positions.map(pos => (
              <PositionRow
                key={pos.id}
                pos={pos}
                livePrice={livePrices[pos.ticker]}
                onRemove={removePosition}
                onUpdate={updatePosition}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
