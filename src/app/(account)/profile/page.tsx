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
        timezone={profile.subject?.timezone ?? null}
        zones={Intl.supportedValuesOf('timeZone')}
        labels={{
          name: m.profile.name,
          nameHint: profile.subject ? m.profile.nameHint : m.profile.nameHintNoSubject,
          locale: m.profile.locale,
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
