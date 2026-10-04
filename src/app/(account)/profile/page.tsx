// Profile: the signed-in account edits its own name (shared with the subject
// it owns), its language, its subject's time zone, and asks to change its
// sign-in address (applied once the new address confirms a link).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getMessages } from '@/lib/i18n';
import { getSessionUser } from '@/lib/queries/context';
import { getProfile } from '@/lib/queries/profile';
import { EmailPanel, ProfileForm } from './ui';

export const metadata: Metadata = { title: 'Profil · Hygie' };
export const dynamic = 'force-dynamic';

/**
 * Monday, Saturday and Sunday: the starts in actual use. A stored value
 * outside them (users.week_start allows 1 to 7) stays listed, so saving the
 * form never changes it silently.
 */
function weekDayChoices(locale: 'fr' | 'en', current: number): Array<{ value: number; label: string }> {
  const fmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', timeZone: 'UTC' });
  const values = [1, 6, 7].includes(current) ? [1, 6, 7] : [1, 6, 7, current].sort((a, b) => a - b);
  // 2024-01-01 was a Monday: ISO weekday d falls on 2024-01-0d.
  return values.map((d) => {
    const name = fmt.format(new Date(Date.UTC(2024, 0, d)));
    return { value: d, label: name.charAt(0).toUpperCase() + name.slice(1) };
  });
}

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const m = getMessages(user.locale);
  const profile = await getProfile(user);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0 }}>{m.profile.title}</h1>
        <span style={{ font: '400 var(--text-sm)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
          {m.profile.subtitle}
        </span>
      </header>
      <ProfileForm
        name={profile.name}
        locale={profile.locale}
        weekStart={profile.weekStart}
        weekDays={weekDayChoices(profile.locale, profile.weekStart)}
        timezone={profile.subject?.timezone ?? null}
        zones={Intl.supportedValuesOf('timeZone')}
        labels={{
          name: m.profile.name,
          nameHint: profile.subject ? m.profile.nameHint : m.profile.nameHintNoSubject,
          locale: m.profile.locale,
          weekStart: m.profile.weekStart,
          weekStartHint: m.profile.weekStartHint,
          timezone: m.profile.timezone,
          timezoneHint: m.profile.timezoneHint,
          save: m.profile.save,
          saved: m.profile.saved,
          invalid: m.profile.invalid,
        }}
      />
      <EmailPanel
        email={profile.email}
        labels={{
          email: m.profile.email,
          emailHint: m.profile.emailHint,
          change: m.profile.emailChange,
          newAddress: m.profile.emailNew,
          send: m.profile.emailSend,
          cancel: m.profile.emailCancel,
          sent: m.profile.emailSent('{to}'),
          same: m.profile.emailSame,
          taken: m.profile.emailTaken,
          invalid: m.profile.emailInvalid,
          cooldown: m.profile.emailCooldown,
          mailFailed: m.profile.emailMailFailed,
        }}
      />
    </div>
  );
}
