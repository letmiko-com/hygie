// A clinical audiogram: frequency on a log axis (125 Hz to 8 kHz), hearing
// level in dB HL downwards (0 at the top, louder thresholds lower), left ear
// as crosses, right ear as circles, the audiology convention. A clamped
// point (device range reached) is drawn hollow.
import type { AudiogramPoint } from '@/lib/queries/hearing';

const FREQS = [125, 250, 500, 1000, 2000, 4000, 8000];
const DB_MIN = -10;
const DB_MAX = 120;

export function AudiogramChart({
  points,
  ariaLabel,
  labels,
  height = 300,
}: {
  points: AudiogramPoint[];
  ariaLabel: string;
  labels: { left: string; right: string; hz: string; dbHl: string };
  height?: number;
}) {
  const width = 640;
  const padL = 44;
  const padR = 16;
  const padT = 14;
  const padB = 32;
  const x = (hz: number) => padL + ((Math.log2(hz) - Math.log2(125)) / (Math.log2(8000) - Math.log2(125))) * (width - padL - padR);
  const y = (db: number) => padT + ((Math.max(DB_MIN, Math.min(DB_MAX, db)) - DB_MIN) / (DB_MAX - DB_MIN)) * (height - padT - padB);
  const side = (s: 'left' | 'right') =>
    points.filter((p) => p.side === s && !p.masked).sort((a, b) => a.frequencyHz - b.frequencyHz);
  const left = side('left');
  const right = side('right');
  const line = (pts: AudiogramPoint[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.frequencyHz).toFixed(1)} ${y(p.sensitivityDbHl).toFixed(1)}`).join('');
  const colorL = 'var(--data-distance)';
  const colorR = 'var(--data-heart)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
        {Array.from({ length: (DB_MAX - DB_MIN) / 10 + 1 }, (_, i) => DB_MIN + i * 10).map((db) => (
          <g key={db}>
            <line x1={padL} x2={width - padR} y1={y(db)} y2={y(db)} stroke={db === 0 || db === 20 ? 'var(--border-strong)' : 'var(--border)'} strokeWidth={db === 20 ? 1.2 : 0.8} />
            {db % 20 === 0 && (
              <text x={padL - 8} y={y(db) + 3.5} textAnchor="end" className="tnum" style={{ font: '500 8px var(--font-data)', fill: 'var(--text-3)' }}>
                {db}
              </text>
            )}
          </g>
        ))}
        {FREQS.map((hz) => (
          <g key={hz}>
            <line x1={x(hz)} x2={x(hz)} y1={padT} y2={height - padB} stroke="var(--border)" strokeWidth={0.8} />
            <text x={x(hz)} y={height - padB + 16} textAnchor="middle" className="tnum" style={{ font: '500 8px var(--font-data)', fill: 'var(--text-3)' }}>
              {hz >= 1000 ? `${hz / 1000}k` : hz}
            </text>
          </g>
        ))}
        <text x={width - padR} y={height - 4} textAnchor="end" style={{ font: '400 8px var(--font-ui)', fill: 'var(--text-3)' }}>
          {labels.hz}
        </text>
        <text x={padL - 8} y={padT - 4} textAnchor="end" style={{ font: '400 8px var(--font-ui)', fill: 'var(--text-3)' }}>
          {labels.dbHl}
        </text>
        {right.length > 1 && <path d={line(right)} fill="none" stroke={colorR} strokeWidth={1.6} />}
        {left.length > 1 && <path d={line(left)} fill="none" stroke={colorL} strokeWidth={1.6} />}
        {right.map((p) => (
          <circle key={`r${p.frequencyHz}`} cx={x(p.frequencyHz)} cy={y(p.sensitivityDbHl)} r={5} fill={p.clamped ? 'var(--surface)' : colorR} stroke={colorR} strokeWidth={2} />
        ))}
        {left.map((p) => {
          const cx = x(p.frequencyHz);
          const cy = y(p.sensitivityDbHl);
          return (
            <g key={`l${p.frequencyHz}`} stroke={colorL} strokeWidth={2.2} strokeLinecap="round" opacity={p.clamped ? 0.55 : 1}>
              <line x1={cx - 5} y1={cy - 5} x2={cx + 5} y2={cy + 5} />
              <line x1={cx - 5} y1={cy + 5} x2={cx + 5} y2={cy - 5} />
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 18, font: '400 var(--text-xs)/1 var(--font-ui)', color: 'var(--text-2)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ color: colorL, fontWeight: 700 }}>×</span> {labels.left}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ color: colorR, fontWeight: 700 }}>○</span> {labels.right}
        </span>
      </div>
    </div>
  );
}
