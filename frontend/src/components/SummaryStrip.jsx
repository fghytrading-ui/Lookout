function Stat({ label, value, valueClass = 'text-[#ccc]', sub }) {
  return (
    <div className="flex flex-col items-center px-4 border-r border-[#1a1a1a] last:border-r-0">
      <span className="text-[9px] uppercase tracking-widest text-[#333] font-mono mb-0.5">{label}</span>
      <span className={`text-sm font-mono font-bold tabular-nums ${valueClass}`}>{value}</span>
      {sub && <span className="text-[9px] text-[#333] font-mono">{sub}</span>}
    </div>
  );
}

export default function SummaryStrip({ trades, scanStats, tickerPrices }) {
  const allTrades = [
    ...(trades.enterNow || []),
    ...(trades.waitForBounce || []),
    ...(trades.carryForward || [])
  ];

  const topPick = allTrades[0];
  const bestRR = allTrades.reduce((best, t) => (!best || t.rrRatio > best.rrRatio ? t : best), null);
  const highCount = allTrades.filter(t => t.probability === 'HIGH').length;
  const longCount  = allTrades.filter(t => t.direction === 'LONG').length;
  const shortCount = allTrades.filter(t => t.direction === 'SHORT').length;

  const wti = tickerPrices['CL=F'];
  const gold = tickerPrices['GLD'];
  const spy = tickerPrices['SPY'];

  const macroRisk = highCount >= 3 ? { label: 'ELEVATED', cls: 'text-red-400' }
    : highCount >= 1 ? { label: 'MODERATE', cls: 'text-amber-400' }
    : { label: 'LOW', cls: 'text-green-400' };

  return (
    <div className="sticky bottom-0 z-40 bg-[#080808] border-t border-[#1a1a1a]">
      <div className="flex items-center overflow-x-auto py-2 px-2 gap-0">
        <div className="text-[9px] uppercase tracking-widest text-[#222] font-mono px-3 flex-shrink-0">
          SUMMARY
        </div>

        <Stat
          label="Top Pick"
          value={topPick ? `${topPick.ticker} ${topPick.direction}` : '—'}
          valueClass={topPick?.direction === 'LONG' ? 'text-green-400' : topPick ? 'text-red-400' : 'text-[#444]'}
          sub={topPick ? `R:R ${topPick.rrRatio}:1` : undefined}
        />
        <Stat
          label="Best R:R"
          value={bestRR ? `${bestRR.ticker} ${bestRR.rrRatio}:1` : '—'}
          valueClass="text-amber-400"
        />
        <Stat
          label="Scanned"
          value={scanStats?.scannedCount ?? '—'}
          sub={`${scanStats?.passedFilter ?? 0} passed filter`}
        />
        <Stat label="HIGH PROB" value={highCount} valueClass="text-green-400" />
        <Stat label="Longs / Shorts" value={`${longCount} / ${shortCount}`} valueClass="text-[#aaa]" />
        <Stat
          label="WTI Crude"
          value={wti?.price ? `$${wti.price.toFixed(2)}` : '—'}
          valueClass={wti?.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}
          sub={wti?.changePercent != null ? `${wti.changePercent >= 0 ? '+' : ''}${wti.changePercent.toFixed(2)}%` : undefined}
        />
        <Stat
          label="Gold (GLD)"
          value={gold?.price ? `$${gold.price.toFixed(2)}` : '—'}
          valueClass="text-amber-400"
        />
        <Stat
          label="SPY"
          value={spy?.price ? `$${spy.price.toFixed(2)}` : '—'}
          valueClass={spy?.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <Stat label="Macro Risk" value={macroRisk.label} valueClass={macroRisk.cls} />
      </div>
    </div>
  );
}
