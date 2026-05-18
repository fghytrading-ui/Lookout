import { useEffect, useState } from 'react';
import EconomicCalendar from '../components/EconomicCalendar.jsx';
import TonightsCatalyst from '../components/TonightsCatalyst.jsx';
import MacroAlertBar from '../components/MacroAlertBar.jsx';

export default function CalendarPage() {
  const [events, setEvents]       = useState([]);
  const [catalysts, setCatalysts] = useState([]);
  const [macro, setMacro]         = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/calendar/events');
        const d = await r.json();
        setEvents(d.events || []);
        setCatalysts(d.catalysts || []);
        setMacro(d.macro || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-5">
      <div className="mb-5">
        <h1 className="text-2xl font-condensed font-bold tracking-widest text-purple-400 mb-1">📅 ECONOMIC CALENDAR</h1>
        <p className="text-[11px] text-[#444] font-mono">High-impact events that move markets — plan trades around these dates</p>
      </div>

      <MacroAlertBar context={macro} />

      <div className="mt-5">
        <TonightsCatalyst catalysts={catalysts} />
        <EconomicCalendar events={events} />
      </div>

      {loading && (
        <div className="text-center py-8 text-[#444] text-xs font-mono">Loading calendar…</div>
      )}
    </div>
  );
}
