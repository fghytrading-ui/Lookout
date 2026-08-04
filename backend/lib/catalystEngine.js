// Catalyst engine — identifies the actual EVENT moving a stock.
//
// The previous approach counted words like "surge" and "plunge" across four
// headlines and produced a sentiment percentage. That cannot tell the
// difference between a merger being agreed and a merger collapsing, between an
// FDA approval and a rejection, or between an analyst upgrade and a short
// seller report. Those are the events that actually move price, and they are
// what a trader needs to see before entering.
//
// This module classifies headlines into concrete catalyst types, each with a
// direction, an impact weight and a tradability rule, then weights them by how
// recent they are. Fresh news dominates: a merger announced 20 minutes ago is
// worth far more than a stale piece from three days back.

// ── CATALYST DEFINITIONS ────────────────────────────────────────────────
// impact:  0-10, how hard this type typically moves price
// dir:     'bullish' | 'bearish' | 'volatile' (direction unclear but big move)
// blocks:  true = do not trade on technicals; the event overrides the chart
const CATALYSTS = [
  // ── M&A — the biggest single-day movers ──
  { id: 'acquisition_target', dir: 'bullish', impact: 10, blocks: true,
    label: 'Acquisition / takeover bid',
    patterns: [/\bto (be )?acquir\w+ by\b/i, /\btakeover bid\b/i, /\bbuyout offer\b/i,
               /\bagrees? to be (acquired|bought)\b/i, /\bmerger agreement\b/i,
               /\b(acquires?|acquiring|to buy) .{0,30}\bfor \$?\d/i, /\ball-cash (deal|offer)\b/i] },

  { id: 'deal_collapse', dir: 'bearish', impact: 10, blocks: true,
    label: 'Deal collapsed / terminated',
    patterns: [/\b(deal|merger|acquisition|takeover) (is )?(off|dead|collapsed?|terminated|abandoned|scrapped)\b/i,
               /\bcalls? off\b.{0,30}\b(deal|merger|acquisition)\b/i,
               /\b(walks?|walked) away from\b/i, /\bblocks? .{0,25}(merger|acquisition|deal)\b/i,
               /\bantitrust (suit|challenge|lawsuit) .{0,20}(block|halt)/i,
               /\breject(s|ed)? .{0,20}(offer|bid|proposal)\b/i] },

  // ── Guidance — the most reliable repeatable catalyst ──
  // NOTE: "target" is deliberately excluded here — "raises price target" is an
  // analyst action, not company guidance, and conflating them mislabels a
  // routine broker note as a major fundamental catalyst.
  { id: 'guidance_raised', dir: 'bullish', impact: 8, blocks: false,
    label: 'Guidance raised',
    patterns: [/\b(raises?|raised|lifts?|boosts?|hikes?) .{0,25}(guidance|outlook|forecast)\b/i,
               /\b(guidance|outlook|forecast) .{0,15}(raised|boosted|increased)\b/i,
               /\bupbeat (guidance|outlook|forecast)\b/i] },

  { id: 'guidance_cut', dir: 'bearish', impact: 9, blocks: false,
    label: 'Guidance cut',
    patterns: [/\b(cuts?|lowers?|slashes?|reduces?|trims?) .{0,25}(guidance|outlook|forecast)\b/i,
               /\b(guidance|outlook|forecast) .{0,15}(cut|lowered|slashed|reduced)\b/i,
               /\bwarns? (on|of|about)\b/i, /\bprofit warning\b/i, /\bwithdraws? guidance\b/i] },

  // ── Earnings results ──
  { id: 'earnings_beat', dir: 'bullish', impact: 7, blocks: false,
    label: 'Earnings beat',
    patterns: [/\b(beats?|tops?|crushes?|smashes?) .{0,20}(estimates?|expectations?|forecasts?|views?)\b/i,
               /\bbetter[- ]than[- ]expected\b/i, /\bearnings beat\b/i, /\brecord (profit|revenue|earnings)\b/i] },

  { id: 'earnings_miss', dir: 'bearish', impact: 8, blocks: false,
    label: 'Earnings miss',
    patterns: [/\b(misses?|missed) .{0,20}(estimates?|expectations?|forecasts?)\b/i,
               /\bworse[- ]than[- ]expected\b/i, /\bearnings miss\b/i,
               /\bdisappoint\w*\b.{0,20}(results?|earnings|quarter)\b/i] },

  // ── Biotech / pharma — binary and violent ──
  { id: 'fda_positive', dir: 'bullish', impact: 10, blocks: true,
    label: 'FDA approval / positive trial',
    patterns: [/\bFDA approv\w+/i, /\bapproved by the FDA\b/i, /\bwins? .{0,20}approval\b/i,
               /\bpositive (topline|phase|trial|results?)\b/i, /\bmeets? primary endpoint\b/i,
               /\bbreakthrough therapy\b/i] },

  { id: 'fda_negative', dir: 'bearish', impact: 10, blocks: true,
    label: 'FDA rejection / trial failure',
    patterns: [/\bFDA reject\w+/i, /\bcomplete response letter\b/i, /\bCRL\b/,
               /\b(fails?|failed|misses?) .{0,20}(primary )?endpoint\b/i,
               /\btrial (failure|failed|halted|discontinued)\b/i, /\bclinical hold\b/i,
               /\bdisappointing (trial|study|data)\b/i] },

  // ── Legal / regulatory ──
  { id: 'legal_negative', dir: 'bearish', impact: 7, blocks: false,
    label: 'Legal / regulatory action',
    patterns: [/\b(SEC|DOJ|FTC) (probe|investigation|charges?|sues?|lawsuit)\b/i,
               /\b(sued|lawsuit|class action|subpoena)\b/i, /\bfraud (charges?|allegations?)\b/i,
               /\b(fined|penalty) .{0,15}\$\d/i, /\binvestigation into\b/i] },

  { id: 'short_report', dir: 'bearish', impact: 9, blocks: true,
    label: 'Short-seller report',
    patterns: [/\bshort[- ]seller\b/i, /\bHindenburg\b/i, /\bMuddy Waters\b/i,
               /\bCitron\b/i, /\bscathing report\b/i, /\baccounting (fraud|irregularities)\b/i] },

  // ── Analyst actions — modest but frequent ──
  { id: 'upgrade', dir: 'bullish', impact: 5, blocks: false,
    label: 'Analyst upgrade',
    patterns: [/\bupgrade[sd]?\b/i, /\braises? price target\b/i, /\bto (buy|outperform|overweight)\b/i,
               /\binitiat\w+ .{0,20}(buy|outperform|overweight)\b/i] },

  { id: 'downgrade', dir: 'bearish', impact: 6, blocks: false,
    label: 'Analyst downgrade',
    patterns: [/\bdowngrade[sd]?\b/i, /\b(cuts?|lowers?) price target\b/i,
               /\bto (sell|underperform|underweight)\b/i] },

  // ── Business events ──
  { id: 'contract_win', dir: 'bullish', impact: 6, blocks: false,
    label: 'Major contract / order',
    patterns: [/\b(wins?|awarded|secures?|lands?) .{0,30}(contract|deal|order)\b/i,
               /\b\$\d+(\.\d+)?\s?(million|billion) (contract|order|deal)\b/i,
               /\bpartnership with\b/i] },

  { id: 'buyback_dividend', dir: 'bullish', impact: 5, blocks: false,
    label: 'Buyback / dividend increase',
    patterns: [/\b(buyback|share repurchase)\b/i, /\b(raises?|increases?|hikes?) dividend\b/i,
               /\bspecial dividend\b/i] },

  { id: 'offering_dilution', dir: 'bearish', impact: 7, blocks: false,
    label: 'Share offering / dilution',
    patterns: [/\b(stock|share|equity|public) offering\b/i, /\bdilut\w+/i,
               /\bprices? .{0,20}offering\b/i, /\bconvertible notes?\b/i] },

  { id: 'exec_change', dir: 'volatile', impact: 5, blocks: false,
    label: 'Executive change',
    patterns: [/\b(CEO|CFO|chairman) (steps? down|resigns?|departs?|out|to leave|fired|ousted)\b/i,
               /\bnames? new (CEO|CFO)\b/i, /\bleadership (change|shakeup)\b/i] },

  { id: 'restructuring', dir: 'volatile', impact: 5, blocks: false,
    label: 'Layoffs / restructuring',
    patterns: [/\blay(s|ing)? off\b/i, /\blayoffs?\b/i, /\bjob cuts?\b/i,
               /\brestructur\w+/i, /\bspin[- ]?off\b/i] },

  { id: 'distress', dir: 'bearish', impact: 10, blocks: true,
    label: 'Financial distress',
    patterns: [/\bbankrupt\w*/i, /\bChapter 11\b/i, /\bgoing concern\b/i,
               /\bdefaults?\b/i, /\bdelisting\b/i, /\bhalt\w* trading\b/i] },

  { id: 'product_recall', dir: 'bearish', impact: 6, blocks: false,
    label: 'Recall / safety issue',
    patterns: [/\brecalls?\b/i, /\bsafety (probe|issue|concern|investigation)\b/i,
               /\bdefect\w*/i] },

  { id: 'index_change', dir: 'volatile', impact: 6, blocks: false,
    label: 'Index inclusion / removal',
    patterns: [/\b(join|added to|inclusion in|removed from) .{0,15}(S&P|Nasdaq|Dow|index)\b/i,
               /\bindex rebalanc\w+/i] }
];

