// Generates clean, light-themed share images for messaging apps.
// Uses inline solid colors only — no opacity, no Tailwind — so html2canvas
// renders them razor-sharp.
import html2canvas from 'html2canvas';

const C = {
  bg:       '#ffffff',
  page:     '#f8fafc',
  card:     '#ffffff',
  border:   '#e2e8f0',
  borderDark:'#cbd5e1',
  text:     '#0f172a',
  textDim:  '#475569',
  textMute: '#94a3b8',

  green:    '#059669',
  greenBg:  '#ecfdf5',
  greenBd:  '#a7f3d0',
  red:      '#dc2626',
  redBg:    '#fef2f2',
  redBd:    '#fecaca',
  blue:     '#2563eb',
  blueBg:   '#eff6ff',
  blueBd:   '#bfdbfe',
  amber:    '#d97706',
  amberBg:  '#fffbeb',
  amberBd:  '#fcd34d',
  cyan:     '#0891b2',
  cyanBg:   '#ecfeff',
  cyanBd:   '#a5f3fc',
  brand:    '#0f172a'
};

const F = {
  sans:  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono:  '"SF Mono", Menlo, Monaco, "Courier New", monospace'
};

// Common header used in every share image
function header(subtitle) {
  const ts = new Date().toLocaleString('en-US', {
    timeZone: 'Europe/London', day: '2-digit', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
  return `
    <div style="display:flex; align-items:center; justify-content:space-between; padding-bottom:20px; border-bottom:2px solid ${C.border}; margin-bottom:24px;">
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="width:42px; height:42px; border-radius:8px; background:${C.brand}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:700;">◎</div>
        <div>
          <div style="font-family:${F.sans}; font-weight:700; font-size:20px; letter-spacing:1px; color:${C.brand};">PROJECT LOOK OUT</div>
          <div style="font-family:${F.sans}; font-size:11px; color:${C.textMute}; letter-spacing:2px; margin-top:2px;">${subtitle}</div>
        </div>
      </div>
      <div style="text-align:right; font-family:${F.mono}; font-size:11px; color:${C.textMute};">${ts} UK</div>
    </div>
  `;
}

function footer() {
  return `
    <div style="margin-top:24px; padding-top:14px; border-top:1px solid ${C.border}; text-align:center;">
      <div style="font-family:${F.sans}; font-size:11px; color:${C.textMute}; letter-spacing:1px;">Project Look Out · Live Market Intelligence Dashboard</div>
    </div>
  `;
}

async function renderAndCapture(html, filename) {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; top: 0; left: -10000px;
    width: 760px; padding: 36px;
    background: ${C.bg}; color: ${C.text};
    font-family: ${F.sans};
    box-sizing: border-box;
  `;
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    await new Promise(r => setTimeout(r, 150));
    const canvas = await html2canvas(container, {
      backgroundColor: '#ffffff',
      scale: 3,
      useCORS: true,
      logging: false,
      windowWidth: 760,
      windowHeight: container.scrollHeight,
      letterRendering: true
    });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1.0));
    return { blob, file: new File([blob], filename, { type: 'image/png' }) };
  } finally {
    document.body.removeChild(container);
  }
}

// ── TRADE CARD SHARE IMAGE ─────────────────────────────────────────────
export async function captureTradeShareImage(trade, entryTiming, filename) {
  const isLong = trade.direction === 'LONG';
  const dirColor = isLong ? C.green : C.red;
  const dirBg = isLong ? C.greenBg : C.redBg;
  const dirBd = isLong ? C.greenBd : C.redBd;
  const chgStr = trade.changePercent != null ? `${trade.changePercent >= 0 ? '+' : ''}${trade.changePercent.toFixed(2)}%` : '';
  const chgColor = (trade.changePercent ?? 0) >= 0 ? C.green : C.red;

  const html = `
    ${header('SWING TRADE SETUP')}

    <!-- Ticker hero -->
    <div style="background:${dirBg}; border:2px solid ${dirBd}; border-radius:14px; padding:24px; margin-bottom:16px;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between;">
        <div>
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:6px;">
            <span style="font-family:${F.sans}; font-weight:800; font-size:48px; letter-spacing:1px; color:${C.text}; line-height:1;">${trade.ticker}</span>
            <span style="background:${dirColor}; color:#fff; padding:6px 14px; border-radius:6px; font-weight:700; font-size:13px; letter-spacing:2px;">${isLong ? 'LONG' : 'SHORT'}</span>
          </div>
          <div style="font-size:13px; color:${C.textDim};">${trade.name || ''}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:${F.mono}; font-size:36px; font-weight:700; color:${C.text}; line-height:1;">$${trade.price?.toFixed(2) ?? '—'}</div>
          ${chgStr ? `<div style="font-family:${F.mono}; font-size:15px; color:${chgColor}; margin-top:6px; font-weight:600;">${chgStr} today</div>` : ''}
        </div>
      </div>
    </div>

    <!-- Levels: Entry / TP1 / TP2 / SL -->
    <div style="display:grid; grid-template-columns:1fr 1fr ${trade.tp2 != null ? '1fr ' : ''}1fr; gap:10px; margin-bottom:16px;">
      <div style="background:${C.greenBg}; border:2px solid ${C.greenBd}; border-radius:10px; padding:14px;">
        <div style="font-family:${F.sans}; font-size:10px; color:${C.green}; letter-spacing:2px; margin-bottom:6px; font-weight:700;">ENTRY ZONE</div>
        <div style="font-family:${F.mono}; font-size:15px; font-weight:700; color:${C.green}; line-height:1.3;">
          $${trade.entryLow?.toFixed(2) ?? trade.entry?.toFixed(2)}
          <span style="color:${C.textMute}; margin:0 4px;">–</span>
          $${trade.entryHigh?.toFixed(2) ?? trade.entry?.toFixed(2)}
        </div>
      </div>
      <div style="background:${C.blueBg}; border:2px solid ${C.blueBd}; border-radius:10px; padding:14px;">
        <div style="font-family:${F.sans}; font-size:10px; color:${C.blue}; letter-spacing:2px; margin-bottom:6px; font-weight:700;">TP1 — SAFE</div>
        <div style="font-family:${F.mono}; font-size:20px; font-weight:700; color:${C.blue}; line-height:1;">$${trade.tp?.toFixed(2) ?? '—'}</div>
        ${trade.tpPct != null ? `<div style="font-family:${F.mono}; font-size:12px; color:${C.blue}; margin-top:4px; font-weight:600;">+${trade.tpPct}% · R:R ${trade.rrRatio}:1</div>` : ''}
      </div>
      ${trade.tp2 != null ? `
      <div style="background:${C.cyanBg}; border:2px solid ${C.cyanBd}; border-radius:10px; padding:14px;">
        <div style="font-family:${F.sans}; font-size:10px; color:${C.cyan}; letter-spacing:2px; margin-bottom:6px; font-weight:700;">TP2 — EXTENDED</div>
        <div style="font-family:${F.mono}; font-size:20px; font-weight:700; color:${C.cyan}; line-height:1;">$${trade.tp2?.toFixed(2)}</div>
        <div style="font-family:${F.mono}; font-size:12px; color:${C.cyan}; margin-top:4px; font-weight:600;">+${trade.tp2Pct}% · R:R ${trade.rrRatio2}:1</div>
      </div>` : ''}
      <div style="background:${C.redBg}; border:2px solid ${C.redBd}; border-radius:10px; padding:14px;">
        <div style="font-family:${F.sans}; font-size:10px; color:${C.red}; letter-spacing:2px; margin-bottom:6px; font-weight:700;">STOP LOSS</div>
        <div style="font-family:${F.mono}; font-size:20px; font-weight:700; color:${C.red}; line-height:1;">$${trade.sl?.toFixed(2) ?? '—'}</div>
        ${trade.slPct != null ? `<div style="font-family:${F.mono}; font-size:12px; color:${C.red}; margin-top:4px; font-weight:600;">−${trade.slPct}%</div>` : ''}
      </div>
    </div>

    ${trade.tp2 != null ? `
    <div style="font-size:11px; color:${C.textDim}; font-style:italic; margin-bottom:14px; padding:8px 12px; background:${C.page}; border-radius:6px;">
      💡 Scale out in thirds: a third at the first target (stop then moves to breakeven) · a third at TP1 · let the runner reach TP2
    </div>` : ''}

    <!-- Stats row -->
    <div style="background:${C.page}; border:1px solid ${C.border}; border-radius:10px; padding:16px; display:flex; justify-content:space-between; margin-bottom:16px;">
      ${trade.rrRatio != null ? `
      <div style="text-align:center; flex:1;">
        <div style="font-family:${F.sans}; font-size:10px; color:${C.textMute}; letter-spacing:2px; margin-bottom:4px;">R:R RATIO</div>
        <div style="font-family:${F.mono}; font-size:20px; font-weight:700; color:${C.amber};">${trade.rrRatio} : 1</div>
      </div>` : ''}
      ${trade.confidence != null ? `
      <div style="text-align:center; flex:1; border-left:1px solid ${C.border};">
        <div style="font-family:${F.sans}; font-size:10px; color:${C.textMute}; letter-spacing:2px; margin-bottom:4px;">CONFIDENCE</div>
        <div style="font-family:${F.mono}; font-size:20px; font-weight:700; color:${trade.confidence >= 80 ? C.green : trade.confidence >= 65 ? C.amber : C.red};">${trade.confidence}%</div>
      </div>` : ''}
      ${trade.probability ? `
      <div style="text-align:center; flex:1; border-left:1px solid ${C.border};">
        <div style="font-family:${F.sans}; font-size:10px; color:${C.textMute}; letter-spacing:2px; margin-bottom:4px;">PROBABILITY</div>
        <div style="font-family:${F.sans}; font-size:18px; font-weight:700; color:${trade.probability === 'HIGH' ? C.green : C.amber};">${trade.probability}</div>
      </div>` : ''}
      ${trade.weeklyTrend ? `
      <div style="text-align:center; flex:1; border-left:1px solid ${C.border};">
        <div style="font-family:${F.sans}; font-size:10px; color:${C.textMute}; letter-spacing:2px; margin-bottom:4px;">WEEKLY</div>
        <div style="font-family:${F.sans}; font-size:18px; font-weight:700; color:${trade.weeklyTrend === 'UP' ? C.green : trade.weeklyTrend === 'DOWN' ? C.red : C.textDim};">${trade.weeklyTrend}</div>
      </div>` : ''}
    </div>

    <!-- When to enter / hold / verdict -->
    <div style="display:flex; flex-direction:column; gap:8px;">
      ${entryTiming ? `<div style="font-size:13px; color:${C.text};"><span style="color:${C.textMute};">⏰ When to enter:</span> <strong>${entryTiming}</strong></div>` : ''}
      ${trade.timeSpan ? `<div style="font-size:13px; color:${C.text};"><span style="color:${C.textMute};">⏱ Hold duration:</span> ${trade.timeSpan}</div>` : ''}
      ${trade.review?.verdict ? `<div style="font-size:13px;"><span style="color:${C.textMute};">✓ Reviewer:</span> <strong style="color:${trade.review.verdict === 'PASS' ? C.green : trade.review.verdict === 'CAUTION' ? C.amber : C.red};">${trade.review.verdict}</strong></div>` : ''}
    </div>

    ${footer()}
  `;
  return await renderAndCapture(html, filename);
}

// ── ANALYST REPORT SHARE IMAGE ─────────────────────────────────────────
export async function captureAnalystShareImage(data, filename) {
  const verdictColors = {
    'STRONG BUY':  { bg: C.greenBg, bd: C.greenBd, text: C.green, icon: '🚀' },
    'BUY':         { bg: C.greenBg, bd: C.greenBd, text: C.green, icon: '📈' },
    'HOLD':        { bg: C.amberBg, bd: C.amberBd, text: C.amber, icon: '⏸' },
    'WAIT':        { bg: C.blueBg,  bd: C.blueBd,  text: C.blue,  icon: '⏳' },
    'SELL':        { bg: C.redBg,   bd: C.redBd,   text: C.red,   icon: '📉' },
    'STRONG SELL': { bg: C.redBg,   bd: C.redBd,   text: C.red,   icon: '⬇' },
    'AVOID':       { bg: C.redBg,   bd: C.redBd,   text: C.red,   icon: '🚫' }
  };
  const vc = verdictColors[data.verdict] || verdictColors.WAIT;
  const chgColor = (data.changePercent ?? 0) >= 0 ? C.green : C.red;
  const relColor = data.reliability?.score >= 80 ? C.green
                 : data.reliability?.score >= 65 ? C.amber
                 : data.reliability?.score >= 50 ? C.amber : C.red;

  const html = `
    ${header('ANALYST REPORT')}

    <!-- Ticker -->
    <div style="background:${C.page}; border:1px solid ${C.border}; border-radius:12px; padding:24px; margin-bottom:14px;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between;">
        <div>
          <div style="font-family:${F.sans}; font-weight:800; font-size:42px; letter-spacing:1px; color:${C.text}; margin-bottom:4px; line-height:1;">${data.ticker}</div>
          <div style="font-size:13px; color:${C.textDim};">${data.name || ''}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:${F.mono}; font-size:32px; font-weight:700; color:${C.text}; line-height:1;">$${data.price?.toFixed(2)}</div>
          <div style="font-family:${F.mono}; font-size:14px; color:${chgColor}; margin-top:4px; font-weight:600;">${data.changePercent >= 0 ? '+' : ''}${data.changePercent?.toFixed(2)}% today</div>
        </div>
      </div>
    </div>

    <!-- Verdict hero -->
    <div style="background:${vc.bg}; border:2px solid ${vc.bd}; border-radius:12px; padding:24px; margin-bottom:14px;">
      <div style="display:flex; align-items:center; gap:14px; margin-bottom:10px;">
        <span style="font-size:32px;">${vc.icon}</span>
        <span style="font-family:${F.sans}; font-weight:800; font-size:34px; letter-spacing:3px; color:${vc.text}; line-height:1;">${data.verdict}</span>
      </div>
      ${data.verdictDetail ? `<div style="font-size:14px; color:${C.text}; line-height:1.5;">${data.verdictDetail}</div>` : ''}
    </div>

    <!-- Best Play -->
    ${data.bestPlay ? `
    <div style="background:${C.cyanBg}; border:2px solid ${C.cyanBd}; border-radius:12px; padding:20px; margin-bottom:14px;">
      <div style="font-family:${F.sans}; font-size:11px; color:${C.cyan}; letter-spacing:2px; margin-bottom:8px; font-weight:700;">💡 BEST PLAY RIGHT NOW</div>
      <div style="font-family:${F.sans}; font-weight:700; font-size:20px; color:${C.text}; margin-bottom:10px; line-height:1.3;">${data.bestPlay.headline}</div>
      <div style="font-size:14px; color:${C.text}; line-height:1.5; margin-bottom:12px;">${data.bestPlay.action}</div>
      ${(data.bestPlay.timeframe || data.bestPlay.sizing) ? `
      <div style="display:flex; gap:24px; font-size:12px;">
        ${data.bestPlay.timeframe ? `<div><span style="color:${C.textMute};">Timeframe: </span><strong style="color:${C.text};">${data.bestPlay.timeframe}</strong></div>` : ''}
        ${data.bestPlay.sizing ? `<div><span style="color:${C.textMute};">Sizing: </span><strong style="color:${C.text};">${data.bestPlay.sizing}</strong></div>` : ''}
      </div>` : ''}
    </div>` : ''}

    <!-- Reliability -->
    ${data.reliability ? `
    <div style="background:${C.page}; border:1px solid ${C.border}; border-radius:12px; padding:20px; margin-bottom:14px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <div style="font-family:${F.sans}; font-size:11px; color:${C.textMute}; letter-spacing:2px; font-weight:700;">⚖ RELIABILITY SCORE</div>
        <div style="font-family:${F.sans}; font-weight:800; font-size:28px; color:${relColor}; line-height:1;">${data.reliability.score}/100</div>
      </div>
      <div style="height:10px; background:${C.border}; border-radius:5px; overflow:hidden; margin-bottom:8px;">
        <div style="width:${data.reliability.score}%; height:100%; background:${relColor};"></div>
      </div>
      <div style="font-size:12px; color:${relColor}; font-weight:600;">${data.reliability.label}</div>
    </div>` : ''}

    <!-- Targets -->
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
      <div style="background:${C.greenBg}; border:2px solid ${C.greenBd}; border-radius:10px; padding:18px;">
        <div style="font-family:${F.sans}; font-size:10px; color:${C.green}; letter-spacing:2px; margin-bottom:8px; font-weight:700;">🎯 BULLISH TARGET</div>
        <div style="font-family:${F.mono}; font-size:24px; font-weight:700; color:${C.green};">$${data.targets.bullish.price?.toFixed(2)}</div>
        <div style="font-family:${F.mono}; font-size:12px; color:${C.green}; margin-top:4px; font-weight:600;">+${data.targets.bullish.pct}% · ${data.targets.bullish.timeframe}</div>
      </div>
      <div style="background:${C.redBg}; border:2px solid ${C.redBd}; border-radius:10px; padding:18px;">
        <div style="font-family:${F.sans}; font-size:10px; color:${C.red}; letter-spacing:2px; margin-bottom:8px; font-weight:700;">🎯 BEARISH TARGET</div>
        <div style="font-family:${F.mono}; font-size:24px; font-weight:700; color:${C.red};">$${data.targets.bearish.price?.toFixed(2)}</div>
        <div style="font-family:${F.mono}; font-size:12px; color:${C.red}; margin-top:4px; font-weight:600;">${data.targets.bearish.pct}% · ${data.targets.bearish.timeframe}</div>
      </div>
    </div>

    <!-- Setup -->
    ${data.setup ? `
    <div style="background:${C.page}; border:1px solid ${C.border}; border-radius:10px; padding:16px; margin-bottom:14px;">
      <div style="font-family:${F.sans}; font-size:11px; color:${C.textMute}; letter-spacing:2px; margin-bottom:10px; font-weight:700;">💡 RECOMMENDED ${data.setup.direction} SETUP</div>
      <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:12px;">
        <div><div style="font-size:10px; color:${C.textMute};">ENTRY</div><div style="font-family:${F.mono}; font-size:15px; font-weight:700; color:${C.green};">$${data.setup.entryLow?.toFixed(2)}–$${data.setup.entryHigh?.toFixed(2)}</div></div>
        <div><div style="font-size:10px; color:${C.textMute};">TARGET</div><div style="font-family:${F.mono}; font-size:15px; font-weight:700; color:${C.blue};">$${data.setup.tp?.toFixed(2)}</div></div>
        <div><div style="font-size:10px; color:${C.textMute};">STOP</div><div style="font-family:${F.mono}; font-size:15px; font-weight:700; color:${C.red};">$${data.setup.sl?.toFixed(2)}</div></div>
        <div><div style="font-size:10px; color:${C.textMute};">R:R · CONF</div><div style="font-family:${F.mono}; font-size:15px; font-weight:700; color:${C.text};">${data.setup.rrRatio}:1 · ${data.setup.confidence}%</div></div>
      </div>
    </div>` : ''}

    <!-- Technicals strip -->
    <div style="background:${C.page}; border:1px solid ${C.border}; border-radius:10px; padding:14px; display:flex; justify-content:space-around; flex-wrap:wrap; gap:10px;">
      ${data.technicals?.rsi != null ? `<div style="text-align:center;"><div style="font-size:10px; color:${C.textMute}; letter-spacing:2px; font-weight:700;">RSI</div><div style="font-family:${F.mono}; font-size:18px; font-weight:700; color:${data.technicals.rsi > 70 ? C.red : data.technicals.rsi < 30 ? C.green : C.text};">${data.technicals.rsi}</div></div>` : ''}
      ${data.weeklyTrend ? `<div style="text-align:center;"><div style="font-size:10px; color:${C.textMute}; letter-spacing:2px; font-weight:700;">WEEKLY</div><div style="font-family:${F.sans}; font-size:16px; font-weight:700; color:${data.weeklyTrend === 'UP' ? C.green : data.weeklyTrend === 'DOWN' ? C.red : C.textDim};">${data.weeklyTrend}</div></div>` : ''}
      ${data.sentiment && data.sentiment.total > 0 ? `<div style="text-align:center;"><div style="font-size:10px; color:${C.textMute}; letter-spacing:2px; font-weight:700;">SENTIMENT</div><div style="font-family:${F.mono}; font-size:18px; font-weight:700; color:${data.sentiment.score >= 55 ? C.green : data.sentiment.score <= 45 ? C.red : C.textDim};">${data.sentiment.score}%</div></div>` : ''}
      ${data.vix != null ? `<div style="text-align:center;"><div style="font-size:10px; color:${C.textMute}; letter-spacing:2px; font-weight:700;">VIX</div><div style="font-family:${F.mono}; font-size:18px; font-weight:700; color:${data.vix > 25 ? C.red : data.vix > 20 ? C.amber : C.green};">${data.vix.toFixed(1)}</div></div>` : ''}
    </div>

    ${footer()}
  `;
  return await renderAndCapture(html, filename);
}
