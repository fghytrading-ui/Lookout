import { captureTradeShareImage, captureAnalystShareImage } from './shareImage.js';

// Share a trade card using the high-contrast template (NOT the live DOM)
export async function shareTrade(trade, { filename = 'trade.png', title = 'Project Look Out', text = '', entryTiming = null } = {}) {
  try {
    const { file, blob } = await captureTradeShareImage(trade, entryTiming, filename);
    return await dispatchShare(file, blob, filename, title, text);
  } catch (err) {
    console.error('Share failed:', err);
    return { method: 'error', success: false, error: err.message };
  }
}

export async function shareAnalyst(data, { filename = 'analyst.png', title = 'Project Look Out', text = '' } = {}) {
  try {
    const { file, blob } = await captureAnalystShareImage(data, filename);
    return await dispatchShare(file, blob, filename, title, text);
  } catch (err) {
    console.error('Share failed:', err);
    return { method: 'error', success: false, error: err.message };
  }
}

async function dispatchShare(file, blob, filename, title, text) {
  try {

    // Try native share with file (iOS Safari, Chrome Android, latest desktop)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title, text });
        return { method: 'native', success: true };
      } catch (e) {
        // User cancelled — treat as success
        if (e.name === 'AbortError') return { method: 'native', success: false, cancelled: true };
      }
    }

    // Fallback: download as PNG
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { method: 'download', success: true };
  } catch (err) {
    console.error('Share failed:', err);
    return { method: 'error', success: false, error: err.message };
  }
}

// Format a trade card as shareable plain text (for text-based sharing)
export function formatTradeText(trade, opts = {}) {
  if (!trade) return '';
  const dirEmoji = trade.direction === 'LONG' ? '🟢' : '🔴';
  const lines = [];

  lines.push(`${dirEmoji} ${trade.ticker} ${trade.direction} — Project Look Out`);
  if (trade.name) lines.push(`${trade.name}`);
  // historicalWinRate was an invented constant and has been removed; the real
  // tracked record lives on historicalStats and is only present once there is
  // a sample to quote.
  if (trade.setupType) {
    const rec = trade.historicalStats
      ? ` · ${Math.round(trade.historicalStats.winRate * 100)}% tracked (n=${trade.historicalStats.sampleSize})`
      : '';
    lines.push(`${trade.setupType.label} · ${trade.setupType.idealHold}${rec}`);
  }
  lines.push('');

  if (trade.price != null) {
    const chg = trade.changePercent != null ? ` (${trade.changePercent >= 0 ? '+' : ''}${trade.changePercent.toFixed(2)}%)` : '';
    lines.push(`Live: $${trade.price.toFixed(2)}${chg}`);
  }
  lines.push('');

  if (trade.entryLow != null && trade.entryHigh != null) {
    lines.push(`📍 Entry Zone: $${trade.entryLow.toFixed(2)} – $${trade.entryHigh.toFixed(2)}`);
  } else if (trade.entry != null) {
    lines.push(`📍 Entry: $${trade.entry.toFixed(2)}`);
  }

  if (trade.tp != null) {
    const tpPct = trade.tpPct != null ? trade.tpPct : (Math.abs((trade.tp - trade.entry) / trade.entry) * 100).toFixed(1);
    lines.push(`🎯 TP1 (Safe): $${trade.tp.toFixed(2)}  (${trade.direction === 'LONG' ? '+' : '-'}${tpPct}%)  R:R ${trade.rrRatio}:1`);
  }
  if (trade.tp2 != null) {
    const tp2Pct = trade.tp2Pct != null ? trade.tp2Pct : (Math.abs((trade.tp2 - trade.entry) / trade.entry) * 100).toFixed(1);
    lines.push(`🚀 TP2 (Extended): $${trade.tp2.toFixed(2)}  (${trade.direction === 'LONG' ? '+' : '-'}${tp2Pct}%)  R:R ${trade.rrRatio2}:1`);
  }
  if (trade.sl != null) {
    const slPct = trade.slPct != null ? trade.slPct : (Math.abs((trade.sl - trade.entry) / trade.entry) * 100).toFixed(1);
    lines.push(`🛑 Stop Loss: $${trade.sl.toFixed(2)}  (${trade.direction === 'LONG' ? '-' : '+'}${slPct}%)`);
  }
  if (trade.rrRatio != null) lines.push(`📊 R:R: ${trade.rrRatio} : 1`);
  if (trade.confidence != null) lines.push(`⚖ Confidence: ${trade.confidence}%`);
  if (trade.probability) lines.push(`💪 Probability: ${trade.probability}`);

  if (trade.review?.verdict) {
    const icon = trade.review.verdict === 'PASS' ? '✓' : trade.review.verdict === 'CAUTION' ? '⚠' : '✗';
    lines.push(`${icon} Reviewer: ${trade.review.verdict}`);
  }
  lines.push('');

  if (opts.entryTiming) lines.push(`⏰ ${opts.entryTiming}`);
  if (trade.timeSpan) lines.push(`⏱ Hold: ${trade.timeSpan}`);
  if (trade.weeklyTrend) lines.push(`📈 Weekly trend: ${trade.weeklyTrend}`);
  if (trade.sentiment && trade.sentiment.total > 0) lines.push(`💬 News sentiment: ${trade.sentiment.label} ${trade.sentiment.score}%`);
  lines.push('');

  return lines.join('\n');
}

