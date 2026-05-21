// Commodity Schedule Bar — shows upcoming inventory reports, USDA updates, OPEC
export default function CommodityScheduleBar({ schedule, dxy }) {
  if (!schedule?.length) return null;

  const todayIso = new Date().toISOString().split('T')[0];

  return (
    <div className="mx-4 mt-3 p-3 rounded border border-[#1a1a1a] bg-[#0a0a0a]">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-[#444] font-mono">🛢 Commodity Schedule · </span>
          <span className="text-[10px] text-[#666] font-mono">Inventory reports, USDA updates, OPEC — next 7 days</span>
        </div>
        {dxy && (
          <span className="text-[10px] font-mono">
            <span className="text-[#555]">DXY (inverse correlation):</span>{' '}
            <span className={dxy.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}>
              ${dxy.price?.toFixed(2)} ({dxy.changePercent >= 0 ? '+' : ''}{dxy.changePercent?.toFixed(2)}%)
            </span>
            <span className="text-[#444] ml-1">
              {dxy.changePercent >= 0 ? '— headwind for commodities' : '— tailwind for commodities'}
            </span>
          </span>
        )}
      </div>

      <div className="space-y-1">
        {schedule.slice(0, 6).map((e, i) => {
          const isToday = e.date === todayIso;
          const affectsStr = Array.isArray(e.affects) ? e.affects.join(', ') : e.affects;
          return (
            <div key={i} className={`flex items-center justify-between py-1 px-2 rounded text-[11px] font-mono ${
              isToday ? 'bg-amber-500/10 border border-amber-500/20' : 'hover:bg-[#0e0e0e]'
            }`}>
              <div className="flex items-center gap-2 min-w-0">
                {isToday && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 live-dot flex-shrink-0" />}
                <span className={`flex-shrink-0 w-14 ${isToday ? 'text-amber-300 font-bold' : 'text-[#666]'}`}>{e.dayName} {e.dayNum}</span>
                <span className="text-[#888] flex-shrink-0 w-20">{e.time}</span>
                <span className={`truncate ${isToday ? 'text-[#ddd]' : 'text-[#aaa]'}`}>{e.name}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[9px] text-[#555] hidden sm:inline">affects: {affectsStr}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                  e.impact === 'high'   ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                  e.impact === 'medium' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                                          'bg-[#1a1a1a] border-[#252525] text-[#555]'
                }`}>{e.impact.toUpperCase()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
