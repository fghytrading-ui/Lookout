import { useRef } from 'react';
import Sparkline from './Sparkline.jsx';
import ShareMenu from './ShareMenu.jsx';
import { formatTradeText } from '../utils/share.js';

function ProbabilityBadge({ probability, confirming }) {
  const isHigh = probability === 'HIGH';
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border font-mono tracking-wider ${
      isHigh
        ? 'bg-green-500/15 border-green-500/40 text-green-300'
        : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
    }`}>
      {probability} PROB · {confirming} signals
    </span>
  );
}

function ConfidenceBar({ value }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  const color = pct >= 80 ? 'bg-green-400' : pct >= 65 ? 'bg-amber-400' : 'bg-orange-400';
  const label = pct >= 80 ? 'text-green-400' : pct >= 65 ? 'text-amber-400' : 'text-orange-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-[#1a1a1a] rounded overflow-hidden">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-mono font-bold ${label} tabular-nums`}>{pct}%</span>
    </div>
  );
}

function LevelBox({ label, value, pct, colorClass, rangeLow, rangeHigh }) {
  const textColor = colorClass.includes('green') ? 'text-green-400'
                  : colorClass.includes('blue')  ? 'text-blue-400'
                  : 'text-red-400';
  const subColor  = colorClass.includes('green') ? 'text-green-500/60'
                  : colorClass.includes('blue')  ? 'text-blue-500/60'
                  : 'text-red-500/60';

  // If a range is provided, display as low-high
  if (rangeLow != null && rangeHigh != null) {
    return (
      <div className={`rounded p-2.5 border ${colorClass}`}>
        <div className="text-[9px] uppercase tracking-widest text-[#555] mb-1">{label} Zone</div>
        <div className={`font-mono font-bold text-sm tabular-nums leading-tight ${textColor}`}>
          ${rangeLow.toFixed(2)}
          <span className="text-[#444] mx-1">–</span>
          ${rangeHigh.toFixed(2)}
        </div>
        <div className={`text-[10px] font-mono mt-0.5 ${subColor}`}>
          target ~${value?.toFixed(2)}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded p-2.5 border ${colorClass}`}>
      <div className="text-[9px] uppercase tracking-widest text-[#555] mb-1">{label}</div>
      <div className={`font-mono font-bold text-base tabular-nums ${textColor}`}>
        ${value?.toFixed(2) ?? '—'}
      </div>
      {pct !== undefined && (
        <div className={`text-[10px] font-mono mt-0.5 ${subColor}`}>
          {colorClass.includes('red') ? '−' : '+'}{pct}%
        </div>
      )}
    </div>
  );
}

function SignalPill({ signal }) {
  const style = {
    bullish: 'bg-green-500/10 border-green-500/25 text-green-400',
    bearish: 'bg-red-500/10 border-red-500/25 text-red-400',
    warning: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
    neutral: 'bg-[#1a1a1a] border-[#2a2a2a] text-[#777]'
  }[signal.type] || 'bg-[#1a1a1a] border-[#2a2a2a] text-[#777]';

  const icon = signal.type === 'bullish' ? '✓' : signal.type === 'warning' ? '⚠' : signal.type === 'bearish' ? '✓' : '·';

  return (
    <span className={`signal-pill border ${style}`}>
      <span>{icon}</span>
      <span>{signal.text}</span>
    </span>
  );
}

function SentimentBadge({ sentiment }) {
  if (!sentiment || sentiment.total === 0) return null;
  const score = sentiment.score;
  const cfg = score >= 70 ? { color: 'text-green-300', bg: 'bg-green-500/15', border: 'border-green-500/30', icon: '📈' }
            : score >= 55 ? { color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20', icon: '↗'  }
            : score <= 30 ? { color: 'text-red-300',   bg: 'bg-red-500/15',   border: 'border-red-500/30',   icon: '📉' }
            : score <= 45 ? { color: 'text-red-400',   bg: 'bg-red-500/10',   border: 'border-red-500/20',   icon: '↘'  }
            :               { color: 'text-[#888]',     bg: 'bg-[#1a1a1a]',    border: 'border-[#252525]',    icon: '→'  };
  return (
    <span className={`signal-pill border ${cfg.bg} ${cfg.border} ${cfg.color}`} title={`${sentiment.bull} bullish / ${sentiment.bear} bearish messages on StockTwits`}>
      <span>{cfg.icon}</span>
      <span>Social {sentiment.label} {sentiment.score}%</span>
    </span>
  );
}

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function TradeCard({ trade, type, isNew, accountSize = 10000, riskPct = 1, entryTiming, onTakeTrade }) {
  if (!trade) return null;

  // Position sizing: how many shares for `riskPct%` of `accountSize`?
  const dollarRisk = accountSize * (riskPct / 100);
  const perShareRisk = Math.abs(trade.entry - trade.sl);
  const recShares = perShareRisk > 0 ? Math.floor(dollarRisk / perShareRisk) : 0;
  const positionCost = recShares * trade.entry;
  const dollarReward = recShares * Math.abs(trade.tp - trade.entry);

  const isLong  = trade.direction === 'LONG';
  const isShort = trade.direction === 'SHORT';

  const borderColor = isLong  ? 'border-green-500/50' : isShort ? 'border-red-500/50' : 'border-amber-500/50';
  const accentBg    = isLong  ? 'bg-green-500/10'     : isShort ? 'bg-red-500/10'     : 'bg-amber-500/10';
  const accentText  = isLong  ? 'text-green-400'       : isShort ? 'text-red-400'       : 'text-amber-400';
  const dirLabel    = isLong  ? '🟢 LONG'              : '🔴 SHORT';

  const rrColor = trade.rrRatio >= 2.5 ? 'text-green-400 glow-green' : trade.rrRatio >= 2 ? 'text-amber-400' : 'text-orange-400';

  const priceFmt = (n) => (n != null ? `$${n.toFixed(2)}` : '—');
  const ts = trade.timestamp ? new Date(trade.timestamp).toLocaleTimeString('en-US', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase() + ' UK' : '—';

  // Sort signals: bullish/bearish first, warnings last
  const mainSignals = (trade.signals || []).filter(s => s.type !== 'warning' && s.type !== 'skip-short');
  const warnSignals = (trade.signals || []).filter(s => s.type === 'warning' || s.type === 'skip-short');

  const cardRef = useRef(null);

  return (
    <div ref={cardRef} className={`relative bg-[#0e0e0e] border ${borderColor} rounded-lg overflow-hidden trade-card fade-in ${
      trade.isTopPick ? 'ring-2 ring-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.3)]' :
      isNew ? 'ring-2 ring-amber-400/60' : ''
    }`}>

      {/* TOP PICK badge */}
      {trade.isTopPick && (
        <div className="absolute top-2 right-2 z-10 bg-gradient-to-r from-yellow-400 to-amber-400 text-black text-[10px] font-bold px-2 py-0.5 rounded font-mono tracking-widest shadow-lg">
          👑 TOP PICK
        </div>
      )}

      {/* NEW badge — appears only if not also TOP PICK */}
      {isNew && !trade.isTopPick && (
        <div className="absolute top-2 right-2 z-10 bg-amber-400 text-black text-[9px] font-bold px-2 py-0.5 rounded font-mono tracking-widest animate-pulse">
          ★ NEW SETUP
        </div>
      )}

      {/* Direction badge — vertical left strip */}
      <div className={`absolute left-0 top-0 bottom-0 w-7 flex items-center justify-center ${accentBg} border-r ${borderColor}`}>
        <span className={`vertical-text text-[9px] font-bold tracking-widest ${accentText}`}>
          {dirLabel}
        </span>
      </div>

      {/* Card body */}
      <div className="ml-7 p-4">

        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3 flex-wrap sm:flex-nowrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-2xl font-bold font-condensed tracking-wider">{trade.ticker}</span>
              <ProbabilityBadge probability={trade.probability} confirming={trade.confirming} />
            </div>
            <div className="text-[11px] text-[#555] mt-0.5 font-mono">
              {trade.name} &nbsp;·&nbsp; {trade.exchange} &nbsp;·&nbsp; {trade.sector}
            </div>
          </div>

          {/* Live price block */}
          <div className="text-right flex-shrink-0">
            <div className="flex items-center justify-end gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-400 live-dot flex-shrink-0" />
              <span className="font-mono font-bold text-xl tabular-nums">
                {priceFmt(trade.price)}
              </span>
              {trade.priceSession === 'pre' && (
                <span className="text-[8px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300">PRE</span>
              )}
              {trade.priceSession === 'post' && (
                <span className="text-[8px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/40 text-blue-300">POST</span>
              )}
            </div>
            <div className={`text-xs font-mono tabular-nums ${(trade.changePercent || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {(trade.changePercent || 0) >= 0 ? '+' : ''}{(trade.changePercent || 0).toFixed(2)}% today
            </div>
            <div className="flex items-center justify-end mt-1">
              <Sparkline data={trade.sparkline} direction={trade.direction} />
            </div>
            <div className="text-[9px] text-[#333] font-mono mt-0.5">
              ✓ Verified {ts}
            </div>
          </div>
        </div>

        {/* Confidence bar */}
        {trade.confidence != null && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] uppercase tracking-widest text-[#444] font-mono">
                {trade.tradeStyle === 'sameDay' ? 'Setup Confidence (1–2 session horizon)' : 'Confidence Score'}
              </span>
              <span className="text-[9px] text-[#555] font-mono">
                {trade.confidence >= 80 ? 'Very High' : trade.confidence >= 65 ? 'High' : trade.confidence >= 50 ? 'Moderate' : 'Low'}
              </span>
            </div>
            <ConfidenceBar value={trade.confidence} />
          </div>
        )}

        {/* Entry validity status — show only if not in zone */}
        {trade.entryStatus && trade.entryStatus !== 'IN_ZONE' && (
          <div className={`text-[11px] font-mono px-2.5 py-1.5 rounded mb-2 border ${
            trade.entryStatus === 'MISSED'      ? 'bg-red-500/10 border-red-500/30 text-red-300' :
            trade.entryStatus === 'BELOW_ZONE'  ? 'bg-green-500/10 border-green-500/30 text-green-300' :
                                                   'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}>
            {trade.entryStatus === 'MISSED' && '✗ '}
            {trade.entryStatus === 'BELOW_ZONE' && '✓ '}
            {trade.entryStatus === 'ABOVE_ZONE' && '⚠ '}
            {trade.entryStatusText}
          </div>
        )}

        {/* Weekly trend confirmation */}
        {trade.weeklyTrend && (
          <div className={`text-[10px] font-mono inline-flex items-center gap-1.5 px-2 py-0.5 rounded mb-2 border ${
            (trade.direction === 'LONG' && trade.weeklyTrend === 'UP') ||
            (trade.direction === 'SHORT' && trade.weeklyTrend === 'DOWN')
              ? 'bg-green-500/10 border-green-500/30 text-green-300'
              : (trade.direction === 'LONG' && trade.weeklyTrend === 'DOWN') ||
                (trade.direction === 'SHORT' && trade.weeklyTrend === 'UP')
                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : 'bg-[#1a1a1a] border-[#252525] text-[#777]'
          }`}>
            📊 Weekly trend: <b>{trade.weeklyTrend}</b>
            {((trade.direction === 'LONG' && trade.weeklyTrend === 'UP') ||
              (trade.direction === 'SHORT' && trade.weeklyTrend === 'DOWN')) && ' ✓ aligned'}
          </div>
        )}

        {/* Volume context badge */}
        {trade.volRatio && trade.volRatio > 1.3 && (
          <div className="text-[10px] font-mono inline-flex items-center gap-1.5 px-2 py-0.5 rounded mb-2 border bg-cyan-500/10 border-cyan-500/30 text-cyan-300">
            📊 Volume {trade.volRatio.toFixed(1)}× average {trade.volRatio > 2 ? '— major participation' : '— above normal'}
          </div>
        )}

        {/* Levels grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <LevelBox label="Entry" value={trade.entry} rangeLow={trade.entryLow} rangeHigh={trade.entryHigh} colorClass="bg-green-500/8 border-green-500/20" />
          <LevelBox label="TP1 — Safe" value={trade.tp}  pct={trade.tpPct}  colorClass="bg-blue-500/8 border-blue-500/20" />
          {trade.tp2 != null && (
            <LevelBox label="TP2 — Extended" value={trade.tp2} pct={trade.tp2Pct} colorClass="bg-cyan-500/8 border-cyan-500/30" />
          )}
          <LevelBox label="Stop Loss" value={trade.sl} pct={trade.slPct} colorClass="bg-red-500/8 border-red-500/20" />
        </div>

        {/* TP scaling hint */}
        {trade.tp2 != null && (
          <div className="text-[10px] text-[#666] font-mono mb-2 italic">
            💡 Scale out: take 50–70% at <span className="text-blue-400">TP1</span> ({trade.rrRatio}:1), let runners go to <span className="text-cyan-400">TP2</span> ({trade.rrRatio2}:1)
          </div>
        )}

        {/* Intraday timing block — renders for sameDay (stocks) AND crypto with mode-specific copy */}
        {(trade.tradeStyle === 'sameDay' || trade.tradeStyle === 'crypto') && trade.intradayTiming && (
          <div className={`rounded-lg p-3 mb-3 border ${
            trade.tradeStyle === 'crypto' ? 'bg-purple-500/10 border-purple-500/40' : 'bg-amber-500/10 border-amber-500/40'
          }`}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
              <span className={`text-[11px] font-mono font-bold tracking-wider ${
                trade.tradeStyle === 'crypto' ? 'text-purple-300' : 'text-amber-300'
              }`}>
                {trade.tradeStyle === 'crypto' ? '₿ CRYPTO — 24/7 MARKET' : '⏰ SHORT-TERM — 1 TO 2 SESSIONS'}
              </span>
              <span className={`text-[9px] font-mono ${
                trade.tradeStyle === 'crypto' ? 'text-purple-400/70' : 'text-amber-400/70'
              }`}>
                {trade.tradeStyle === 'crypto' ? 'No bell — close within 1–3 sessions' : 'May hold overnight — size accordingly'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] font-mono">
              <div className="bg-green-500/10 border border-green-500/25 rounded p-2">
                <div className="text-[9px] uppercase tracking-widest text-green-500/70 mb-1">
                  {trade.tradeStyle === 'crypto' ? '✓ Peak Liquidity' : '✓ Enter Between'}
                </div>
                <div className="text-green-300 font-bold tabular-nums">{trade.intradayTiming.entryFrom}{trade.intradayTiming.entryUntil ? ` – ${trade.intradayTiming.entryUntil}` : ''}</div>
                <div className="text-[9px] text-green-500/60 mt-0.5">Best: {trade.intradayTiming.bestEntryWindow}</div>
              </div>
              <div className="bg-cyan-500/10 border border-cyan-500/25 rounded p-2">
                <div className="text-[9px] uppercase tracking-widest text-cyan-500/70 mb-1">⏱ Typical Hold</div>
                <div className="text-cyan-300 font-bold tabular-nums">
                  {trade.expectedHours ? `~${trade.expectedHours} hours` : (trade.tradeStyle === 'crypto' ? 'Next active session' : 'Same session')}
                </div>
                <div className="text-[9px] text-cyan-500/60 mt-0.5">to reach TP1</div>
              </div>
              <div className="bg-red-500/10 border border-red-500/25 rounded p-2">
                <div className="text-[9px] uppercase tracking-widest text-red-500/70 mb-1">
                  {trade.tradeStyle === 'crypto' ? '⚠ Soft Deadline' : '⚠ Exit Horizon'}
                </div>
                <div className="text-red-300 font-bold tabular-nums">{trade.intradayTiming.mustExitBy}</div>
                <div className="text-[9px] text-red-500/60 mt-0.5">Avoid: {trade.intradayTiming.avoidWindow}</div>
              </div>
            </div>
            {trade.tradeStyle === 'crypto' && (
              <div className="text-[9px] text-purple-400/60 mt-2 leading-relaxed">
                Why these times: 13:30–20:00 UK = US/EU overlap, tightest spreads. 14:30 UK = NY equity open, where ETF flows + CME futures drive ~70% of major intraday moves.
              </div>
            )}
          </div>
        )}

        {/* VWAP — intraday bias level (crypto only). Pros use this as magnet + bias filter. */}
        {trade.tradeStyle === 'crypto' && trade.vwap && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded border bg-[#0a0a0a] border-[#1a1a1a] text-[11px] font-mono">
            <span className="text-[#666] text-[10px] uppercase tracking-widest">VWAP</span>
            <span className="text-cyan-300 font-bold tabular-nums">${trade.vwap.vwap}</span>
            <span className={`text-[10px] ${
              Math.abs(trade.vwap.distancePct) < 1 ? 'text-[#888]' :
              trade.vwap.side === 'ABOVE' ? 'text-green-400' : 'text-red-400'
            }`}>
              · price {trade.vwap.distancePct >= 0 ? '+' : ''}{trade.vwap.distancePct}% ({trade.vwap.side})
            </span>
            <span className="text-[9px] text-[#444] ml-auto">session = UTC day</span>
          </div>
        )}

        {/* Swing time row (only for swing-style trades) */}
        {trade.tradeStyle !== 'sameDay' && trade.tradeStyle !== 'crypto' && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3 text-[11px] font-mono">
            <div>
              <span className="text-[#3a3a3a]">Hold: </span>
              <span className="text-[#aaa]">{trade.timeSpan}</span>
            </div>
            <div>
              <span className="text-[#3a3a3a]">Target exit: </span>
              <span className="text-[#aaa]">{trade.exitWindow}</span>
            </div>
            {trade.expectedDays && (
              <div>
                <span className="text-[#3a3a3a]">Realistic reach: </span>
                <span className="text-cyan-400/80">~{trade.expectedDays} day{trade.expectedDays !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        )}

        {/* Confirmation candle — has today's bar confirmed the direction? */}
        {trade.confirmation && (
          <div className={`text-[11px] font-mono px-2.5 py-1.5 rounded mb-2 border flex items-center gap-2 ${
            !trade.confirmation.confirmed       ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
            trade.confirmation.type?.includes('strong') ? 'bg-green-500/10 border-green-500/30 text-green-300' :
                                                  'bg-blue-500/10 border-blue-500/30 text-blue-300'
          }`}>
            <span>{trade.confirmation.confirmed ? '✓' : '⏳'}</span>
            <span>{trade.confirmation.confirmed ? 'Candle confirms direction' : 'Waiting for confirming candle'}</span>
            <span className="opacity-70 ml-auto">— {trade.confirmation.reasoning}</span>
          </div>
        )}

        {/* Setup type tag — WHAT KIND of swing trade this is */}
        {trade.setupType && (
          <div className="bg-[#0a0a0a] border border-cyan-500/20 rounded p-2.5 mb-2">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
              <span className="text-[12px] font-mono font-bold text-cyan-300">{trade.setupType.label}</span>
              <span className="text-[9px] font-mono text-[#666]">
                Historical win rate: <span className={`font-bold ${
                  trade.setupType.historicalWinRate >= 60 ? 'text-green-400' :
                  trade.setupType.historicalWinRate >= 50 ? 'text-amber-400' : 'text-orange-400'
                }`}>{trade.setupType.historicalWinRate}%</span>
                <span className="text-[#444] ml-1">· {trade.setupType.idealHold}</span>
              </span>
            </div>
            <p className="text-[10px] text-[#888] font-mono leading-snug">{trade.setupType.description}</p>
            {/* EXPECTANCY — the number that decides whether this trade makes
                money if repeated: (winRate x R:R) - (1 - winRate), in R. */}
            {trade.expectancy != null && (
              <div className={`text-[10px] font-mono mt-2 pt-2 border-t border-[#1a1a1a] flex items-center gap-2 flex-wrap ${
                trade.expectancy > 0 ? 'text-green-400/90' : 'text-red-400/90'
              }`}>
                <span className="text-[#888]">📐 Expectancy:</span>
                <span className="font-bold">
                  {trade.expectancy > 0 ? '+' : ''}{trade.expectancy}R per trade
                </span>
                <span className="text-[#555]">
                  · needs R:R ≥ {trade.breakEvenRR} to break even · this trade is {trade.rrRatio}
                </span>
                {trade.expectancy <= 0 && (
                  <span className="px-1.5 py-0.5 rounded border border-red-500/40 text-red-400">
                    ⚠ loses money if repeated
                  </span>
                )}
              </div>
            )}

            {/* LIVE historical performance from auto-tracked outcomes */}
            {trade.historicalStats && (
              <div className="text-[10px] font-mono text-[#666] mt-2 pt-2 border-t border-[#1a1a1a] flex items-center gap-2 flex-wrap">
                <span className="text-[#888]">📊 This system's record on {trade.setupType.label}:</span>
                <span className={`font-bold ${
                  trade.historicalStats.winRate >= 0.6 ? 'text-green-400' :
                  trade.historicalStats.winRate >= 0.5 ? 'text-amber-400' :
                  trade.historicalStats.winRate >= 0.4 ? 'text-orange-400' : 'text-red-400'
                }`}>
                  {(trade.historicalStats.winRate * 100).toFixed(0)}% wins
                </span>
                <span>(n={trade.historicalStats.sampleSize}, last 60d)</span>
                {trade.confidenceAdjustment != null && trade.confidenceAdjustment !== 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                    trade.confidenceAdjustment > 0 ? 'border-green-500/30 text-green-400' : 'border-red-500/30 text-red-400'
                  }`} title="Confidence auto-adjusted based on this setup's historical win rate">
                    confidence {trade.confidenceAdjustment > 0 ? '+' : ''}{trade.confidenceAdjustment}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Inventory release warning (energy products only) */}
        {trade.inventoryRelease && trade.inventoryRelease.hoursUntil <= 36 && trade.inventoryRelease.hoursUntil >= -2 && (
          <div className={`text-[11px] font-mono px-2.5 py-1.5 rounded mb-2 border flex items-center gap-2 ${
            trade.inventoryRelease.hoursUntil <= 2
              ? 'bg-red-500/10 border-red-500/30 text-red-300 warn-pulse'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}>
            <span>⚡</span>
            <span>
              {trade.inventoryRelease.title} in {trade.inventoryRelease.hoursUntil.toFixed(1)}h
              {trade.inventoryRelease.hoursUntil <= 2 ? ' — do NOT hold through release' : ' — clear position before release'}
              {trade.inventoryRelease.forecast && <span className="opacity-70 ml-1">· consensus {trade.inventoryRelease.forecast}</span>}
            </span>
          </div>
        )}

        {/* Earnings risk warning */}
        {trade.earnings && trade.earnings.status !== 'OK' && (
          <div className={`text-[11px] font-mono px-2.5 py-1.5 rounded mb-2 border flex items-center gap-2 ${
            trade.earnings.status === 'BLOCK'
              ? 'bg-red-500/10 border-red-500/30 text-red-300 warn-pulse'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}>
            <span>📅</span>
            <span>
              Earnings in {trade.earnings.daysAway} day{trade.earnings.daysAway === 1 ? '' : 's'} —
              {trade.earnings.status === 'BLOCK' ? ' do NOT hold through report' : ' clear position before report'}
            </span>
          </div>
        )}

        {/* Smart entry timing — replaces "ENTER NOW" when market is closed */}
        {entryTiming && (
          <div className={`rounded p-2.5 mb-3 border ${
            entryTiming.urgency === 'now'  ? 'bg-green-500/10 border-green-500/30' :
            entryTiming.urgency === 'soon' ? 'bg-amber-500/10 border-amber-500/30' :
                                              'bg-blue-500/10 border-blue-500/30'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <div className={`text-[9px] uppercase tracking-widest font-mono mb-0.5 ${
                  entryTiming.urgency === 'now'  ? 'text-green-400' :
                  entryTiming.urgency === 'soon' ? 'text-amber-400' :
                                                    'text-blue-400'
                }`}>When to Enter</div>
                <div className={`font-bold text-sm font-mono ${
                  entryTiming.urgency === 'now'  ? 'text-green-300' :
                  entryTiming.urgency === 'soon' ? 'text-amber-300' :
                                                    'text-blue-300'
                }`}>
                  {entryTiming.urgency === 'now' && '⚡ '}{entryTiming.label}
                </div>
              </div>
              <div className="text-[10px] text-[#666] font-mono text-right max-w-[60%]">
                {entryTiming.detail}
              </div>
            </div>
          </div>
        )}

        {/* Signals + Sentiment Badge */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <SentimentBadge sentiment={trade.sentiment} />
          {mainSignals.map((s, i) => <SignalPill key={i} signal={s} />)}
          {warnSignals.map((s, i) => <SignalPill key={`w${i}`} signal={s} />)}
        </div>

        {/* News headlines */}
        {trade.news?.length > 0 && (
          <div className="bg-[#0a0a0a] rounded border border-[#181818] p-2.5 mb-3">
            <div className="text-[9px] text-[#444] uppercase tracking-widest font-mono mb-1.5">📰 Latest News</div>
            <ul className="space-y-1">
              {trade.news.slice(0, 3).map((n, i) => (
                <li key={i} className="text-[11px] leading-snug">
                  <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-[#aaa] hover:text-cyan-400 transition-colors">
                    {n.title}
                  </a>
                  <span className="text-[9px] text-[#444] ml-1.5 font-mono">— {n.publisher} · {timeAgo(n.time)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Position sizing — based on user's account & risk % */}
        {recShares > 0 && (
          <div className="bg-[#0a0a0a] rounded border border-cyan-500/15 p-2.5 mb-3 flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-[9px] uppercase tracking-widest text-cyan-500/50 font-mono mb-0.5">
                Position Size (risk {riskPct}% of ${accountSize.toLocaleString()})
              </div>
              <div className="font-mono text-sm text-cyan-300 tabular-nums">
                <span className="font-bold">{recShares.toLocaleString()}</span> shares
                <span className="text-[#555] mx-1.5">·</span>
                <span className="text-[#888]">${positionCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} capital</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono text-red-400/80">Risk: −${dollarRisk.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              <div className="text-[10px] font-mono text-green-400">Reward: +${dollarReward.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
          </div>
        )}

        {/* Second-opinion REVIEWER VERDICT */}
        {trade.review && (
          <div className={`rounded p-2.5 mb-3 border ${
            trade.review.verdict === 'PASS'    ? 'bg-green-500/8 border-green-500/30' :
            trade.review.verdict === 'CAUTION' ? 'bg-amber-500/10 border-amber-500/30' :
                                                  'bg-red-500/10 border-red-500/30'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[9px] font-bold uppercase tracking-widest font-mono px-1.5 py-0.5 rounded ${
                trade.review.verdict === 'PASS'    ? 'bg-green-500/20 text-green-300' :
                trade.review.verdict === 'CAUTION' ? 'bg-amber-500/20 text-amber-300' :
                                                      'bg-red-500/20 text-red-300'
              }`}>
                {trade.review.verdict === 'PASS' ? '✓ REVIEWED · PASS'
                 : trade.review.verdict === 'CAUTION' ? '⚠ REVIEWED · CAUTION'
                 : '✗ REVIEWED · AVOID'}
              </span>
            </div>
            <div className={`text-[11px] font-mono leading-snug ${
              trade.review.verdict === 'PASS'    ? 'text-green-200/80' :
              trade.review.verdict === 'CAUTION' ? 'text-amber-200/80' :
                                                    'text-red-200/80'
            }`}>{trade.review.summary}</div>
            {trade.review.issues?.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {trade.review.issues.slice(0, 3).map((iss, i) => (
                  <li key={i} className={`text-[10px] font-mono ${
                    iss.severity === 'reject' ? 'text-red-400/80' : 'text-amber-400/80'
                  }`}>
                    • {iss.text}
                  </li>
                ))}
              </ul>
            )}
            {trade.review.strengths?.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {trade.review.strengths.slice(0, 2).map((s, i) => (
                  <li key={i} className="text-[10px] font-mono text-green-400/80">+ {s}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Analyst notes */}
        <div className="bg-[#0a0a0a] rounded border border-[#181818] p-3 mb-3">
          <div className="text-[9px] text-[#333] uppercase tracking-widest mb-1.5 font-mono">Analyst Assessment</div>
          {(trade.analystNotes || []).map((note, i) => (
            <p key={i} className="text-[11px] text-[#666] font-mono leading-relaxed mb-1 last:mb-0">{note}</p>
          ))}
        </div>

        {/* TAKE THIS TRADE button — only shows if not MISSED */}
        {trade.entryStatus !== 'MISSED' && recShares > 0 && onTakeTrade && (
          <button
            onClick={() => onTakeTrade({
              ticker: trade.ticker,
              direction: trade.direction,
              entry: trade.entry,
              shares: recShares,
              tp: trade.tp,
              sl: trade.sl
            })}
            className={`w-full py-2 text-[11px] font-mono font-bold tracking-wider rounded transition-all mb-3 border ${
              trade.direction === 'LONG'
                ? 'bg-green-500/15 hover:bg-green-500/25 border-green-500/40 text-green-300'
                : 'bg-red-500/15 hover:bg-red-500/25 border-red-500/40 text-red-300'
            }`}
          >
            ↗ TAKE THIS TRADE — Add to Position Tracker
          </button>
        )}

        {/* Footer row */}
        <div className="flex items-center justify-between pt-2 border-t border-[#181818]">
          <div className="flex items-center gap-3">
            <span className={`font-mono font-bold text-sm tabular-nums ${rrColor}`}>
              R:R {trade.rrRatio} : 1
            </span>
            {trade.rsi && (
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                trade.rsi < 35 ? 'bg-green-500/10 text-green-400' :
                trade.rsi > 65 ? 'bg-red-500/10 text-red-400' :
                'bg-[#1a1a1a] text-[#555]'
              }`}>
                RSI {trade.rsi}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ShareMenu
              trade={trade}
              entryTiming={entryTiming?.label}
              filename={`${trade.ticker}-${trade.direction}-lookout.png`}
              textFormatter={() => formatTradeText(trade, { entryTiming: entryTiming?.label })}
            />
            {type === 'bounce' && (
              <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/25 px-2 py-0.5 rounded font-mono tracking-wider">
                WAIT FOR BOUNCE
              </span>
            )}
            {type === 'carry' && (
              <span className="text-[9px] bg-[#1a1a1a] text-[#555] border border-[#252525] px-2 py-0.5 rounded font-mono tracking-wider">
                CARRY FORWARD
              </span>
            )}
            {type === 'enter' && (
              <span className={`text-[9px] px-2 py-0.5 rounded font-mono tracking-wider border ${
                entryTiming?.urgency === 'now'
                  ? 'bg-green-500/10 text-green-400 border-green-500/25 animate-pulse'
                  : 'bg-blue-500/10 text-blue-400 border-blue-500/25'
              }`}>
                {entryTiming?.urgency === 'now' ? 'ENTER NOW' : (trade.tradeStyle === 'crypto' ? 'AT NEXT PEAK' : 'AT NEXT OPEN')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
