// GPS trace of a session as a plain SVG: no tiles, no third party. A trace
// is a fact about the session (where it went, how it climbed); a map
// background is not, and would ship every location to a tile server. The
// projection is equirectangular around the track's mean latitude, which is
// exact enough for a workout-sized area. Below the trace, the altitude
// profile against cumulative distance when the fixes carry an altitude.
import { ABSENT } from '@/lib/format';

export interface TracePoint {
  lat: number;
  lon: number;
  altitudeM: number | null;
}

const EARTH_M_PER_DEG = 111_320;

function haversineM(a: TracePoint, b: TracePoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Keeps at most `target` points, first and last always included. */
function thin<T>(points: T[], target: number): T[] {
  if (points.length <= target) return points;
  const step = (points.length - 1) / (target - 1);
  const out: T[] = [];
  for (let i = 0; i < target; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** A round scale-bar length (m) that fits within `maxM`. */
function niceScale(maxM: number): number {
  const candidates = [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000];
  let pick = candidates[0];
  for (const c of candidates) if (c <= maxM) pick = c;
  return pick;
}

export function RouteTrace({
  points,
  color,
  ariaLabel,
  labels,
  format,
  height = 280,
}: {
  points: TracePoint[];
  color: string;
  ariaLabel: string;
  labels: { start: string; end: string; elevation: string; distance: string; scale: (m: number) => string };
  format: { km: (m: number) => string; m: (v: number) => string };
  height?: number;
}) {
  if (points.length < 2) return <div style={{ height, color: 'var(--text-3)' }}>{ABSENT}</div>;

  const width = 720;
  const pad = 16;
  const pts = thin(points, 2500);
  const meanLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const kx = Math.cos((meanLat * Math.PI) / 180);
  // Metres east / north of the south-west corner.
  const xs = pts.map((p) => p.lon * kx * EARTH_M_PER_DEG);
  const ys = pts.map((p) => p.lat * EARTH_M_PER_DEG);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const px = (i: number) => offX + (xs[i] - minX) * scale;
  const py = (i: number) => height - offY - (ys[i] - minY) * scale;
  const path = pts.map((_, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)} ${py(i).toFixed(1)}`).join('');

  const barM = niceScale((width - 2 * pad) / scale / 3);
  const barPx = barM * scale;

  // Altitude profile against cumulative distance, on the thinned track.
  const altitudes = pts.map((p) => p.altitudeM);
  const hasAlt = altitudes.some((a) => a !== null);
  let totalM = 0;
  const cumulative = pts.map((p, i) => {
    if (i > 0) totalM += haversineM(pts[i - 1], p);
    return totalM;
  });
  let profile: string | null = null;
  let altMin = 0;
  let altMax = 0;
  const profileH = 90;
  if (hasAlt) {
    const present = altitudes.filter((a): a is number => a !== null);
    altMin = Math.min(...present);
    altMax = Math.max(...present);
    const span = Math.max(1, altMax - altMin);
    const cmds: string[] = [];
    pts.forEach((p, i) => {
      if (p.altitudeM === null) return;
      const x = pad + (totalM > 0 ? (cumulative[i] / totalM) * (width - 2 * pad) : 0);
      const y = 8 + (1 - (p.altitudeM - altMin) / span) * (profileH - 24);
      cmds.push(`${cmds.length === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
    });
    profile = cmds.join('');
  }

  const last = pts.length - 1;
  // A loop ends where it started: one marker, one combined label, instead of
  // two labels printed over each other.
  const loop = Math.hypot(px(last) - px(0), py(last) - py(0)) < 14;
  const labelFont = '500 9px var(--font-ui)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', maxHeight: height }}
      >
        <path d={path} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" opacity={0.92} />
        {!loop && <circle cx={px(last)} cy={py(last)} r={5} fill="var(--surface)" stroke="var(--text-1)" strokeWidth={2.5} />}
        <circle cx={px(0)} cy={py(0)} r={5} fill="var(--surface)" stroke="var(--ok)" strokeWidth={2.5} />
        <text x={px(0) + 9} y={py(0) + 3.5} style={{ font: labelFont, fill: 'var(--text-2)' }}>
          {loop ? `${labels.start} · ${labels.end}` : labels.start}
        </text>
        {!loop && (
          <text x={px(last) + 9} y={py(last) + 3.5} style={{ font: labelFont, fill: 'var(--text-2)' }}>
            {labels.end}
          </text>
        )}
        <g transform={`translate(${width - pad - barPx}, ${height - pad})`}>
          <line x1={0} y1={0} x2={barPx} y2={0} stroke="var(--text-2)" strokeWidth={2} />
          <line x1={0} y1={-4} x2={0} y2={4} stroke="var(--text-2)" strokeWidth={2} />
          <line x1={barPx} y1={-4} x2={barPx} y2={4} stroke="var(--text-2)" strokeWidth={2} />
          <text x={barPx / 2} y={-6} textAnchor="middle" className="tnum" style={{ font: '500 9px var(--font-data)', fill: 'var(--text-2)' }}>
            {labels.scale(barM)}
          </text>
        </g>
      </svg>
      {profile && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-3)', padding: '0 2px 4px' }}>
            <span>{labels.elevation}</span>
            <span className="tnum">
              {format.m(altMin)} → {format.m(altMax)}
            </span>
          </div>
          <svg viewBox={`0 0 ${width} ${profileH}`} width="100%" height="auto" aria-hidden style={{ display: 'block' }}>
            <path d={`${profile} L${(width - pad).toFixed(1)} ${profileH - 12} L${pad} ${profileH - 12} Z`} fill={color} opacity={0.14} />
            <path d={profile} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
            <text x={pad} y={profileH - 1} className="tnum" style={{ font: '500 8px var(--font-data)', fill: 'var(--text-3)' }}>
              0
            </text>
            <text x={width - pad} y={profileH - 1} textAnchor="end" className="tnum" style={{ font: '500 8px var(--font-data)', fill: 'var(--text-3)' }}>
              {labels.distance} {format.km(totalM)}
            </text>
          </svg>
        </div>
      )}
    </div>
  );
}
