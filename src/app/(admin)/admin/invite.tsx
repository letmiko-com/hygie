'use client';
// Invitation form of the Administration section: creates the member's
// account, their own subject and their owner grant, then emails them how to
// sign in. The outcome arrives through the action state.
import { useActionState, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { inviteMemberAction, type InviteResult } from './actions';

export interface InviteLabels {
  button: string;
  name: string;
  namePlaceholder: string;
  email: string;
  locale: string;
  timezone: string;
  submit: string;
  cancel: string;
  hint: string;
  invalid: string;
  exists: string;
  proxy: string;
}

const fieldStyle: React.CSSProperties = {
  height: 'var(--control-h-md)',
  padding: '0 10px',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--border-strong)',
  background: 'var(--bg)',
  color: 'var(--text-1)',
  font: '400 var(--text-base)/1 var(--font-ui)',
};

export function InvitePanel({
  labels,
  defaultLocale,
  defaultTimezone,
  invitedTitle,
  invitedNoMail,
}: {
  labels: InviteLabels;
  defaultLocale: 'fr' | 'en';
  defaultTimezone: string;
  /** Message templates with an {email} slot (functions cannot cross to a client component). */
  invitedTitle: string;
  invitedNoMail: string;
}) {
  const [open, setOpen] = useState(false);
  const [result, formAction, pending] = useActionState<InviteResult | null, FormData>(inviteMemberAction, null);
  const done = result?.ok ? result : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="hy-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 'var(--control-h-md)',
            padding: '0 12px',
            borderRadius: 'var(--r-md)',
            border: '1px solid transparent',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            font: '500 var(--text-base)/1 var(--font-ui)',
            cursor: 'pointer',
          }}
        >
          <Icon name="person_add" size={16} />
          {labels.button}
        </button>
      </div>

      {open && (
        <form
          action={formAction}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: 14,
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px' }}>
            <span className="hy-label">{labels.name}</span>
            <input name="name" required maxLength={80} placeholder={labels.namePlaceholder} style={fieldStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 220px' }}>
            <span className="hy-label">{labels.email}</span>
            <input name="email" type="email" required maxLength={254} autoComplete="off" style={fieldStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 110 }}>
            <span className="hy-label">{labels.locale}</span>
            <select name="locale" defaultValue={defaultLocale} style={fieldStyle}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 170 }}>
            <span className="hy-label">{labels.timezone}</span>
            <input name="timezone" required maxLength={64} defaultValue={defaultTimezone} style={fieldStyle} />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="hy-btn"
            style={{
              height: 'var(--control-h-md)',
              padding: '0 12px',
              borderRadius: 'var(--r-md)',
              border: '1px solid transparent',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              font: '500 var(--text-base)/1 var(--font-ui)',
              cursor: 'pointer',
              opacity: pending ? 0.6 : 1,
            }}
          >
            {labels.submit}
          </button>
          <button
            type="button"
            className="hy-btn hy-ghost"
            onClick={() => setOpen(false)}
            style={{
              height: 'var(--control-h-md)',
              padding: '0 12px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border-strong)',
              background: 'transparent',
              color: 'var(--text-2)',
              font: '500 var(--text-base)/1 var(--font-ui)',
              cursor: 'pointer',
            }}
          >
            {labels.cancel}
          </button>
          {result && !result.ok && result.error !== 'unauthorized' && (
            <span role="alert" style={{ font: '400 var(--text-sm)/1.3 var(--font-ui)', color: 'var(--danger)' }}>
              {result.error === 'exists' ? labels.exists : labels.invalid}
            </span>
          )}
          <span style={{ flexBasis: '100%', font: '400 var(--text-2xs)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
            {labels.hint}
          </span>
        </form>
      )}

      {done && (
        <div
          role="status"
          style={{
            background: 'var(--surface)',
            border: `1px solid ${done.mailSent ? 'var(--accent)' : 'var(--warn)'}`,
            borderRadius: 'var(--r-lg)',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon
              name={done.mailSent ? 'mark_email_read' : 'warning'}
              size={17}
              color={done.mailSent ? 'var(--accent-strong)' : 'var(--warn)'}
            />
            <span style={{ font: '600 var(--text-md)/1.3 var(--font-ui)' }}>
              {(done.mailSent ? invitedTitle : invitedNoMail).replace('{email}', done.email)}
            </span>
          </div>
          <p style={{ margin: 0, font: '400 var(--text-sm)/1.5 var(--font-ui)', color: 'var(--text-2)' }}>{labels.proxy}</p>
        </div>
      )}
    </div>
  );
}
