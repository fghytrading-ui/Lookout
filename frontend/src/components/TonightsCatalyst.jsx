export default function TonightsCatalyst({ catalysts }) {
  if (!catalysts?.length) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 px-5 py-3 rounded-t border border-red-500/30 bg-red-500/5">
        <span className="text-xl animate-pulse">🔴</span>
        <div className="flex-1">
          <h2 className="text-sm font-bold tracking-widest font-condensed text-red-400">TONIGHT'S CATALYST</h2>
          <p className="text-[10px] text-[#444] font-mono mt-0.5">Binary events — prepare both scenarios before entering any position</p>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-red-500/25 text-red-400 bg-red-500/10">
          {catalysts.length} EVENT{catalysts.length !== 1 ? 'S' : ''}
        </span>
      </div>

      <div className="border border-t-0 border-red-500/30 rounded-b p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {catalysts.map((event, i) => (
          <div key={i} className="bg-[#0e0e0e] border border-red-500/20 rounded-lg p-4 fade-in">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-condensed font-bold text-base text-red-300 tracking-wide">{event.name}</div>
                <div className="text-[11px] text-[#555] font-mono">{event.dayName} {event.dayNum} · {event.time}</div>
              </div>
              <div className="text-right text-xs font-mono">
                <div className="text-[#666]">Expected</div>
                <div className="text-amber-400 font-bold">{event.expected}</div>
                <div className="text-[#444]">Prev: {event.previous}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="bg-green-500/8 border border-green-500/20 rounded p-2.5">
                <div className="text-[9px] uppercase tracking-widest text-green-500/60 font-mono mb-1">🟢 BEAT SCENARIO — LONG PLAY</div>
                <p className="text-[11px] text-green-300/80 font-mono leading-relaxed">{event.longScenario}</p>
              </div>
              <div className="bg-red-500/8 border border-red-500/20 rounded p-2.5">
                <div className="text-[9px] uppercase tracking-widest text-red-500/60 font-mono mb-1">🔴 MISS SCENARIO — SHORT PLAY</div>
                <p className="text-[11px] text-red-300/80 font-mono leading-relaxed">{event.shortScenario}</p>
              </div>
            </div>

            <div className="mt-2 text-[9px] text-[#333] font-mono">
              ⚠ Binary events carry elevated risk. Reduce position size. Never hold through the print without defined stops.
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
