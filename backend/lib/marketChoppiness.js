// Market regime detector — distinguishes TRENDING from CHOPPY markets.
// In choppy markets, technical signals fail more often. Pros sit out.
// Uses Efficiency Ratio: ratio of net move to total movement.
import { fetchFull } from './yahoo.js';

export async function getMarketChoppiness() {
  try {
    const spy = await fetchFull('SPY', '1mo');
    const closes = spy.candles.map(c => c.close);
    if (closes.length < 12) return { regime: 'unknown', score: null };

    const recent10 = closes.slice(-10);
    const netMove = recent10[recent10.length - 1] - recent10[0];
    const netMovePct = (netMove / recent10[0]) * 100;

    // Sum of absolute daily moves
    let totalAbsMove = 0;
    for (let i = 1; i < recent10.length; i++) {
      totalAbsMove += Math.abs(recent10[i] - recent10[i - 1]);
    }
    const totalAbsMovePct = (totalAbsMove / recent10[0]) * 100;

    // Efficiency Ratio: net direction / total movement
    // 1.0 = perfect trend, 0.0 = pure chop
    const efficiency = totalAbsMovePct > 0 ? Math.abs(netMove / totalAbsMove) : 0;

    let regime, label, advice;
    if (efficiency >= 0.55) {
      regime = 'STRONG_TREND';
      label  = netMovePct > 0 ? 'Strong Uptrend' : 'Strong Downtrend';
      advice = 'Trend-following setups have the highest win rate right now';
    } else if (efficiency >= 0.35) {
      regime = 'TRENDING';
      label  = netMovePct > 0 ? 'Uptrend' : 'Downtrend';
      advice = 'Healthy trend — standard setups work';
    } else if (efficiency >= 0.20) {
      regime = 'MIXED';
      label  = 'Mixed / Drifting';
      advice = 'Be selective — only take A+ setups';
    } else {
      regime = 'CHOPPY';
      label  = 'Choppy / Range-Bound';
      advice = 'High false-signal rate — consider sitting on hands';
    }

    return {
      regime,
      label,
      advice,
      efficiency: Math.round(efficiency * 100) / 100,
      netMovePct: Math.round(netMovePct * 10) / 10,
      direction: netMovePct > 0 ? 'up' : 'down'
    };
  } catch {
    return { regime: 'unknown', score: null };
  }
}
