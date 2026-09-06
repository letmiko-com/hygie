// Map tiles under the GPS trace: configuration and the Web Mercator maths the
// trace and the tile grid share. Server-only for the configuration (env), pure
// for the maths.
//
// HYGIE_TILE_URL: upstream template with {z} {x} {y} (and optional {s}), read
// by the proxy route; "off" disables the map entirely (the trace then draws
// on a blank panel, exactly as before). HYGIE_TILE_ATTRIBUTION: the credit
// line the provider requires, drawn on the map.

export interface TileConfig {
  url: string;
  attribution: string;
  userAgent: string;
}

const DEFAULT_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION = '© OpenStreetMap contributors';

export function tileConfig(): TileConfig | null {
  const raw = (process.env.HYGIE_TILE_URL ?? '').trim();
  if (raw.toLowerCase() === 'off') return null;
  const url = raw === '' ? DEFAULT_URL : raw;
  if (!url.includes('{z}') || !url.includes('{x}') || !url.includes('{y}')) return null;
  const attribution = (process.env.HYGIE_TILE_ATTRIBUTION ?? '').trim() || (url === DEFAULT_URL ? DEFAULT_ATTRIBUTION : '');
  return {
    url,
    attribution,
    // The OSM tile usage policy asks for a User-Agent that identifies the
    // application and a way to contact its operator.
    userAgent: `Hygie/${process.env.npm_package_version ?? '0'} (self-hosted; +https://github.com/letmiko-com/hygie)`,
  };
}

export const TILE_SIZE = 256;
export const MAX_FIT_ZOOM = 17;
/** Finest tiles the trace ever asks for (OSM serves up to 19). */
export const MAX_TILE_ZOOM = 18;

/** World pixel coordinates of a lat/lon at zoom z (Web Mercator, 256 px tiles). */
export function mercator(lat: number, lon: number, z: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** z;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale,
  };
}

/** The largest zoom (≤ MAX_FIT_ZOOM) at which the bounding box fits the frame. */
export function fitZoom(
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  frameW: number,
  frameH: number
): number {
  for (let z = MAX_FIT_ZOOM; z >= 1; z--) {
    const a = mercator(bounds.maxLat, bounds.minLon, z);
    const b = mercator(bounds.minLat, bounds.maxLon, z);
    if (b.x - a.x <= frameW && b.y - a.y <= frameH) return z;
  }
  return 1;
}
