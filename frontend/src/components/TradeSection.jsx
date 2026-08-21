import TradeCard from './TradeCard.jsx';

const SECTION_CONFIG = {
  enter: {
    icon: '⚡',
    label: 'ENTER NOW',
    sub: 'Active momentum — enter at market or limit',
    accent: 'text-green-400',
    border: 'border-green-500/20',
    bg: 'bg-green-500/5'
  },
  bounce: {
    icon: '⏳',
    label: 'WAIT FOR BOUNCE',
    sub: 'Dead-cat bounce or gap-fill required before entry',
    accent: 'text-amber-400',
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/5'
  },
  carry: {
    icon: '↗',
    label: 'CARRY FORWARD',
    sub: 'Developing setups — monitor and enter on confirmation',
    accent: 'text-blue-400',
    border: 'border-blue-500/20',
    bg: 'bg-blue-500/5'
  }
};

export default function TradeSection({ trades, type, onRefresh, newTickers, accountSize, riskPct, entryTiming, onTakeTrade, emptyReason }) {
  const cfg = SECTION_CONFIG[type] || SECTION_CONFIG.carry;

  return (
    <section className="mb-8">
      {/* Section header */}
      <div className={`flex items-center gap-3 px-5 py-3 rounded-t border ${cfg.border} ${cfg.bg} mb-0`}>
        <span className="text-xl">{cfg.icon}</span>
        <div className="flex-1">
          <h2 className={`text-sm font-bold tracking-widest font-condensed ${cfg.accent}`}>
            {cfg.label}
          </h2>
          <p className="text-[10px] text-[#444] font-mono mt-0.5">{cfg.sub}</p>
        </div>
        <span className={`text-xs font-mono px-2 py-0.5 rounded border ${cfg.border} ${cfg.accent}`}>
          {trades.length} setup{trades.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Cards grid */}
      {trades.length === 0 ? (
        <div className={`border border-t-0 ${cfg.border} rounded-b px-5 py-8 text-center`}>
          <div className="text-[#2a2a2a] text-2xl mb-2">○</div>
          <p className="text-[#333] text-xs font-mono">
            No setups passed the analyst filter in this category
          </p>
          {/* Say WHY nothing qualified — an unexplained empty section reads as
              a broken scanner, when the reason is usually actionable. */}
          {type === 'enter' && emptyReason && (
            <p className="text-[10px] text-[#555] font-mono mt-2 max-w-xl mx-auto leading-relaxed">
              {emptyReason}
            </p>
          )}
        </div>
      ) : (
        <div className={`border border-t-0 ${cfg.border} rounded-b p-4`}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            {trades.map((trade, i) => (
              <TradeCard
                key={`${trade.ticker}-${i}`}
                trade={trade}
                type={type}
                isNew={newTickers?.has(trade.ticker)}
                accountSize={accountSize}
                riskPct={riskPct}
                entryTiming={entryTiming}
                onTakeTrade={onTakeTrade}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
