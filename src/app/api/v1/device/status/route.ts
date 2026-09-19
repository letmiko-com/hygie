// GET /api/v1/device/status — what the server made of this device's batches,
// for the diagnostic screen of Hygie Sync. Thin shell: the logic and the
// contract live in src/lib/ingest/device-status.ts and docs/native-format.md.
import { deviceStatusResponse } from '@/lib/ingest/device-status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  return deviceStatusResponse(req);
}
