import { useRef, useState } from 'react';
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

export default function TradeCard({ trade, type, isNew, accountSize = 10000, riskPct = 1, entryTiming: boardTiming, onTakeTrade }) {
  // A card can carry its own session — the commodity board mixes CME futures
  // with US-listed ETFs, and they do not keep the same hours.
  const entryTiming = trade.entryTiming || boardTiming;
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

  // Cards open collapsed. A full card runs to roughly forty rows, so a phone
  // showed barely one at a time and comparing setups meant scrolling past
  // everything in between. The summary below carries what is needed to judge
  // and rank a trade at a glance; the full detail is one tap away and is
  // unchanged.
  const [expanded, setExpanded] = useState(false);

  const entryPct = trade.entry && trade.price
    ? ((trade.entry - trade.price) / trade.price) * 100
    : null;

  return (
    <div ref={cardRef} className={`relative bg-[#0e0e0e] border ${borderColor} rounded-lg overflow-hidden trade-card fade-in ${
      trade.isTopPick ? 'ring-2 ring-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.3)]' :
      isNew ? 'ring-2 ring-amber-400/60' : ''
    }`}>

      {/* TOP PICK badge */}
      {trade.isTopPick && (
        <div className="ml-7 px-4 pt-2 -mb-1">
          <span className="inline-block bg-gradient-to-r from-yellow-400 to-amber-400 text-black text-[9px] font-bold px-2 py-0.5 rounded font-mono tracking-widest shadow">
            👑 TOP PICK
          </span>
        </div>
      )}

      {/* NEW badge — appears only if not also TOP PICK */}
      {isNew && !trade.isTopPick && (
        <div className="ml-7 px-4 pt-2 -mb-1">
          <span className="inline-block bg-amber-400 text-black text-[9px] font-bold px-2 py-0.5 rounded font-mono tracking-widest animate-pulse">
            ★ NEW SETUP
          </span>
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

        {/* ── COMPACT SUMMARY — always visible, tap to expand ───────────── */}
        <button
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="w-full text-left group"
        >
          {/* Line 1 — who, how strong, live price */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-xl font-bold font-condensed tracking-wider">{trade.ticker}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border font-mono tracking-wider ${
                trade.probability === 'HIGH'
                  ? 'bg-green-500/15 border-green-500/40 text-green-300'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              }`}>{trade.probability}</span>
              <span className={`text-[11px] font-mono font-bold ${
                trade.confidence >= 80 ? 'text-green-400'
                : trade.confidence >= 65 ? 'text-amber-400' : 'text-orange-400'
              }`}>{trade.confidence}%</span>
              <span className={`text-[11px] font-mono font-bold ${rrColor}`}>{trade.rrRatio}:1</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 live-dot" />
              <span className="font-mono font-bold text-base tabular-nums">{priceFmt(trade.price)}</span>
              <span className={`text-[11px] font-mono tabular-nums ${
                trade.changePercent >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {trade.changePercent >= 0 ? '+' : ''}{trade.changePercent?.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Line 2 — the numbers you actually trade from */}
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5 text-[11px] font-mono">
            <span className="text-[#666]">Entry <span className="text-[#ddd]">{priceFmt(trade.entry)}</span></span>
            <span className="text-[#2a2a2a]">|</span>
            <span className="text-[#666]">1st <span className="text-green-400">{priceFmt(trade.tp0)}</span></span>
            <span className="text-[#666]">TP <span className="text-blue-400">{priceFmt(trade.tp)}</span></span>
            <span className="text-[#666]">SL <span className="text-red-400">{priceFmt(trade.sl)}</span></span>
            {/* How long this is expected to tie up the money. Grey text at the
                end of a row of prices was easy to miss, and on a tool meant for
                one to three sessions the hold is not a footnote. */}
            {trade.expectedDays > 0 ? (
              <>
                <span className="text-[#2a2a2a]">|</span>
                <span className={`px-1.5 py-0.5 rounded border font-semibold ${
                  trade.expectedDays <= 2 ? 'border-green-500/30 text-green-400 bg-green-500/5'
                  : trade.expectedDays <= 3 ? 'border-blue-500/30 text-blue-300 bg-blue-500/5'
                  : 'border-amber-500/30 text-amber-300 bg-amber-500/5'
                }`}>
                  {trade.expectedDays} session{trade.expectedDays === 1 ? '' : 's'}
                </span>
              </>
            ) : trade.timeSpan && (
              <>
                <span className="text-[#2a2a2a]">|</span>
                <span className="text-[#555]">{trade.timeSpan.replace('Short-term — ', '')}</span>
              </>
            )}
          </div>

          {/* Line 3 — the single most important reason, plus flags */}
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            {trade.primaryCatalyst ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-cyan-500/30 text-cyan-300 bg-cyan-500/5">
                ⚡ {trade.primaryCatalyst.label} · {trade.primaryCatalyst.age}
              </span>
            ) : trade.thesis?.quality === 'technical' ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#252525] text-[#777]">
                📐 Technical setup
              </span>
            ) : null}
            {trade.review?.verdict && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                trade.review.verdict === 'PASS'
                  ? 'border-green-500/30 text-green-400'
                  : 'border-amber-500/30 text-amber-400'
              }`}>{trade.review.verdict}</span>
            )}
            {trade.eventTimeline?.warning && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300">
                ⚠ event due
              </span>
            )}
            {trade.earnings && trade.earnings.status !== 'OK' && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-red-500/40 text-red-300">
                📅 earnings
              </span>
            )}
            <span className="ml-auto text-[10px] font-mono text-[#555] group-hover:text-cyan-400 flex items-center gap-1">
              {expanded ? 'Less' : 'Full detail'}
              <span className={`inline-block transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
            </span>
          </div>
        </button>

        {/* ── FULL DETAIL — unchanged, revealed on tap ──────────────────── */}
        {expanded && (
        <div className="mt-4 pt-4 border-t border-[#1a1a1a]">

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
        {/* A line here used to advise taking "50-70% at TP1", left over from an
            older exit strategy. The exit plan further down — and the scalePlan
            the backend actually computes — say thirds. Two different position
            sizes on the same card is a real cost, not a cosmetic one: acting on
            the wrong one sells twice what was intended at the first target.
            The thirds plan is the live one, so this line is gone. */}

        {/* Intraday timing block — renders for sameDay (stocks) AND crypto with mode-specific copy */}
        {(trade.tradeStyle === 'sameDay' || trade.tradeStyle === 'crypto') && trade.intradayTiming && (
          <div className={`rounded-lg p-3 mb-3 border ${
            trade.tradeStyle === 'crypto' ? 'bg-purple-500/10 border-purple-500/40' : 'bg-amber-500/10 border-amber-500/40'
          }`}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
              <span className={`text-[11px] font-mono font-bold tracking-wider ${
                trade.tradeStyle === 'crypto' ? 'text-purple-300' : 'text-amber-300'
              }`}>
                {trade.tradeStyle === 'crypto' ? '₿ CRYPTO — 24/7 MARKET' : `⏰ ${(trade.timeSpan || 'SHORT-TERM').toUpperCase()}`}
              </span>
              <span className={`text-[9px] font-mono ${
                trade.tradeStyle === 'crypto' ? 'text-purple-400/70' : 'text-amber-400/70'
              }`}>
                {trade.tradeStyle === 'crypto' ? 'No bell — close within 1–3 sessions' : 'Holds overnight — size accordingly'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] font-mono">
              <div className="bg-green-500/10 border border-green-500/25 rounded p-2">
                <div className="text-[9px] uppercase tracking-widest text-green-500/70 mb-1">
                  {trade.tradeStyle === 'crypto' ? '✓ Peak Liquidity' : '✓ Enter Between'}
                </div>
                <div className="text-green-300 font-bold tabular-nums">{trade.intradayTiming.entryFrom}{trade.intradayTiming.entryUntil ? ` – ${trade.intradayTiming.entryUntil}` : ''}</div>
                <div className="text-[9px] text-green-500/60 mt-0.5">Best: {trade.intradayTiming.bestEntryWindow}</div>
                {/* A scheduled event inside the window changes when to enter,
                    so it belongs next to the times rather than further down. */}
                {trade.intradayTiming.eventNote && (
                  <div className="text-[9px] text-amber-300/90 mt-1 leading-snug">
                    ⚠ {trade.intradayTiming.eventNote}
                  </div>
                )}
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
              {/* The old "Historical win rate: 60%" here was a constant typed
                  into setupClassifier.js — the same figure for every ticker,
                  never measured. It sat directly above this system's REAL
                  tracked record for the same pattern (14% over 90 trades), so
                  the card asserted two different win rates at once. Only the
                  measured one, rendered below, is shown now. */}
              <span className="text-[9px] font-mono text-[#444]">
                {trade.setupType.idealHold}
              </span>
            </div>
            <p className="text-[10px] text-[#888] font-mono leading-snug">{trade.setupType.description}</p>
            {trade.needsOneSession && (
              <div className="text-[10px] font-mono mt-2 pt-2 border-t border-[#1a1a1a] text-amber-400/90 leading-snug">
                ⏳ First session for this setup — not actionable yet.
                <span className="text-[#666]">
                  {' '}Entering the session straight after a signal returned −0.116R across 288 tracked
                  trades; waiting one more session returned +0.136R on the very same trades. If it is
                  still here next session, it is tradeable then, at that session's prices.
                </span>
              </div>
            )}

            {trade.trend5d != null && (
              <div className="text-[10px] font-mono mt-2 pt-2 border-t border-[#1a1a1a] flex items-center gap-2 flex-wrap">
                <span className="text-[#888]">📈 Last 5 sessions:</span>
                <span className={
                  (trade.direction === 'SHORT' ? -trade.trend5d : trade.trend5d) >= 2 ? 'text-green-400 font-bold'
                  : (trade.direction === 'SHORT' ? -trade.trend5d : trade.trend5d) >= 0 ? 'text-amber-400'
                  : 'text-red-400'
                }>
                  {trade.trend5d > 0 ? '+' : ''}{trade.trend5d}%
                  {' '}({(trade.direction === 'SHORT' ? -trade.trend5d : trade.trend5d) >= 0 ? 'with' : 'against'} this trade)
                </span>
                <span className="text-[#555]">
                  · setups already moving this way returned +0.23R against −0.35R for those moving against
                </span>
              </div>
            )}

            {/* EXPECTANCY — the number that decides whether this trade makes
                money if repeated, in R. Measured from what this setup's tracked
                trades actually returned, including the ones that banked the
                first scale and the ones that ran their horizon out in profit. */}
            {trade.expectancy != null && (
              <div className={`text-[10px] font-mono mt-2 pt-2 border-t border-[#1a1a1a] flex items-center gap-2 flex-wrap ${
                trade.expectancy > 0 ? 'text-green-400/90' : 'text-red-400/90'
              }`}>
                <span className="text-[#888]">📐 Expectancy:</span>
                <span className="font-bold">
                  {trade.expectancy > 0 ? '+' : ''}{trade.expectancy}R per trade
                </span>
                <span className="text-[#555]">
                  {trade.breakEvenRR != null
                    ? `· needs R:R ≥ ${trade.breakEvenRR} to break even · this trade is ${trade.rrRatio}`
                    : `· not enough tracked history to place a breakeven yet`}
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
                {/* The share that FINISHED IN PROFIT, not the share that
                    reached the far target. Showing the latter put "21% wins"
                    in red on a setup whose trades came out green 59% of the
                    time and made money overall — the same wrong number that
                    was quarantining it in the scanner. */}
                <span className={`font-bold ${
                  trade.historicalStats.greenRate >= 0.6 ? 'text-green-400' :
                  trade.historicalStats.greenRate >= 0.5 ? 'text-amber-400' :
                  trade.historicalStats.greenRate >= 0.4 ? 'text-orange-400' : 'text-red-400'
                }`}>
                  {((trade.historicalStats.greenRate ?? trade.historicalStats.winRate) * 100).toFixed(0)}% finished green
                </span>
                <span className="text-[#555]">
                  ({(trade.historicalStats.winRate * 100).toFixed(0)}% ran all the way to target)
                </span>
                <span>(n={trade.historicalStats.sampleSize}, last 60d)</span>
                {trade.confidenceAdjustment != null && trade.confidenceAdjustment !== 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                    trade.confidenceAdjustment > 0 ? 'border-green-500/30 text-green-400' : 'border-red-500/30 text-red-400'
                  }`} title="Confidence auto-adjusted from the share of this setup's tracked trades that finished in profit">
                    confidence {trade.confidenceAdjustment > 0 ? '+' : ''}{trade.confidenceAdjustment}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── EXIT PLAN ────────────────────────────────────────────────
            Three-stage scale. Only 28% of tracked trades reached the full
            target, but 70% travelled at least 30% of the way — banking a
            third there and moving the stop to breakeven turns most of that
            70% into a green trade instead of a red one. */}
        {trade.tp0 && (
          <div className="rounded-lg p-3 mb-3 border border-green-500/30 bg-green-500/5">
            <div className="text-[9px] uppercase tracking-widest text-green-400/70 font-mono mb-2">
              🎯 Exit plan — scale out in thirds
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
              <div className="bg-[#0a0a0a] border border-green-500/30 rounded p-2">
                <div className="text-[9px] text-green-500/70 mb-0.5">1 · TAKE 33%</div>
                <div className="text-green-300 font-bold tabular-nums">${trade.tp0}</div>
                <div className="text-[9px] text-[#666] mt-0.5">
                  +{Math.abs((trade.tp0 - trade.entry) / trade.entry * 100).toFixed(1)}% · then stop to breakeven
                </div>
              </div>
              <div className="bg-[#0a0a0a] border border-[#252525] rounded p-2">
                <div className="text-[9px] text-[#666] mb-0.5">2 · TAKE 33%</div>
                <div className="text-blue-300 font-bold tabular-nums">${trade.tp}</div>
                <div className="text-[9px] text-[#666] mt-0.5">+{trade.tpPct}% · {trade.rrRatio}:1</div>
              </div>
              <div className="bg-[#0a0a0a] border border-[#252525] rounded p-2">
                <div className="text-[9px] text-[#666] mb-0.5">3 · RUNNER 34%</div>
                <div className="text-cyan-300 font-bold tabular-nums">${trade.tp2}</div>
                <div className="text-[9px] text-[#666] mt-0.5">+{trade.tp2Pct}% · {trade.rrRatio2}:1</div>
              </div>
            </div>
            <p className="text-[10px] text-[#777] font-mono mt-2 leading-snug">
              Once step 1 fills, move the stop to your entry. From that point the trade
              cannot lose — worst case is a small profit.
            </p>
          </div>
        )}

        {/* ── WHY THIS TRADE ───────────────────────────────────────────
            The reason the setup exists, stated up front. A scanner that
            lists patterns without a driver is just noise. */}
        {trade.thesis && (
          <div className={`rounded-lg p-3 mb-3 border ${
            trade.thesis.quality === 'catalyst-driven' ? 'bg-cyan-500/10 border-cyan-500/40' :
            trade.thesis.quality === 'technical'       ? 'bg-[#0a0a0a] border-[#252525]' :
                                                          'bg-red-500/10 border-red-500/30'
          }`}>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[9px] uppercase tracking-widest font-mono text-[#666]">Why this trade</span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                trade.thesis.quality === 'catalyst-driven' ? 'border-cyan-500/40 text-cyan-300' :
                trade.thesis.quality === 'technical'       ? 'border-[#333] text-[#888]' :
                                                              'border-red-500/40 text-red-300'
              }`}>
                {trade.thesis.quality === 'catalyst-driven' ? '⚡ NEWS CATALYST'
                 : trade.thesis.quality === 'technical' ? '📐 TECHNICAL ONLY'
                 : '⚠ NO CLEAR REASON'}
              </span>
              {trade.catalystBreaking && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-amber-500/50 text-amber-300 warn-pulse">
                  🔴 BREAKING
                </span>
              )}
            </div>
            <p className={`text-[12px] font-mono leading-snug ${
              trade.thesis.tradeable ? 'text-[#ddd]' : 'text-red-300'
            }`}>
              {trade.thesis.headline}
            </p>
            {trade.thesis.drivers?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {trade.thesis.drivers.map((d, i) => (
                  <span key={i} className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                    d.kind === 'catalyst' ? 'border-cyan-500/30 text-cyan-300 bg-cyan-500/5'
                                          : 'border-[#242424] text-[#777]'
                  }`}>{d.text}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upcoming scheduled events landing inside the holding window */}
        {trade.eventTimeline?.events?.length > 0 && (
          <div className={`rounded p-2.5 mb-2 border ${
            trade.eventTimeline.warning
              ? 'bg-amber-500/10 border-amber-500/40'
              : 'bg-[#0a0a0a] border-[#1a1a1a]'
          }`}>
            <div className="text-[9px] uppercase tracking-widest text-[#666] font-mono mb-1.5">
              📅 Coming up during this trade
            </div>
            <div className="flex flex-wrap gap-1.5">
              {trade.eventTimeline.events.map((e, i) => (
                <span key={i} className={`text-[10px] font-mono px-2 py-1 rounded border ${
                  e.critical      ? 'border-red-500/40 text-red-300 bg-red-500/10' :
                  e.impact >= 8   ? 'border-amber-500/40 text-amber-300' :
                                     'border-[#252525] text-[#888]'
                }`}>
                  {e.label} <span className="opacity-70">{e.when}</span>
                  {e.forecast && <span className="opacity-50"> · est {e.forecast}</span>}
                </span>
              ))}
            </div>
            {trade.eventTimeline.warning && (
              <p className="text-[10px] text-amber-300/90 font-mono mt-2 leading-snug">
                ⚠ {trade.eventTimeline.warning}
              </p>
            )}
          </div>
        )}

        {/* Analyst consensus — real ratings data, not a headline guess */}
        {trade.analystConsensus && trade.analystConsensus.total >= 5 && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded border bg-[#0a0a0a] border-[#1a1a1a] text-[11px] font-mono flex-wrap">
            <span className="text-[#666] text-[10px] uppercase tracking-widest">Analysts</span>
            <span className={`font-bold ${
              trade.analystConsensus.consensus === 'BULLISH' ? 'text-green-400' :
              trade.analystConsensus.consensus === 'BEARISH' ? 'text-red-400' : 'text-[#999]'
            }`}>{trade.analystConsensus.consensus}</span>
            <span className="text-[#888]">{trade.analystConsensus.bullPct}% buy</span>
            <span className="text-[#555]">· {trade.analystConsensus.total} covering</span>
            {trade.analystConsensus.shift && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                trade.analystConsensus.shift === 'upgrades'
                  ? 'border-green-500/40 text-green-400' : 'border-red-500/40 text-red-400'
              }`}>
                {trade.analystConsensus.shift === 'upgrades' ? '↑ upgrade wave' : '↓ downgrade wave'}
              </span>
            )}
          </div>
        )}

        {/* Catalyst detail — the specific events found, newest first */}
        {trade.catalysts?.length > 0 && (
          <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded p-2.5 mb-2">
            <div className="text-[9px] uppercase tracking-widest text-[#555] font-mono mb-1.5">
              📰 Catalysts detected{trade.catalystBurst ? ' · story developing now' : ''}
            </div>
            <div className="space-y-1.5">
              {trade.catalysts.slice(0, 3).map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] font-mono">
                  <span className={`px-1.5 py-0.5 rounded border flex-shrink-0 ${
                    c.direction === 'bullish' ? 'border-green-500/30 text-green-400' :
                    c.direction === 'bearish' ? 'border-red-500/30 text-red-400' :
                                                 'border-amber-500/30 text-amber-400'
                  }`}>{c.label}</span>
                  <span className="text-[#666] flex-shrink-0">{c.age}</span>
                  <a href={c.link} target="_blank" rel="noreferrer"
                     className="text-[#888] hover:text-cyan-400 leading-snug line-clamp-2">
                    {c.title}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Extended-hours move — pre/post market action feeding the signal */}
        {trade.extendedHours && (
          <div className={`text-[11px] font-mono px-2.5 py-1.5 rounded mb-2 border flex items-center gap-2 flex-wrap ${
            trade.extendedHours.magnitude === 'large'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-[#0a0a0a] border-[#1f1f1f] text-[#999]'
          }`}>
            <span>{trade.extendedHours.session === 'pre' ? '🌅' : '🌙'}</span>
            <span className="font-bold">
              {trade.extendedHours.session === 'pre' ? 'Pre-market' : 'Post-market'}{' '}
              {trade.extendedHours.movePct > 0 ? '+' : ''}{trade.extendedHours.movePct}%
            </span>
            <span className="opacity-70">at ${trade.extendedHours.price?.toFixed(2)}</span>
            {trade.extendedHours.magnitude === 'large' && (
              <span className="text-[10px] opacity-80">· large gap — much of the move may already be done</span>
            )}
            {trade.liveBar && (
              <span className="text-[9px] opacity-60 ml-auto">indicators include live {trade.liveBar.session} price</span>
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

        {/* Company's own SEC filings. Sits ABOVE the news block on purpose:
            this is what the company filed itself, under legal obligation,
            whereas the headlines below are third parties writing about it —
            and frequently missing it entirely. */}
        {trade.secFilings && (
          <div className={`rounded border p-2.5 mb-3 ${
            trade.secWarning ? 'bg-red-500/5 border-red-500/25' : 'bg-[#0a0a0a] border-[#181818]'
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] uppercase tracking-widest font-mono text-[#444]">
                🏛 SEC Filings
              </span>
              {trade.secWarning && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-red-500/40 text-red-300 bg-red-500/10">
                  ⚠ RISK FILED
                </span>
              )}
            </div>
            {trade.secWarning && (
              <p className="text-[11px] text-red-300 font-mono leading-snug mb-1.5">
                {trade.secWarning}
              </p>
            )}
            <ul className="space-y-1">
              {trade.secFilings.filings.slice(0, 3).map((f, i) => (
                <li key={i} className="text-[11px] leading-snug flex items-start gap-2">
                  <span className={`font-mono text-[10px] flex-shrink-0 ${
                    f.direction === 'bearish' ? 'text-red-400'
                    : f.direction === 'bullish' ? 'text-green-400' : 'text-[#666]'
                  }`}>{f.daysAgo === 0 ? 'today' : `${f.daysAgo}d`}</span>
                  <a href={f.url} target="_blank" rel="noopener noreferrer"
                     className="text-[#999] hover:text-cyan-300 transition-colors">
                    {f.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-[9px] text-[#444] font-mono mt-1.5">
              Filed by the company with the SEC — not press coverage
            </p>
          </div>
        )}

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
              sl: trade.sl,
              // Carry the scale plan into the position. Without it the tracker
              // cannot tell you when to bank the first third and move the stop
              // to breakeven — which is the entire mechanism behind the trade
              // finishing green rather than red.
              tp0: trade.tp0,
              tp2: trade.tp2,
              scaledOut: false
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
        )}
      </div>
    </div>
  );
}