// Format an analyst report as shareable text
export function formatAnalystText(data) {
  if (!data) return '';
  const lines = [];
  lines.push(`🔍 ${data.ticker} — ${data.verdict}  (${data.name || ''})`);
  lines.push('');
  lines.push(`Price: $${data.price?.toFixed(2)} (${data.changePercent >= 0 ? '+' : ''}${data.changePercent?.toFixed(2)}% today)`);
  lines.push('');

  if (data.bestPlay) {
    lines.push(`💡 BEST PLAY: ${data.bestPlay.headline}`);
    lines.push(data.bestPlay.action);
    if (data.bestPlay.timeframe) lines.push(`Timeframe: ${data.bestPlay.timeframe}`);
    if (data.bestPlay.sizing) lines.push(`Sizing: ${data.bestPlay.sizing}`);
    lines.push('');
  }

  if (data.reliability) {
    lines.push(`⚖ Reliability: ${data.reliability.score}/100 — ${data.reliability.label}`);
    lines.push('');
  }

  if (data.targets) {
    lines.push(`🎯 Bullish target: $${data.targets.bullish.price?.toFixed(2)} (+${data.targets.bullish.pct}%)`);
    lines.push(`🎯 Bearish target: $${data.targets.bearish.price?.toFixed(2)} (${data.targets.bearish.pct}%)`);
    lines.push('');
  }

  if (data.setup) {
    lines.push(`Setup (${data.setup.direction}):`);
    lines.push(`  Entry zone: $${data.setup.entryLow?.toFixed(2)} – $${data.setup.entryHigh?.toFixed(2)}`);
    lines.push(`  TP1 (Safe):     $${data.setup.tp?.toFixed(2)}  R:R ${data.setup.rrRatio}:1`);
    if (data.setup.tp2 != null) {
      lines.push(`  TP2 (Extended): $${data.setup.tp2.toFixed(2)}  R:R ${data.setup.rrRatio2}:1`);
    }
    lines.push(`  Stop Loss:      $${data.setup.sl?.toFixed(2)}`);
    lines.push('');
  }

  lines.push(`Weekly trend: ${data.weeklyTrend}`);
  if (data.sentiment && data.sentiment.total > 0) lines.push(`News sentiment: ${data.sentiment.label} ${data.sentiment.score}%`);
  lines.push('');
  lines.push('Source: Project Look Out');

  return lines.join('\n');
}

// Copy text to clipboard
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}
