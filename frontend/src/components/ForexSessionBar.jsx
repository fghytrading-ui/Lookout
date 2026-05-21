import { Fragment } from 'react';
// Forex session bar — visualizes the four major sessions and highlights active ones
const SESSIONS = [
  { name: 'Sydney',  ukOpen: 22, ukClose:  7, color: 'bg-blue-500',    border: 'border-blue-500' },
  { name: 'Tokyo',   ukOpen:  0, ukClose:  9, color: 'bg-purple-500',  border: 'border-purple-500' },
  { name: 'London',  ukOpen:  8, ukClose: 17, color: 'bg-green-500',   border: 'border-green-500' },
  { name: 'New York',ukOpen: 13, ukClose: 22, color: 'bg-amber-500',   border: 'border-amber-500' }
];

function isSessionActive(s, ukHour) {
  if (s.ukOpen < s.ukClose) return ukHour >= s.ukOpen && ukHour < s.ukClose;
  return ukHour >= s.ukOpen || ukHour < s.ukClose; // wraps midnight
}

export default function ForexSessionBar({ session }) {
  if (!session) return null;

  const ukNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const ukHour = ukNow.getHours() + ukNow.getMinutes() / 60;

  const liquidityColor = session.liquidity === 'PEAK' ? 'text-green-300'
                       : session.liquidity === 'HIGH' ? 'text-green-400'
                       : session.liquidity === 'MEDIUM' ? 'text-amber-400'
                       : session.liquidity === 'LOW' ? 'text-red-400'
                       : 'text-[#666]';

  return (
    <div className="mx-4 mt-3 p-3 rounded border border-[#1a1a1a] bg-[#0a0a0a]">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-[#444] font-mono">FX Sessions · </span>
          <span className={`text-[12px] font-mono font-bold ${liquidityColor}`}>{session.label}</span>
          <span className="text-[10px] text-[#555] font-mono ml-2">· {session.detail}</span>
        </div>
        <div className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
          session.liquidity === 'PEAK'   ? 'bg-green-500/20 border-green-500/40 text-green-300 animate-pulse' :
          session.liquidity === 'HIGH'   ? 'bg-green-500/10 border-green-500/30 text-green-400' :
          session.liquidity === 'MEDIUM' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
          session.liquidity === 'LOW'    ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                                            'bg-[#1a1a1a] border-[#252525] text-[#666]'
        }`}>
          {session.liquidity} LIQUIDITY
        </div>
      </div>

      {/* Visual session timeline */}
      <div className="relative h-7 bg-[#0e0e0e] rounded overflow-hidden border border-[#181818]">
        {SESSIONS.map(s => {
          const active = isSessionActive(s, ukHour);
          let left = (s.ukOpen / 24) * 100;
          let width = ((s.ukClose - s.ukOpen + 24) % 24) / 24 * 100;
          if (s.ukOpen >= s.ukClose) {
            // Wraps midnight — render two pieces inside a Fragment
            return (
              <Fragment key={s.name}>
                <div className={`absolute top-0 h-full ${s.color} ${active ? 'opacity-50' : 'opacity-15'}`}
                     style={{ left: `${left}%`, width: `${((24 - s.ukOpen) / 24) * 100}%` }} />
                <div className={`absolute top-0 h-full ${s.color} ${active ? 'opacity-50' : 'opacity-15'}`}
                     style={{ left: 0, width: `${(s.ukClose / 24) * 100}%` }} />
              </Fragment>
            );
          }
          return (
            <div key={s.name} className={`absolute top-0 h-full ${s.color} ${active ? 'opacity-50' : 'opacity-15'}`}
                 style={{ left: `${left}%`, width: `${width}%` }} />
          );
        })}
        {/* "now" marker */}
        <div className="absolute top-0 h-full w-px bg-white" style={{ left: `${(ukHour / 24) * 100}%` }} />
        {/* Hour labels */}
        <div className="absolute inset-0 flex items-center justify-between px-1 text-[8px] font-mono text-[#666] pointer-events-none">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>

      {/* Session legend */}
      <div className="flex items-center justify-around mt-2 text-[10px] font-mono flex-wrap gap-1">
        {SESSIONS.map(s => {
          const active = isSessionActive(s, ukHour);
          return (
            <div key={s.name} className={`flex items-center gap-1.5 ${active ? 'opacity-100' : 'opacity-40'}`}>
              <div className={`w-2 h-2 rounded-sm ${s.color}`} />
              <span className={active ? 'text-[#ccc] font-bold' : 'text-[#666]'}>{s.name}</span>
              <span className="text-[#444] text-[9px]">{s.ukOpen.toString().padStart(2,'0')}–{s.ukClose.toString().padStart(2,'0')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
