import { useState, useEffect } from 'react';

const STORAGE_KEY = 'lookout-risk-settings';

export default function RiskControls({ accountSize, setAccountSize, riskPct, setRiskPct }) {
  const [open, setOpen] = useState(false);

  // Persist to localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const { accountSize: a, riskPct: r } = JSON.parse(saved);
        if (a) setAccountSize(a);
        if (r) setRiskPct(r);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ accountSize, riskPct })); } catch {}
  }, [accountSize, riskPct]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] font-mono px-3 py-1.5 border border-cyan-500/30 hover:border-cyan-500/60 text-cyan-400 rounded transition-colors"
      >
        💰 ${accountSize.toLocaleString()} · {riskPct}%
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 bg-[#0e0e0e] border border-cyan-500/30 rounded-lg p-4 w-64 shadow-2xl">
            <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-mono mb-3">Risk Settings</div>

            <label className="block text-[10px] text-[#666] font-mono mb-1">Account Size ($)</label>
            <input
              type="number"
              value={accountSize}
              onChange={e => setAccountSize(Math.max(100, parseInt(e.target.value) || 0))}
              className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded px-2.5 py-2 text-xs font-mono text-[#ccc] focus:outline-none focus:border-cyan-500/40 mb-3"
            />

            <label className="block text-[10px] text-[#666] font-mono mb-1">Risk per Trade (%)</label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="5"
              value={riskPct}
              onChange={e => setRiskPct(Math.max(0.1, Math.min(5, parseFloat(e.target.value) || 1)))}
              className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded px-2.5 py-2 text-xs font-mono text-[#ccc] focus:outline-none focus:border-cyan-500/40 mb-3"
            />

            <div className="text-[10px] text-[#444] font-mono leading-relaxed">
              Dollar risk per trade: <span className="text-amber-400">${(accountSize * riskPct / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="text-[9px] text-[#2a2a2a] font-mono mt-2 leading-relaxed">
              Most pros risk 0.5–2% per trade. Never exceed 2%.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
