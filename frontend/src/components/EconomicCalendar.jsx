const IMPACT_CONFIG = {
  high:   { label: 'HIGH',   dot: 'bg-red-500',    text: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/25' },
  medium: { label: 'MED',    dot: 'bg-amber-400',  text: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/25' },
  low:    { label: 'LOW',    dot: 'bg-[#444]',      text: 'text-[#555]',     bg: 'bg-[#111]',        border: 'border-[#1f1f1f]' }
};

function EventRow({ event }) {
  const cfg = IMPACT_CONFIG[event.impact] || IMPACT_CONFIG.low;
  const isToday = event.date === new Date().toISOString().split('T')[0];

  return (
    <tr className={`border-b border-[#141414] ${isToday ? 'bg-[#0f0f0a]' : 'hover:bg-[#0d0d0d]'} transition-colors`}>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {isToday && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 live-dot flex-shrink-0" />}
          <span className={`text-[11px] font-mono font-bold ${isToday ? 'text-amber-300' : 'text-[#666]'}`}>
            {event.dayName} {event.dayNum}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-[11px] font-mono text-[#888]">{event.time}</span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {event.country && (
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#888] border border-[#252525]">
              {event.country}
            </span>
          )}
          <span className={`text-[11px] font-mono font-medium ${isToday ? 'text-[#ccc]' : 'text-[#999]'}`}>
            {event.name}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${cfg.bg} ${cfg.border} ${cfg.text} font-mono`}>
          {cfg.label}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-[11px] font-mono text-[#555]">{event.expected ?? '—'}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-[11px] font-mono text-[#444]">{event.previous ?? '—'}</span>
      </td>
    </tr>
  );
}

export default function EconomicCalendar({ events, isLive }) {
  const highCount = events.filter(e => e.impact === 'high').length;

  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 px-5 py-3 rounded-t border border-purple-500/20 bg-purple-500/5 mb-0">
        <span className="text-xl">📅</span>
        <div className="flex-1">
          <h2 className="text-sm font-bold tracking-widest font-condensed text-purple-400">THIS WEEK'S CALENDAR</h2>
          <p className="text-[10px] text-[#444] font-mono mt-0.5">Economic events with expected vs previous — next 7 trading days</p>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-green-500/40 text-green-300 bg-green-500/10 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 live-dot" />
              LIVE
            </span>
          )}
          {highCount > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-red-500/25 text-red-400 bg-red-500/10">
              {highCount} HIGH IMPACT
            </span>
          )}
        </div>
      </div>

      <div className="border border-t-0 border-purple-500/20 rounded-b overflow-hidden">
        {events.length === 0 ? (
          <div className="px-5 py-8 text-center text-[#333] text-xs font-mono">
            No calendar events loaded — check backend connection
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-[#1a1a1a] bg-[#0a0a0a]">
                  <th className="px-3 py-2 text-left text-[9px] uppercase tracking-widest text-[#333] font-mono">Date</th>
                  <th className="px-3 py-2 text-left text-[9px] uppercase tracking-widest text-[#333] font-mono">Time (UK)</th>
                  <th className="px-3 py-2 text-left text-[9px] uppercase tracking-widest text-[#333] font-mono">Event</th>
                  <th className="px-3 py-2 text-center text-[9px] uppercase tracking-widest text-[#333] font-mono">Impact</th>
                  <th className="px-3 py-2 text-right text-[9px] uppercase tracking-widest text-[#333] font-mono">Expected</th>
                  <th className="px-3 py-2 text-right text-[9px] uppercase tracking-widest text-[#333] font-mono">Previous</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, i) => <EventRow key={i} event={event} />)}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2 border-t border-[#141414] bg-[#080808]">
          <p className="text-[9px] text-[#2a2a2a] font-mono">
            Calendar data is template-based. Add a Tradingeconomics API key for live event data.
          </p>
        </div>
      </div>
    </section>
  );
}
