// Energy inventory release awareness for the Commodities page.
// EIA crude/NG reports are scheduled binary events — they move CL/NG 2–5%
// in minutes. This bar tells the user the next release time, consensus,
// previous, and how dangerous it is right now (proximity = risk).

const PRODUCT_LABELS = {
  crudeOil:   { icon: '🛢', name: 'Crude Oil Inventories', source: 'EIA' },
  naturalGas: { icon: '🔥', name: 'Natural Gas Storage',  source: 'EIA' },
  crudeApi:   { icon: '🛢', name: 'API Crude Stock',      source: 'API (pre-EIA)' }
};

function urgencyColor(hours) {
  if (hours < 0)  return 'border-red-500/40 text-red-300 bg-red-500/10';
  if (hours <= 2) return 'border-red-500/40 text-red-300 bg-red-500/10 warn-pulse';
  if (hours <= 8) return 'border-amber-500/40 text-amber-300 bg-amber-500/10';
  if (hours <= 24) return 'border-amber-500/25 text-amber-200 bg-amber-500/5';
  return 'border-[#2a2a2a] text-[#aaa] bg-[#0a0a0a]';
}

function formatRelativeTime(hours) {
  if (hours < 0) {
    const h = Math.abs(hours);
    if (h < 1) return `released ${Math.round(h * 60)}m ago`;
    return `released ${h.toFixed(1)}h ago`;
  }
  if (hours < 1)  return `in ${Math.round(hours * 60)}m`;
  if (hours < 48) return `in ${hours.toFixed(1)}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function formatReleaseTime(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const opts = { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/London' };
  return d.toLocaleString('en-GB', opts) + ' UK';
}

export default function InventoryReleaseBar({ releases }) {
  if (!releases || Object.keys(releases).length === 0) return null;

  const products = Object.entries(releases).sort((a, b) => a[1].hoursUntil - b[1].hoursUntil);

  return (
    <div className="mx-4 mt-3 p-3 rounded border border-[#1a1a1a] bg-[#0a0a0a]">
      <div className="text-[10px] uppercase tracking-widest text-[#666] font-mono mb-2">
        ⚡ Scheduled Inventory Releases — energy products move 2–5% on these
      </div>
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-[11px] font-mono">
        {products.map(([key, r]) => {
          const meta = PRODUCT_LABELS[key] || { icon: '📊', name: r.title, source: 'EIA' };
          return (
            <div key={key} className={`px-3 py-2 rounded border flex items-center gap-3 ${urgencyColor(r.hoursUntil)}`}>
              <span className="text-base">{meta.icon}</span>
              <div className="flex flex-col leading-tight">
                <span className="font-bold text-[11px]">{meta.name}</span>
                <span className="text-[10px] opacity-80">{formatReleaseTime(r.date)} · <span className="font-bold">{formatRelativeTime(r.hoursUntil)}</span></span>
              </div>
              {(r.forecast || r.previous) && (
                <div className="flex flex-col leading-tight text-right border-l border-[#2a2a2a]/40 pl-3">
                  {r.forecast && (
                    <span className="text-[10px]"><span className="opacity-60">Consensus:</span> <span className="font-bold">{r.forecast}</span></span>
                  )}
                  {r.previous && (
                    <span className="text-[10px] opacity-70"><span className="opacity-60">Previous:</span> {r.previous}</span>
                  )}
                </div>
              )}
              <span className="text-[9px] opacity-50">· {meta.source}</span>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-[#555] mt-2 leading-relaxed">
        Reviewer will <span className="text-red-400 font-bold">BLOCK</span> energy trades within ±2h of release, <span className="text-amber-400 font-bold">CAUTION</span> within 24h.
      </div>
    </div>
  );
}
