function MoverRow({ mover, dir }) {
  const isUp = mover.pct > 0;
  return (
    <tr className="border-b border-[#141414] hover:bg-[#0d0d0d]">
      <td className="py-2 px-3 font-mono font-bold text-sm">{mover.ticker}</td>
      <td className="py-2 px-3 text-[10px] text-[#666] font-mono truncate max-w-[180px]">{mover.name}</td>
      <td className="py-2 px-3 text-right font-mono text-xs tabular-nums">${mover.price?.toFixed(2)}</td>
      <td className="py-2 px-3 text-right font-mono text-[11px] text-[#555] tabular-nums">${mover.regClose?.toFixed(2)}</td>
      <td className={`py-2 px-3 text-right font-mono text-sm tabular-nums font-bold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
        {isUp ? '+' : ''}{mover.pct.toFixed(2)}%
      </td>
      <td className="py-2 px-3 text-center">
        <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded ${
          mover.session === 'pre' ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/20 text-blue-300'
        }`}>
          {mover.session === 'pre' ? 'PRE' : 'POST'}
        </span>
      </td>
    </tr>
  );
}

export default function PreMarketMovers({ data, marketSession }) {
  if (!data) return null;
  const { gainers = [], losers = [] } = data;
  if (!gainers.length && !losers.length) return null;

  const sessionLabel = marketSession === 'PRE_MARKET' ? 'PRE-MARKET' :
                       marketSession === 'AFTER_HOURS' ? 'AFTER-HOURS' :
                       'EXTENDED-HOURS';

  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 px-5 py-3 rounded-t border border-amber-500/20 bg-amber-500/5">
        <span className="text-xl">🌅</span>
        <div className="flex-1">
          <h2 className="text-sm font-bold tracking-widest font-condensed text-amber-400">{sessionLabel} MOVERS</h2>
          <p className="text-[10px] text-[#444] font-mono mt-0.5">Biggest pre/post-market gainers and losers — early swing-setup candidates</p>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-amber-500/25 text-amber-400 bg-amber-500/10">
          {gainers.length + losers.length} active
        </span>
      </div>

      <div className="border border-t-0 border-amber-500/20 rounded-b">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div className="lg:border-r border-[#1a1a1a]">
            <div className="px-4 py-2 bg-green-500/5 border-b border-[#1a1a1a]">
              <span className="text-[10px] uppercase tracking-widest text-green-400 font-mono font-bold">📈 Top Gainers</span>
            </div>
            <table className="w-full">
              <tbody>
                {gainers.length ? gainers.map(m => <MoverRow key={m.ticker} mover={m} dir="up" />)
                  : <tr><td colSpan="6" className="text-center py-6 text-[#333] text-[11px] font-mono">No significant gainers</td></tr>}
              </tbody>
            </table>
          </div>
          <div>
            <div className="px-4 py-2 bg-red-500/5 border-b border-[#1a1a1a]">
              <span className="text-[10px] uppercase tracking-widest text-red-400 font-mono font-bold">📉 Top Losers</span>
            </div>
            <table className="w-full">
              <tbody>
                {losers.length ? losers.map(m => <MoverRow key={m.ticker} mover={m} dir="down" />)
                  : <tr><td colSpan="6" className="text-center py-6 text-[#333] text-[11px] font-mono">No significant losers</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
