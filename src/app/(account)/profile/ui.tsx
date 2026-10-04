'use client';
// Profile forms. The time zone field only exists for an account that owns a
// subject; a pure admin edits its name and language only. The address has its
// own form: it changes only once the new address confirms a link.
//
// Submitted through onSubmit, not the form's action prop: React resets a form
// after an action passed as its `action`, and a <select> resets to the option
// of its FIRST render, so saving a language showed the old one in the list
// while the page spoke the new (controlled fields do not help: the reset
// moves the DOM, and an unchanged state never moves it back).
import { startTransition, useActionState, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import {
  requestEmailChangeAction,
  updateProfileAction,
  type EmailChangeResult,
  type ProfileResult,
} from './actions';

export interface ProfileLabels {
  name: string;
  nameHint: string;
  locale: string;
  weekStart: string;
  weekStartHint: string;
  units: string;
  unitsMetric: string;
  unitsImperial: string;
  unitsHint: string;
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

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-lg)',
  padding: 16,
  maxWidth: 560,
};

const primaryButton = (pending: boolean): React.CSSProperties => ({
  height: 'var(--control-h-md)',
  padding: '0 14px',
  borderRadius: 'var(--r-md)',
  border: '1px solid transparent',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  font: '500 var(--text-base)/1 var(--font-ui)',
  cursor: 'pointer',
  opacity: pending ? 0.6 : 1,
});

const ghostButton: React.CSSProperties = {
  height: 'var(--control-h-md)',
  padding: '0 12px',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--border-strong)',
  background: 'transparent',
  color: 'var(--text-2)',
  font: '500 var(--text-base)/1 var(--font-ui)',
  cursor: 'pointer',
};

const alertStyle: React.CSSProperties = { font: '400 var(--text-sm)/1.3 var(--font-ui)', color: 'var(--danger)' };

export function ProfileForm({
  labels,
  name,
  locale,
  weekStart,
  weekDays,
  unitSystem,
  timezone,
  zones,
}: {
  labels: ProfileLabels;
  name: string;
  locale: 'fr' | 'en';
  /** ISO weekday the weeks start on. */
  weekStart: number;
  /** The choices offered, named in the account's language. */
  weekDays: Array<{ value: number; label: string }>;
  unitSystem: 'metric' | 'imperial';
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
      style={cardStyle}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="hy-label">{labels.name}</span>
        <input name="name" required maxLength={80} defaultValue={name} style={fieldStyle} />
        <span style={hintStyle}>{labels.nameHint}</span>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 200 }}>
        <span className="hy-label">{labels.locale}</span>
        <select name="locale" defaultValue={locale} style={fieldStyle}>
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="hy-label">{labels.weekStart}</span>
        <select name="weekStart" defaultValue={weekStart} style={{ ...fieldStyle, maxWidth: 200 }}>
          {weekDays.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <span style={hintStyle}>{labels.weekStartHint}</span>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="hy-label">{labels.units}</span>
        <select name="unitSystem" defaultValue={unitSystem} style={{ ...fieldStyle, maxWidth: 280 }}>
          <option value="metric">{labels.unitsMetric}</option>
          <option value="imperial">{labels.unitsImperial}</option>
        </select>
        <span style={hintStyle}>{labels.unitsHint}</span>
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
        <button type="submit" disabled={pending} className="hy-btn" style={primaryButton(pending)}>
          {labels.save}
        </button>
        {result?.ok && !pending && (
          <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '400 var(--text-sm)/1 var(--font-ui)', color: 'var(--ok)' }}>
            <Icon name="check" size={15} />
            {labels.saved}
          </span>
        )}
        {result && !result.ok && result.error === 'invalid' && (
          <span role="alert" style={alertStyle}>
            {labels.invalid}
          </span>
        )}
      </div>
    </form>
  );
}

export interface EmailLabels {
  email: string;
  emailHint: string;
  change: string;
  newAddress: string;
  send: string;
  cancel: string;
  /** Template with a {to} slot: functions cannot cross to a client component. */
  sent: string;
  same: string;
  taken: string;
  invalid: string;
  cooldown: string;
  mailFailed: string;
}

export function EmailPanel({ labels, email }: { labels: EmailLabels; email: string }) {
  const [open, setOpen] = useState(false);
  const [result, formAction, pending] = useActionState<EmailChangeResult | null, FormData>(
    requestEmailChangeAction,
    null
  );
  const error = result && !result.ok ? result.error : null;
  const errorText =
    error === 'same'
      ? labels.same
      : error === 'taken'
        ? labels.taken
        : error === 'invalid'
          ? labels.invalid
          : error === 'cooldown'
            ? labels.cooldown
            : error === 'mail'
              ? labels.mailFailed
              : null;

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="hy-label">{labels.email}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              ...fieldStyle,
              display: 'flex',
              alignItems: 'center',
              flex: '1 1 240px',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
            }}
          >
            {email}
          </span>
          {!open && (
            <button type="button" className="hy-btn hy-ghost" onClick={() => setOpen(true)} style={ghostButton}>
              {labels.change}
            </button>
          )}
        </div>
        <span style={hintStyle}>{labels.emailHint}</span>
      </div>

      {open && !result?.ok && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => formAction(data));
          }}
          style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 240px' }}>
            <span className="hy-label">{labels.newAddress}</span>
            <input name="email" type="email" required maxLength={254} autoComplete="email" style={fieldStyle} />
          </label>
          <button type="submit" disabled={pending} className="hy-btn" style={primaryButton(pending)}>
            {labels.send}
          </button>
          <button type="button" className="hy-btn hy-ghost" onClick={() => setOpen(false)} style={ghostButton}>
            {labels.cancel}
          </button>
          {errorText && (
            <span role="alert" style={{ ...alertStyle, flexBasis: '100%' }}>
              {errorText}
            </span>
          )}
        </form>
      )}

      {result?.ok && (
        <p
          role="status"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            margin: 0,
            font: '400 var(--text-sm)/1.5 var(--font-ui)',
            color: 'var(--text-2)',
          }}
        >
          <Icon name="mark_email_unread" size={17} color="var(--accent-strong)" />
          {labels.sent.replace('{to}', result.to)}
        </p>
      )}
    </div>
  );
}
