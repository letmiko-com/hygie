'use server';
// Device pairing actions. The raw key travels only through the action's
// return value into the client panel that displays it once: never in a URL,
// never in a log, never stored.
import { revalidatePath } from 'next/cache';
import { createDevice, revokeDevice } from '@/lib/devices';
import { getSubjectContext } from '@/lib/queries/context';

export interface PairResult {
  ok: boolean;
  deviceName?: string;
  rawKey?: string;
  error?: 'invalid' | 'unauthorized';
}

export async function pairDeviceAction(_prev: PairResult | null, formData: FormData): Promise<PairResult> {
  const ctx = await getSubjectContext();
  if (!ctx) return { ok: false, error: 'unauthorized' };

  const name = String(formData.get('name') ?? '').trim();
  const platform = String(formData.get('platform') ?? '').trim() || null;
  if (name.length === 0 || name.length > 80 || (platform !== null && platform.length > 40)) {
    return { ok: false, error: 'invalid' };
  }

  const created = await createDevice(ctx, name, platform);
  revalidatePath('/devices');
  return { ok: true, deviceName: name, rawKey: created.rawKey };
}

export async function revokeDeviceAction(formData: FormData): Promise<void> {
  const ctx = await getSubjectContext();
  if (!ctx) return;
  const id = String(formData.get('deviceId') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await revokeDevice(ctx, id);
  revalidatePath('/devices');
}
