// An ECG trace on standard paper: 25 mm/s, 10 mm/mV, drawn in strips of ten
// seconds so a 30 s recording reads as three lines. The grid is the small
// square (0.04 s × 0.1 mV) and the large one (0.2 s × 0.5 mV); the scale is
// the same on every strip, whatever the recording's amplitude.
const MM_PER_S = 25;
const MM_PER_MV = 10;
const PX_PER_MM = 4;
const STRIP_S = 10;
const STRIP_MV = 3; // ±1.5 mV of paper per strip

export function EcgTrace({
  voltagesUv,
  samplingHz,
  color = 'var(--data-heart)',
  ariaLabel,
  stripLabel,
}: {
  voltagesUv: number[];
  samplingHz: number;
  color?: string;
  ariaLabel: string;
  stripLabel: (fromS: number, toS: number) => string;
}) {
  const width = STRIP_S * MM_PER_S * PX_PER_MM; // 1000
  const height = STRIP_MV * MM_PER_MV * PX_PER_MM; // 120
  const perStrip = Math.round(STRIP_S * samplingHz);
  const strips: number[][] = [];
  for (let i = 0; i < voltagesUv.length; i += perStrip) strips.push(voltagesUv.slice(i, i + perStrip));
  const small = PX_PER_MM;
  const large = PX_PER_MM * 5;
  const pxPerSample = (MM_PER_S * PX_PER_MM) / samplingHz;
  const pxPerUv = (MM_PER_MV * PX_PER_MM) / 1000;
  const mid = height / 2;

  return (
    <div role="img" aria-label={ariaLabel} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {strips.map((strip, si) => {
        let d = '';
        for (let i = 0; i < strip.length; i++) {
          const x = i * pxPerSample;
          const y = mid - Math.max(-STRIP_MV * 500, Math.min(STRIP_MV * 500, strip[i])) * pxPerUv;
          d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
        }
        const from = si * STRIP_S;
        return (
          <div key={si}>
            <div className="tnum" style={{ font: '500 var(--text-2xs)/1 var(--font-data)', color: 'var(--text-3)', marginBottom: 3 }}>
              {stripLabel(from, Math.min(from + STRIP_S, Math.round(voltagesUv.length / samplingHz)))}
            </div>
            <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" aria-hidden style={{ display: 'block', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}>
              <defs>
                <pattern id={`ecg-small-${si}`} width={small} height={small} patternUnits="userSpaceOnUse">
                  <path d={`M ${small} 0 L 0 0 0 ${small}`} fill="none" stroke="var(--border)" strokeWidth={0.5} />
                </pattern>
                <pattern id={`ecg-large-${si}`} width={large} height={large} patternUnits="userSpaceOnUse">
                  <rect width={large} height={large} fill={`url(#ecg-small-${si})`} />
                  <path d={`M ${large} 0 L 0 0 0 ${large}`} fill="none" stroke="var(--border-strong)" strokeWidth={0.8} />
                </pattern>
              </defs>
              <rect width={width} height={height} fill={`url(#ecg-large-${si})`} />
              <path d={d} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
