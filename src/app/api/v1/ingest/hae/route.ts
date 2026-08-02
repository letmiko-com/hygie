// POST /api/v1/ingest/hae — Health Auto Export push endpoint.
// Thin shell: all logic lives in src/lib/ingest/receive.ts.
import { receiveHaeBatch } from '@/lib/ingest/receive';

// Route handlers are dynamic for POST, but be explicit: this endpoint must never
// be cached or statically analyzed, and it needs the Node runtime (fs, crypto, pg).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  return receiveHaeBatch(req);
}
