export default function MarketStatus({ status, lastUpdated, scanning }) {
  const session = status?.session;

  const sessionConfig = {
    MARKET_OPEN:  { label: 'MARKET OPEN',   dot: 'bg-green-400 live-dot',  text: 'text-green-400',  border: 'border-green-500/30' },
    PRE_MARKET:   { label: 'PRE-MARKET',     dot: 'bg-amber-400',           text: 'text-amber-400',  border: 'border-amber-500/30' },
    AFTER_HOURS:  { label: 'AFTER HOURS',    dot: 'bg-blue-400',            text: 'text-blue-400',   border: 'border-blue-500/30'  },
    CLOSED:       { label: 'MARKET CLOSED',  dot: 'bg-red-500',             text: 'text-red-400',    border: 'border-red-500/30'   },
    WEEKEND:      { label: 'WEEKEND',        dot: 'bg-gray-500',            text: 'text-gray-400',   border: 'border-gray-600/30'  },
    HOLIDAY:      { label: 'MARKET HOLIDAY', dot: 'bg-gray-500',            text: 'text-gray-400',   border: 'border-gray-600/30'  }
  };

  const cfg = sessionConfig[session] || sessionConfig['CLOSED'];

  return (
    <div className="flex items-center gap-3">
      <div className={`flex items-center gap-2 px-3 py-1 rounded border ${cfg.border} bg-black/40`}>
        <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
        <span className={`text-xs font-bold tracking-widest font-mono ${cfg.text}`}>{cfg.label}</span>
      </div>
      {lastUpdated && (
        <span className="text-[10px] text-[#444] font-mono hidden sm:block">
          {(() => {
            // Say how old the data is, not merely when it arrived. A stale
            // board with a fresh timestamp is worse than an obviously stale
            // one, because it is trusted.
            const secs = Math.max(0, Math.round((Date.now() - lastUpdated.getTime()) / 1000));
            const when = lastUpdated.toLocaleTimeString('en-US', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
            const age = secs < 90 ? 'live' : secs < 600 ? `${Math.round(secs / 60)} min old` : `${Math.round(secs / 60)} min old — stale`;
            return <>Data {age} · {when} UK</>;
          })()}
        </span>
      )}
      {scanning && (
        <span className="text-[10px] text-amber-400 font-mono animate-pulse">⟳ SCANNING…</span>
      )}
    </div>
  );
}
