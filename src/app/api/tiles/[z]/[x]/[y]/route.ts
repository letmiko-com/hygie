// GET /api/tiles/{z}/{x}/{y} — map tiles for the GPS trace, proxied and cached.
//
// The browser never talks to the tile provider: a page that drew tiles
// straight from tile.openstreetmap.org would hand every viewer's IP and the
// area of every ride to a third party, and would need a CSP hole. Here the
// tile request comes from this server (its IP, an identifying User-Agent as
// the OSM tile usage policy asks), the PNG is cached on the data volume, and
// the CSP stays 'self'. The session proxy gates this route like every other
// page: no session, no tile. HYGIE_TILE_URL selects the upstream template
// (default: OpenStreetMap standard tiles) or disables the map with "off".
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { getDataDir } from '@/lib/ingest/receive';
import { tileConfig } from '@/lib/tiles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_ZOOM = 19;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_TILE_BYTES = 2 * 1024 * 1024;
const CACHE_HEADERS = {
  'Content-Type': 'image/png',
  // Map tiles change on the scale of months; a year in the browser cache is safe.
  'Cache-Control': 'private, max-age=31536000, immutable',
};

function parseCoordinate(raw: string, max: number): number | null {
  if (!/^\d{1,7}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= max ? n : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
): Promise<Response> {
  const config = tileConfig();
  if (!config) return new Response('tiles disabled', { status: 404 });

  const p = await params;
  const z = parseCoordinate(p.z, MAX_ZOOM);
  if (z === null) return new Response('bad tile', { status: 400 });
  const extent = 2 ** z - 1;
  const x = parseCoordinate(p.x, extent);
  const y = parseCoordinate(p.y, extent);
  if (x === null || y === null) return new Response('bad tile', { status: 400 });

  const file = join(getDataDir(), 'tiles', String(z), String(x), `${y}.png`);
  try {
    const info = await stat(file);
    if (info.size > 0) {
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
        headers: { ...CACHE_HEADERS, 'Content-Length': String(info.size) },
      });
    }
  } catch {
    // Not cached yet.
  }

  const upstream = config.url
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{s}', 'a');
  let res: Response;
  try {
    res = await fetch(upstream, {
      headers: {
        'User-Agent': config.userAgent,
        Accept: 'image/png,image/*;q=0.8',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return new Response('tile provider unreachable', { status: 502 });
  }
  if (!res.ok) return new Response('tile provider error', { status: 502 });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_TILE_BYTES) {
    return new Response('tile provider error', { status: 502 });
  }
  // Write-then-rename: a reader never sees a half-written tile.
  try {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  } catch {
    // A cache miss is not an error: the tile is still served.
  }
  return new Response(bytes, { headers: { ...CACHE_HEADERS, 'Content-Length': String(bytes.length) } });
}
