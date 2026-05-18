const TYPE_STYLES = {
  policy:       { bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   text: 'text-blue-300' },
  energy:       { bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  text: 'text-amber-300' },
  geopolitical: { bg: 'bg-red-500/10',    border: 'border-red-500/30',    text: 'text-red-300' },
  macro:        { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-300' },
  dollar:       { bg: 'bg-cyan-500/10',   border: 'border-cyan-500/30',   text: 'text-cyan-300' },
  technicals:   { bg: 'bg-green-500/10',  border: 'border-green-500/30',  text: 'text-green-300' }
};

export default function MacroAlertBar({ context }) {
  if (!context?.length) return null;

  return (
    <div className="px-4 py-2 bg-[#080808] border-b border-[#151515]">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-bold tracking-widest text-[#444] uppercase">Macro Context</span>
        <div className="flex-1 h-px bg-[#151515]" />
      </div>
      <div className="flex flex-wrap gap-2">
        {context.map((item, i) => {
          const style = TYPE_STYLES[item.type] || TYPE_STYLES.macro;
          return (
            <div
              key={i}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-mono ${style.bg} ${style.border}`}
            >
              <span>{item.icon}</span>
              <span className={style.text}>{item.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