// ── RECENCY WEIGHTING ───────────────────────────────────────────────────
// A catalyst 20 minutes old is actionable. The same story three days later is
// already priced in. Weighting is aggressive because that gap is what makes
// news tradable at all.
function recencyWeight(publishedAt) {
  if (!publishedAt) return 0.5;
  const hours = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000;
  if (hours < 0.5)  return 3.0;   // breaking
  if (hours < 2)    return 2.5;
  if (hours < 6)    return 2.0;
  if (hours < 24)   return 1.3;
  if (hours < 48)   return 0.8;
  if (hours < 96)   return 0.4;
  return 0.15;                     // effectively priced in
}

function ageLabel(publishedAt) {
  if (!publishedAt) return 'unknown age';
  const mins = Math.round((Date.now() - new Date(publishedAt).getTime()) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// Negation guard. Headlines routinely embed a positive phrase inside a
// negative statement — "fails to meet primary endpoint" contains "meet primary
// endpoint", and would otherwise be read as a successful trial. Whenever a
// failure word appears, bullish interpretations are suppressed so the bearish
// classification wins.
const NEGATION = /\b(fail(s|ed|ure)?|miss(es|ed)?|reject(s|ed|ion)?|deni(es|ed)|halt(s|ed)?|discontinu\w+|not? (meet|achieve)|unsuccessful|setback|disappoint\w*)\b/i;

// Classify a single headline. Returns the highest-impact match, or null.
function classifyHeadline(title) {
  if (!title) return null;
  const negated = NEGATION.test(title);

  const matches = [];
  for (const c of CATALYSTS) {
    if (c.patterns.some(p => p.test(title))) matches.push(c);
  }
  if (!matches.length) return null;

  // With a failure word present, never return a bullish reading if a bearish
  // or neutral one also matched.
  const usable = negated
    ? (matches.filter(c => c.dir !== 'bullish').length ? matches.filter(c => c.dir !== 'bullish') : [])
    : matches;
  if (!usable.length) return null;

  return usable.reduce((best, c) => (!best || c.impact > best.impact) ? c : best, null);
}

/**
 * Analyse a ticker's news into a catalyst picture.
 *
 * Returns:
 *   catalysts     — classified events, newest and highest-impact first
 *   primary       — the single event most likely driving price
 *   netDirection  — 'bullish' | 'bearish' | 'volatile' | 'neutral'
 *   netScore      — signed, recency-weighted conviction
 *   breaking      — an unusually fresh, high-impact event is live
 *   burst         — abnormal volume of coverage = something is happening now
 *   blocking      — an event that overrides technical analysis entirely
 */
export function analyseCatalysts(news) {
  if (!news?.length) {
    return { catalysts: [], primary: null, netDirection: 'neutral', netScore: 0,
             breaking: false, burst: false, blocking: null, headlineCount: 0 };
  }

  const found = [];
  for (const item of news) {
    const cat = classifyHeadline(item.title);
    if (!cat) continue;
    const weight = recencyWeight(item.time);
    found.push({
      id: cat.id,
      label: cat.label,
      direction: cat.dir,
      impact: cat.impact,
      blocks: cat.blocks,
      weight,
      score: cat.impact * weight,
      title: item.title,
      publisher: item.publisher,
      link: item.link,
      time: item.time,
      age: ageLabel(item.time)
    });
  }

  if (!found.length) {
    return { catalysts: [], primary: null, netDirection: 'neutral', netScore: 0,
             breaking: false, burst: false, blocking: null, headlineCount: news.length };
  }

  found.sort((a, b) => b.score - a.score);

  // Net conviction — 'volatile' events contribute magnitude but no direction
  let net = 0;
  for (const f of found) {
    if (f.direction === 'bullish') net += f.score;
    else if (f.direction === 'bearish') net -= f.score;
  }

  const primary = found[0];

  // Breaking: a high-impact event inside the last two hours
  const breaking = found.some(f => f.impact >= 7 && f.weight >= 2.5);

  // Burst: three or more stories within six hours means something is unfolding
  const recentCount = news.filter(n => n.time &&
    (Date.now() - new Date(n.time).getTime()) < 6 * 3_600_000).length;
  const burst = recentCount >= 3;

  // A blocking event only counts while it is still fresh — an old merger
  // headline should not veto a trade forever.
  const blocking = found.find(f => f.blocks && f.weight >= 1.3) || null;

  const magnitude = Math.abs(net);
  const netDirection = magnitude < 4 ? 'neutral'
                     : net > 0 ? 'bullish'
                     : 'bearish';

  return {
    catalysts: found.slice(0, 5),
    primary,
    netDirection,
    netScore: parseFloat(net.toFixed(1)),
    breaking,
    burst,
    blocking,
    headlineCount: news.length
  };
}

/**
 * Convert the catalyst picture into signal entries so it influences direction
 * selection, not just the display.
 */
export function catalystSignals(analysis) {
  const signals = [], warnings = [];
  if (!analysis?.catalysts?.length) return { signals, warnings };

  for (const c of analysis.catalysts.slice(0, 3)) {
    if (c.weight < 0.8) continue;   // stale — do not let it vote
    if (c.direction === 'volatile') {
      warnings.push({ type: 'warning', text: `${c.label} (${c.age}) — direction unclear, expect volatility` });
    } else {
      signals.push({
        type: c.direction,
        text: `${c.label} (${c.age})${c.impact >= 8 ? ' — major catalyst' : ''}`
      });
    }
  }

  if (analysis.burst) {
    warnings.push({ type: 'warning', text: 'Unusual news volume — an event is developing right now' });
  }
  return { signals, warnings };
}
