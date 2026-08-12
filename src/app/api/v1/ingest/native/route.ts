// POST /api/v1/ingest/native — Hygie Sync (iOS) push endpoint, hygie-native/1.
// Thin shell: all logic lives in src/lib/ingest/receive.ts; the format contract
// is docs/native-format.md.
import { receiveNativeBatch } from '@/lib/ingest/receive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  return receiveNativeBatch(req);
}
