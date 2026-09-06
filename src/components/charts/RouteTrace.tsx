// GPS trace of a session as an SVG, over map tiles when the instance has
// them (src/lib/tiles.ts), on a blank panel otherwise. Tiles come from this
// server's own proxy (/api/tiles), never from a third party the browser
// would talk to. Projection is Web Mercator at the zoom where the track's
// bounding box fits the frame, the same projection the tiles use, so the
// line sits exactly on the roads. Below, the altitude profile against
// cumulative distance when the fixes carry an altitude.
import { ABSENT } from '@/lib/format';
import { fitZoom, MAX_TILE_ZOOM, mercator, TILE_SIZE } from '@/lib/tiles';

export interface TracePoint {
  lat: number;
  lon: number;
  altitudeM: number | null;
}

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
  tiles = null,
  height = 400,
}: {
  points: TracePoint[];
  color: string;
  ariaLabel: string;
  labels: { start: string; end: string; elevation: string; distance: string; scale: (m: number) => string };
  format: { km: (m: number) => string; m: (v: number) => string };
  /** Attribution line of the tile provider; null draws the trace alone. */
  tiles?: { attribution: string } | null;
  height?: number;
}) {
  if (points.length < 2) return <div style={{ height, color: 'var(--text-3)' }}>{ABSENT}</div>;

  // Wide frame: the panel is wider than tall, and a wider frame lets fitZoom
  // pick one more level of detail for the usual ride or run.
  const width = 960;
  const pad = 24;
  const pts = thin(points, 2500);
  const bounds = {
    minLat: Math.min(...pts.map((p) => p.lat)),
    maxLat: Math.max(...pts.map((p) => p.lat)),
    minLon: Math.min(...pts.map((p) => p.lon)),
    maxLon: Math.max(...pts.map((p) => p.lon)),
  };
  // Fractional fit: tiles one level finer than the integer zoom that fits,
  // scaled down by k in (0.5, 1] so the track fills the frame whatever its
  // aspect ratio. Downscaled tiles stay crisp; a whole level too wide would
  // leave a short ride as a small figure in a large map.
  const frameW = width - 2 * pad;
  const frameH = height - 2 * pad;
  const zFit = fitZoom(bounds, frameW, frameH);
  const z = Math.min(zFit + 1, MAX_TILE_ZOOM);
  const nw = mercator(bounds.maxLat, bounds.minLon, z);
  const se = mercator(bounds.minLat, bounds.maxLon, z);
  const k = Math.min(1, frameW / Math.max(1, se.x - nw.x), frameH / Math.max(1, se.y - nw.y));
  // Scaled world pixels at zoom z; the frame is centred on the bounding box.
  const originX = ((nw.x + se.x) / 2) * k - width / 2;
  const originY = ((nw.y + se.y) / 2) * k - height / 2;
  const project = (p: TracePoint) => {
    const m = mercator(p.lat, p.lon, z);
    return { x: m.x * k - originX, y: m.y * k - originY };
  };
  const projected = pts.map(project);
  const path = projected.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('');

  // Tiles covering the frame, positioned and sized in the same scaled space.
  const tilePx = TILE_SIZE * k;
  const tileImages: Array<{ x: number; y: number; tx: number; ty: number }> = [];
  if (tiles) {
    const worldTiles = 2 ** z;
    const tx0 = Math.floor(originX / tilePx);
    const tx1 = Math.floor((originX + width) / tilePx);
    const ty0 = Math.max(0, Math.floor(originY / tilePx));
    const ty1 = Math.min(worldTiles - 1, Math.floor((originY + height) / tilePx));
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        tileImages.push({
          x: tx * tilePx - originX,
          y: ty * tilePx - originY,
          tx: ((tx % worldTiles) + worldTiles) % worldTiles, // wrap around the antimeridian
          ty,
        });
      }
    }
  }

  // Metres per frame pixel at this latitude, zoom and scale, for the scale bar.
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const metresPerPx = (156_543.03392 * Math.cos((midLat * Math.PI) / 180)) / (2 ** z * k);
  const barM = niceScale(((width - 2 * pad) / 3) * metresPerPx);
  const barPx = barM / metresPerPx;

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

  const first = projected[0];
  const last = projected[projected.length - 1];
  // A loop ends where it started: one marker, one combined label.
  const loop = Math.hypot(last.x - first.x, last.y - first.y) < 14;
  const labelFont = '500 9px var(--font-ui)';
  const onMap = tiles !== null;
  // Over a map the labels need a halo to stay legible on any tile.
  const halo = onMap ? { paintOrder: 'stroke' as const, stroke: 'var(--surface)', strokeWidth: 3, strokeLinejoin: 'round' as const } : {};
  const ink = onMap ? 'var(--text-1)' : 'var(--text-2)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', borderRadius: 'var(--r-md)' }}
      >
        {onMap && (
          <g className="hy-map-tiles">
            {tileImages.map((t) => (
              <image
                key={`${t.tx}-${t.ty}`}
                href={`/api/tiles/${z}/${t.tx}/${t.ty}`}
                x={t.x}
                y={t.y}
                width={tilePx + 0.5}
                height={tilePx + 0.5}
                preserveAspectRatio="none"
              />
            ))}
          </g>
        )}
        {onMap && (
          <path d={path} fill="none" stroke="var(--surface)" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
        )}
        <path d={path} fill="none" stroke={color} strokeWidth={onMap ? 3 : 2.4} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
        {!loop && <circle cx={last.x} cy={last.y} r={5} fill="var(--surface)" stroke="var(--text-1)" strokeWidth={2.5} />}
        <circle cx={first.x} cy={first.y} r={5} fill="var(--surface)" stroke="var(--ok)" strokeWidth={2.5} />
        <text x={first.x + 9} y={first.y + 3.5} style={{ font: labelFont, fill: ink, ...halo }}>
          {loop ? `${labels.start} · ${labels.end}` : labels.start}
        </text>
        {!loop && (
          <text x={last.x + 9} y={last.y + 3.5} style={{ font: labelFont, fill: ink, ...halo }}>
            {labels.end}
          </text>
        )}
        <g transform={`translate(${width - pad - barPx}, ${height - pad})`}>
          <line x1={0} y1={0} x2={barPx} y2={0} stroke={ink} strokeWidth={2} />
          <line x1={0} y1={-4} x2={0} y2={4} stroke={ink} strokeWidth={2} />
          <line x1={barPx} y1={-4} x2={barPx} y2={4} stroke={ink} strokeWidth={2} />
          <text x={barPx / 2} y={-6} textAnchor="middle" className="tnum" style={{ font: '500 9px var(--font-data)', fill: ink, ...halo }}>
            {labels.scale(barM)}
          </text>
        </g>
        {onMap && tiles.attribution && (
          <text x={pad} y={height - 8} style={{ font: '400 8px var(--font-ui)', fill: 'var(--text-2)', ...halo }}>
            {tiles.attribution}
          </text>
        )}
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
