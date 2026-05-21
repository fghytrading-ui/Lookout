// Currency Strength Meter — ranks G7 currencies strongest to weakest based on today's pair moves
const CURRENCY_FLAG = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
  CHF: '🇨🇭', AUD: '🇦🇺', NZD: '🇳🇿', CAD: '🇨🇦'
};

export default function CurrencyStrengthMeter({ strength, dxy }) {
  if (!strength?.length) return null;

  const max = Math.max(...strength.map(s => Math.abs(s.score)), 0.3);

  return (
    <div className="mx-4 mt-3 p-3 rounded border border-[#1a1a1a] bg-[#0a0a0a]">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-[#444] font-mono">💪 Currency Strength · </span>
          <span className="text-[10px] text-[#666] font-mono">G7 + USD, ranked by today's relative pair performance</span>
        </div>
        {dxy && (
          <span className="text-[10px] font-mono">
            <span className="text-[#555]">DXY:</span> <span className={dxy.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}>${dxy.price?.toFixed(2)} ({dxy.changePercent >= 0 ? '+' : ''}{dxy.changePercent?.toFixed(2)}%)</span>
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {strength.map(s => {
          const pct = Math.abs(s.score) / max * 100;
          const barColor = s.score >= 0.15  ? 'bg-green-500'
                         : s.score >= 0     ? 'bg-green-500/40'
                         : s.score >= -0.15 ? 'bg-red-500/40'
                                            : 'bg-red-500';
          const textColor = s.score >= 0.15  ? 'text-green-300 font-bold'
                          : s.score >= 0     ? 'text-green-400'
                          : s.score >= -0.15 ? 'text-red-400'
                                             : 'text-red-300 font-bold';
          return (
            <div key={s.currency} className="flex items-center gap-2">
              <span className="text-[12px] w-8">{CURRENCY_FLAG[s.currency]}</span>
              <span className={`font-mono font-bold text-xs w-9 ${textColor}`}>{s.currency}</span>
              <div className="flex-1 relative h-3 bg-[#0e0e0e] rounded overflow-hidden border border-[#181818]">
                {/* Center line */}
                <div className="absolute top-0 left-1/2 h-full w-px bg-[#222]" />
                {s.score >= 0 ? (
                  <div className={`absolute top-0 left-1/2 h-full ${barColor}`} style={{ width: `${pct/2}%` }} />
                ) : (
                  <div className={`absolute top-0 right-1/2 h-full ${barColor}`} style={{ width: `${pct/2}%` }} />
                )}
              </div>
              <span className={`text-[10px] font-mono w-12 text-right ${textColor} tabular-nums`}>{s.score >= 0 ? '+' : ''}{s.score.toFixed(2)}%</span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 pt-2 border-t border-[#1a1a1a] flex items-center gap-3 flex-wrap text-[10px] font-mono">
        {strength[0] && <span><span className="text-[#555]">Strongest:</span> <span className="text-green-400 font-bold">{strength[0].currency}</span></span>}
        {strength[strength.length-1] && <span><span className="text-[#555]">Weakest:</span> <span className="text-red-400 font-bold">{strength[strength.length-1].currency}</span></span>}
        {strength[0] && strength[strength.length-1] && (
          <span><span className="text-[#555]">Best pair to long:</span> <span className="text-amber-400">{strength[0].currency}{strength[strength.length-1].currency}</span></span>
        )}
      </div>
    </div>
  );
}
