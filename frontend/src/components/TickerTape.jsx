const TAPE_TICKERS = [
  'AAPL','MSFT','NVDA','TSLA','META','GOOGL','AMZN',
  'AMD','SPY','QQQ','GLD','BTC-USD','ETH-USD','CL=F',
  'JPM','COIN','PLTR','MSTR','IWM','SMCI'
];

function TapeItem({ ticker, data }) {
  if (!data || data.error) {
    return (
      <span className="inline-flex items-center gap-2 px-4 text-[#333]">
        <span className="font-bold text-xs">{ticker}</span>
        <span className="text-[10px]">—</span>
      </span>
    );
  }

  const chg = data.changePercent || 0;
  const isUp = chg >= 0;
  const price = data.price;

  // Show pre/post market price when relevant
  const displayPrice = data.preMarketPrice || data.postMarketPrice || price;
  const isExtended = !!(data.preMarketPrice || data.postMarketPrice);

  return (
    <span className="inline-flex items-center gap-1.5 px-4 border-r border-[#1a1a1a]">
      <span className="font-bold text-xs text-[#ccc] tracking-wider font-condensed">{ticker}</span>
      <span className={`tabular-nums text-xs font-mono font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
        ${displayPrice?.toFixed(2) ?? '—'}
      </span>
      <span className={`text-[10px] font-mono ${isUp ? 'text-green-500' : 'text-red-500'}`}>
        {isUp ? '▲' : '▼'}{Math.abs(chg).toFixed(2)}%
      </span>
      {isExtended && <span className="text-[9px] text-amber-400/70">EXT</span>}
    </span>
  );
}

export default function TickerTape({ prices }) {
  const items = TAPE_TICKERS.map(t => ({ ticker: t, data: prices[t] }));
  const doubled = [...items, ...items]; // duplicate for seamless loop

  return (
    <div className="bg-[#0a0a0a] border-b border-[#1a1a1a] h-9 flex items-center overflow-hidden">
      <div className="ticker-wrap flex-1">
        <div className="ticker-inner">
          {doubled.map((item, i) => (
            <TapeItem key={`${item.ticker}-${i}`} ticker={item.ticker} data={item.data} />
          ))}
        </div>
      </div>
    </div>
  );
}
