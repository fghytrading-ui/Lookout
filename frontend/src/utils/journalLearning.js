// Trade Journal Learning — analyses your closed trades to find patterns
// of what works for YOU specifically, then biases future signals accordingly.
import { loadJournal } from '../components/TradeJournal.jsx';

const MIN_SAMPLE_FOR_INSIGHT = 4; // Need ≥4 trades in a category to draw conclusions

// Compute personalized insights from your trade history
export function getPersonalInsights() {
  const journal = loadJournal();
  if (journal.length < 5) {
    return { sampleSize: journal.length, ready: false, insights: [], adjustments: {} };
  }

  const insights = [];
  const adjustments = {}; // confidence adjustments to apply to future trades

  // Group helpers
  const groupBy = (arr, fn) => arr.reduce((acc, t) => {
    const key = fn(t);
    (acc[key] = acc[key] || []).push(t);
    return acc;
  }, {});

  const winRate = (trades) => {
    const decided = trades.filter(t => t.win != null);
    if (!decided.length) return 0;
    return decided.filter(t => t.win).length / decided.length * 100;
  };

  // 1. Long vs Short performance
  const byDir = groupBy(journal, t => t.direction);
  for (const [dir, trades] of Object.entries(byDir)) {
    if (trades.length >= MIN_SAMPLE_FOR_INSIGHT) {
      const wr = winRate(trades);
      const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
      if (wr < 40) {
        insights.push({
          type: 'avoid',
          text: `Your ${dir} trades win only ${wr.toFixed(0)}% (${trades.length} trades, total $${totalPnl.toFixed(0)}) — consider avoiding ${dir} setups`
        });
        adjustments[`direction_${dir}`] = -10; // -10 confidence on this direction
      } else if (wr > 65) {
        insights.push({
          type: 'edge',
          text: `Your ${dir} trades win ${wr.toFixed(0)}% (${trades.length} trades, $${totalPnl.toFixed(0)} P&L) — this is your edge`
        });
        adjustments[`direction_${dir}`] = +5;
      }
    }
  }

  // 2. Day of week performance
  const byDay = groupBy(journal, t => new Date(t.enteredAt).getDay());
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (const [day, trades] of Object.entries(byDay)) {
    if (trades.length >= MIN_SAMPLE_FOR_INSIGHT) {
      const wr = winRate(trades);
      if (wr < 35) {
        insights.push({
          type: 'avoid',
          text: `Your ${dayNames[day]} trades only win ${wr.toFixed(0)}% — consider avoiding entries on ${dayNames[day]}`
        });
        adjustments[`day_${day}`] = -8;
      } else if (wr > 70) {
        insights.push({
          type: 'edge',
          text: `Your ${dayNames[day]} trades win ${wr.toFixed(0)}% — your best day`
        });
        adjustments[`day_${day}`] = +5;
      }
    }
  }

  // 3. R-multiple performance
  const profitableRs = journal.filter(t => t.rMultiple > 0);
  const losingRs = journal.filter(t => t.rMultiple < 0);
  if (profitableRs.length >= MIN_SAMPLE_FOR_INSIGHT) {
    const avgWin = profitableRs.reduce((s, t) => s + t.rMultiple, 0) / profitableRs.length;
    const avgLoss = losingRs.length ? losingRs.reduce((s, t) => s + Math.abs(t.rMultiple), 0) / losingRs.length : 0;
    if (avgWin < 1.5 && profitableRs.length > 0) {
      insights.push({
        type: 'tip',
        text: `Your avg winner is only ${avgWin.toFixed(1)}R — you may be taking profit too early. Consider letting winners run.`
      });
    }
    if (avgLoss > 1.2) {
      insights.push({
        type: 'tip',
        text: `Your avg loser is ${avgLoss.toFixed(1)}R — bigger than 1R means you're not honouring stops fast enough.`
      });
    }
  }

  // 4. Overall stats
  const overall = winRate(journal);
  const totalPnL = journal.reduce((s, t) => s + (t.pnl || 0), 0);
  insights.unshift({
    type: 'summary',
    text: `${journal.length} trades · ${overall.toFixed(0)}% win rate · ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(0)} total P&L`
  });

  return {
    sampleSize: journal.length,
    ready: true,
    insights,
    adjustments,
    overallWinRate: overall
  };
}

// Apply learning adjustments to a trade's confidence score
export function applyLearningToConfidence(trade, adjustments) {
  let adj = 0;
  if (adjustments[`direction_${trade.direction}`]) adj += adjustments[`direction_${trade.direction}`];
  const day = new Date().getDay();
  if (adjustments[`day_${day}`]) adj += adjustments[`day_${day}`];
  return Math.max(0, Math.min(99, (trade.confidence || 50) + adj));
}
