// Tiny inline SVG sparkline — last 20 daily closes
export default function Sparkline({ data, direction, width = 90, height = 24 }) {
  if (!data || data.length < 3) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(' ');
  const last  = data[data.length - 1];
  const first = data[0];
  const isUp  = last >= first;
  const stroke = direction === 'LONG' ? (isUp ? '#00ff88' : '#ff8855') :
                 direction === 'SHORT' ? (isUp ? '#88aaff' : '#ff3355') :
                 isUp ? '#00ff88' : '#ff3355';

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline fill="none" stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" points={points} opacity="0.85" />
      <circle cx={width} cy={height - ((last - min) / range) * height} r="1.8" fill={stroke} />
    </svg>
  );
}
