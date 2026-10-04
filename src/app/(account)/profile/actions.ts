'use server';
// Profile actions. The session user is re-derived on every call: a server
// action is a public endpoint, and an account only ever edits itself.
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/queries/context';
import { isKnownTimezone, updateProfile } from '@/lib/queries/profile';

export type ProfileResult = { ok: true } | { ok: false; error: 'invalid' | 'unauthorized' };

function intlKnowsZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateProfileAction(_prev: ProfileResult | null, formData: FormData): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'unauthorized' };

  const name = String(formData.get('name') ?? '').trim();
  const locale = formData.get('locale') === 'en' ? 'en' : 'fr';
  const rawZone = formData.get('timezone');
  const timezone = rawZone === null ? null : String(rawZone).trim();
  if (name.length === 0 || name.length > 80) return { ok: false, error: 'invalid' };
  // Both must know the zone: Intl formats the times, Postgres cuts the days.
  if (timezone !== null && (timezone.length > 64 || !intlKnowsZone(timezone) || !(await isKnownTimezone(timezone)))) {
    return { ok: false, error: 'invalid' };
  }

  await updateProfile(user, { name, locale, timezone });
  // The name and the language show on every screen, through the shell.
  revalidatePath('/', 'layout');
  return { ok: true };
}
