'use client';
// Profile form. The time zone field only exists for an account that owns a
// subject; a pure admin edits its name and language only.
//
// Submitted through onSubmit, not the form's action prop: React resets a form
// after an action passed as its `action`, and a <select> resets to the option
// of its FIRST render, so saving a language showed the old one in the list
// while the page spoke the new (controlled fields do not help: the reset
// moves the DOM, and an unchanged state never moves it back).
import { startTransition, useActionState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { updateProfileAction, type ProfileResult } from './actions';

export interface ProfileLabels {
  name: string;
  nameHint: string;
  email: string;
  emailHint: string;
  locale: string;
  timezone: string;
  timezoneHint: string;
  save: string;
  saved: string;
  invalid: string;
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

const hintStyle: React.CSSProperties = {
  font: '400 var(--text-2xs)/1.45 var(--font-ui)',
  color: 'var(--text-3)',
};

export function ProfileForm({
  labels,
  name,
  email,
  locale,
  timezone,
  zones,
}: {
  labels: ProfileLabels;
  name: string;
  email: string;
  locale: 'fr' | 'en';
  /** Null when the account owns no subject: no time zone to edit. */
  timezone: string | null;
  zones: string[];
}) {
  const [result, formAction, pending] = useActionState<ProfileResult | null, FormData>(updateProfileAction, null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: 16,
        maxWidth: 560,
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="hy-label">{labels.name}</span>
        <input name="name" required maxLength={80} defaultValue={name} style={fieldStyle} />
        <span style={hintStyle}>{labels.nameHint}</span>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="hy-label">{labels.email}</span>
        <span style={{ ...fieldStyle, display: 'flex', alignItems: 'center', background: 'var(--surface-2)', color: 'var(--text-2)' }}>
          {email}
        </span>
        <span style={hintStyle}>{labels.emailHint}</span>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 200 }}>
        <span className="hy-label">{labels.locale}</span>
        <select name="locale" defaultValue={locale} style={fieldStyle}>
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </label>

      {timezone !== null && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="hy-label">{labels.timezone}</span>
          <input
            name="timezone"
            required
            maxLength={64}
            defaultValue={timezone}
            list="hy-zones"
            autoComplete="off"
            style={{ ...fieldStyle, maxWidth: 280 }}
          />
          <datalist id="hy-zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <span style={hintStyle}>{labels.timezoneHint}</span>
        </label>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="submit"
          disabled={pending}
          className="hy-btn"
          style={{
            height: 'var(--control-h-md)',
            padding: '0 14px',
            borderRadius: 'var(--r-md)',
            border: '1px solid transparent',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            font: '500 var(--text-base)/1 var(--font-ui)',
            cursor: 'pointer',
            opacity: pending ? 0.6 : 1,
          }}
        >
          {labels.save}
        </button>
        {result?.ok && !pending && (
          <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '400 var(--text-sm)/1 var(--font-ui)', color: 'var(--ok)' }}>
            <Icon name="check" size={15} />
            {labels.saved}
          </span>
        )}
        {result && !result.ok && result.error === 'invalid' && (
          <span role="alert" style={{ font: '400 var(--text-sm)/1.3 var(--font-ui)', color: 'var(--danger)' }}>
            {labels.invalid}
          </span>
        )}
      </div>
    </form>
  );
}
