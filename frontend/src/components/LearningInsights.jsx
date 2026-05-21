import { useState, useEffect } from 'react';
import { getPersonalInsights } from '../utils/journalLearning.js';

export default function LearningInsights({ refreshKey }) {
  const [data, setData] = useState({ ready: false, insights: [], sampleSize: 0 });

  useEffect(() => { setData(getPersonalInsights()); }, [refreshKey]);

  if (!data.ready) {
    return (
      <section className="mb-8">
        <div className="flex items-center gap-3 px-5 py-3 rounded border border-purple-500/20 bg-purple-500/5">
          <span className="text-xl">🧠</span>
          <div className="flex-1">
            <h2 className="text-sm font-bold tracking-widest font-condensed text-purple-400">PERSONALIZED INSIGHTS</h2>
            <p className="text-[10px] text-[#444] font-mono mt-0.5">
              Log {5 - data.sampleSize} more closed trades to unlock pattern detection from your own history
            </p>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-purple-500/25 text-purple-400 bg-purple-500/10">
            {data.sampleSize}/5
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 px-5 py-3 rounded-t border border-purple-500/30 bg-purple-500/8">
        <span className="text-xl">🧠</span>
        <div className="flex-1">
          <h2 className="text-sm font-bold tracking-widest font-condensed text-purple-400">YOUR PERSONALIZED INSIGHTS</h2>
          <p className="text-[10px] text-[#444] font-mono mt-0.5">Patterns learned from your {data.sampleSize} closed trades — adjusts future confidence scores</p>
        </div>
      </div>
      <div className="border border-t-0 border-purple-500/30 rounded-b p-4 space-y-2">
        {data.insights.map((ins, i) => (
          <div key={i} className={`text-[12px] font-mono rounded px-3 py-2 border ${
            ins.type === 'edge'    ? 'bg-green-500/10 border-green-500/30 text-green-300' :
            ins.type === 'avoid'   ? 'bg-red-500/10 border-red-500/30 text-red-300' :
            ins.type === 'tip'     ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
                                      'bg-[#0e0e0e] border-[#1f1f1f] text-[#aaa]'
          }`}>
            {ins.type === 'edge'    && '✓ '}
            {ins.type === 'avoid'   && '✗ '}
            {ins.type === 'tip'     && '💡 '}
            {ins.type === 'summary' && '📊 '}
            {ins.text}
          </div>
        ))}
      </div>
    </section>
  );
}
