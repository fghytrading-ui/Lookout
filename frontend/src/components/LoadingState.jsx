export default function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-6">
      <div className="flex gap-2">
        {[0, 1, 2, 3, 4].map(i => (
          <div
            key={i}
            className="w-1.5 h-8 rounded-full bg-green-500/30"
            style={{ animation: `pulse 1.2s ease-in-out ${i * 0.15}s infinite` }}
          />
        ))}
      </div>
      <div className="text-center">
        <div className="text-[#444] text-sm font-mono tracking-widest mb-1">SCANNING MARKETS</div>
        <div className="text-[#2a2a2a] text-xs font-mono">
          Fetching live prices · Running analyst filter · Ranking setups
        </div>
      </div>
    </div>
  );
}
