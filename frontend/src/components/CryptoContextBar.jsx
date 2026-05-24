// Crypto-specific top-of-page context: Fear & Greed, BTC trend, BTC dominance,
// active session liquidity. Crypto's "VIX equivalent" + macro regime in one bar.

function fearGreedColor(v) {
  if (v == null) return 'border-[#2a2a2a] text-[#666] bg-[#0a0a0a]';
  if (v <= 20) return 'border-red-500/40 text-red-300 bg-red-500/10';     // Extreme Fear
  if (v <= 40) return 'border-amber-500/40 text-amber-300 bg-amber-500/10'; // Fear
  if (v <= 60) return 'border-[#2a2a2a] text-[#aaa] bg-[#0a0a0a]';         // Neutral
  if (v <= 80) return 'border-amber-500/40 text-amber-300 bg-amber-500/10'; // Greed
  return 'border-red-500/40 text-red-300 bg-red-500/10';                   // Extreme Greed
}

function btcTrendColor(t) {
  if (t === 'BULLISH') return 'border-green-500/40 text-green-300 bg-green-500/10';
  if (t === 'BEARISH') return 'border-red-500/40 text-red-300 bg-red-500/10';
  return 'border-[#2a2a2a] text-[#888] bg-[#0a0a0a]';
}

function liquidityColor(l) {
  if (l === 'HIGH')   return 'border-green-500/40 text-green-300 bg-green-500/10';
  if (l === 'MEDIUM') return 'border-amber-500/30 text-amber-300 bg-amber-500/8';
  if (l === 'LOW')    return 'border-red-500/30 text-red-300 bg-red-500/8';
  return 'border-[#2a2a2a] text-[#666] bg-[#0a0a0a]';
}

function fundingColor(tier) {
  if (tier === 'CROWDED LONGS' || tier === 'CROWDED SHORTS') return 'border-red-500/40 text-red-300 bg-red-500/10';
  if (tier === 'BULLISH')  return 'border-green-500/30 text-green-300 bg-green-500/8';
  if (tier === 'BEARISH')  return 'border-amber-500/30 text-amber-300 bg-amber-500/8';
  return 'border-[#2a2a2a] text-[#aaa] bg-[#0a0a0a]';
}

export default function CryptoContextBar({ context, btcTrend }) {
  if (!context) return null;
  const { fearGreed, global, session, funding, btcDominanceDirection, btcDominanceDelta } = context;
  const btcDArrow = btcDominanceDirection === 'RISING' ? '▲' : btcDominanceDirection === 'FALLING' ? '▼' : '·';
  const btcDColor = btcDominanceDirection === 'RISING' ? 'text-red-300'    // alts pain
                  : btcDominanceDirection === 'FALLING' ? 'text-green-300' // alt-friendly
                  : 'text-[#888]';

  return (
    <div className="mx-4 mt-3 p-3 rounded border border-[#1a1a1a] bg-[#0a0a0a]">
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-[11px] font-mono">
        {/* Fear & Greed */}
        {fearGreed && (
          <div className={`px-2.5 py-1.5 rounded border flex items-center gap-2 ${fearGreedColor(fearGreed.value)}`}>
            <span className="font-bold text-[12px]">{fearGreed.value}</span>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] opacity-70">Fear & Greed</span>
              <span className="text-[10px]">{fearGreed.interpretation}</span>
            </div>
          </div>
        )}

        {/* BTC trend */}
        {btcTrend && (
          <div className={`px-2.5 py-1.5 rounded border flex items-center gap-2 ${btcTrendColor(btcTrend)}`}>
            <span className="text-[10px] opacity-70">BTC trend</span>
            <span className="font-bold">{btcTrend}</span>
          </div>
        )}

        {/* BTC dominance + direction (rising = alts bleed, falling = rotation into alts) */}
        {global?.btcDominance != null && (
          <div className="px-2.5 py-1.5 rounded border border-[#2a2a2a] text-[#aaa] bg-[#0a0a0a] flex items-center gap-2">
            <span className="text-[10px] opacity-70">BTC.D</span>
            <span className="font-bold">{global.btcDominance.toFixed(1)}%</span>
            {btcDominanceDirection && (
              <span className={`text-[10px] font-bold ${btcDColor}`} title={`BTC.D ${btcDominanceDirection.toLowerCase()} — BTC ${btcDominanceDelta >= 0 ? 'out' : 'under'}performing market by ${Math.abs(btcDominanceDelta)}% 24h`}>
                {btcDArrow}
              </span>
            )}
            <span className="text-[9px] opacity-60">
              {global.btcDominance > 55 ? '· alts headwind' : global.btcDominance < 50 ? '· alt-friendly' : '· neutral'}
            </span>
          </div>
        )}

        {/* Perp funding rate — crowded positioning gauge */}
        {funding && (
          <div className={`px-2.5 py-1.5 rounded border flex items-center gap-2 ${fundingColor(funding.tier)}`}>
            <span className="text-[10px] opacity-70">Funding</span>
            <span className="font-bold">{(funding.marketAvg * 100).toFixed(3)}%</span>
            <span className="text-[9px] opacity-80">· {funding.tier.toLowerCase()}</span>
          </div>
        )}

        {/* Total crypto market cap 24h change */}
        {global?.marketCapChange24h != null && (
          <div className={`px-2.5 py-1.5 rounded border flex items-center gap-2 ${
            global.marketCapChange24h >= 1 ? 'border-green-500/30 text-green-300 bg-green-500/8' :
            global.marketCapChange24h <= -1 ? 'border-red-500/30 text-red-300 bg-red-500/8' :
            'border-[#2a2a2a] text-[#888] bg-[#0a0a0a]'
          }`}>
            <span className="text-[10px] opacity-70">Crypto 24h</span>
            <span className="font-bold">{global.marketCapChange24h >= 0 ? '+' : ''}{global.marketCapChange24h.toFixed(2)}%</span>
          </div>
        )}

        {/* Active session + liquidity */}
        {session && (
          <div className={`px-2.5 py-1.5 rounded border flex items-center gap-2 ${liquidityColor(session.liquidity)}`}>
            <span className="text-[10px] opacity-70">Session</span>
            <span className="font-bold">{session.activeSession}</span>
            <span className="text-[9px] opacity-80">· {session.liquidity} liquidity</span>
            {session.isWeekend && <span className="text-[9px] opacity-60">· weekend</span>}
          </div>
        )}

        {/* Advice line — full width on its own row when present */}
        {(fearGreed?.advice || session?.advice || funding?.advice) && (
          <div className="w-full text-[10px] text-[#666] leading-relaxed pt-1 border-t border-[#1a1a1a] mt-1">
            {fearGreed?.advice && <span><span className="text-[#888]">Sentiment:</span> {fearGreed.advice}</span>}
            {fearGreed?.advice && (session?.advice || funding?.advice) && <span className="text-[#222] mx-2">·</span>}
            {funding?.advice && <span><span className="text-[#888]">Funding:</span> {funding.advice}</span>}
            {funding?.advice && session?.advice && <span className="text-[#222] mx-2">·</span>}
            {session?.advice && <span><span className="text-[#888]">Session:</span> {session.advice}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
