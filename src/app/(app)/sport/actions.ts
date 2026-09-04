'use server';
// Declared maximum heart rate: the one setting the zone accounting reads
// (queries/zones.ts). Saved for the subject of the session, never for another.
import { revalidatePath } from 'next/cache';
import { getSubjectContext } from '@/lib/queries/context';
import { MAX_HR_MAX, MAX_HR_MIN, setDeclaredMaxHr } from '@/lib/queries/settings';

export async function setMaxHrAction(formData: FormData): Promise<void> {
  const ctx = await getSubjectContext();
  if (!ctx) return;
  const raw = String(formData.get('maxHr') ?? '').trim();
  const clear = formData.get('clear') !== null;
  if (clear || raw === '') {
    await setDeclaredMaxHr(ctx, null);
  } else {
    const bpm = Number.parseInt(raw, 10);
    if (!Number.isInteger(bpm) || bpm < MAX_HR_MIN || bpm > MAX_HR_MAX) return;
    await setDeclaredMaxHr(ctx, bpm);
  }
  revalidatePath('/sport');
  revalidatePath('/sport/[id]', 'page');
}
