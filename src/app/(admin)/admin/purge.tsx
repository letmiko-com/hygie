'use client';
// Erasing a disabled member for good. The form opens on demand and its submit
// stays disabled until the member's name is typed in full; the server action
// checks the name again (requestPurge, src/lib/queries/instance.ts). Kept in
// place once the purge is requested, so the outcome of the email survives the
// refresh that turns the row into "Erasing".
import { startTransition, useActionState, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { purgeMemberAction, type PurgeResult } from './actions';

export interface PurgeLabels {
  button: string;
  /** Template with a {name} slot: functions cannot cross to a client component. */
  hint: string;
  label: string;
  submit: string;
  cancel: string;
  mismatch: string;
  locked: string;
  invalid: string;
  started: string;
  startedNoMail: string;
  purging: string;
}

const norm = (v: string) => v.normalize('NFC').trim().toLocaleLowerCase();

const buttonBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 'var(--control-h-md)',
  padding: '0 12px',
  borderRadius: 'var(--r-md)',
  font: '500 var(--text-sm)/1 var(--font-ui)',
  cursor: 'pointer',
};

export function PurgeMember({
  subjectId,
  name,
  purging,
  labels,
}: {
  subjectId: string;
  name: string;
  purging: boolean;
  labels: PurgeLabels;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [result, formAction, pending] = useActionState<PurgeResult | null, FormData>(purgeMemberAction, null);

  if (purging || result?.ok) {
    return (
      <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Badge tone="danger" dot>
          {labels.purging}
        </Badge>
        {result?.ok && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              font: '400 var(--text-sm)/1.4 var(--font-ui)',
              color: result.mailSent ? 'var(--ok)' : 'var(--warn)',
            }}
          >
            <Icon name={result.mailSent ? 'check' : 'warning'} size={15} />
            {result.mailSent ? labels.started : labels.startedNoMail}
          </span>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="hy-btn hy-ghost"
        onClick={() => setOpen(true)}
        style={{ ...buttonBase, height: 26, padding: '0 9px', border: 'none', background: 'transparent', color: 'var(--danger)' }}
      >
        <Icon name="delete_forever" size={15} />
        {labels.button}
      </button>
    );
  }

  const error = result && !result.ok ? result.error : null;
  const errorText =
    error === 'mismatch' ? labels.mismatch : error === 'locked' ? labels.locked : error ? labels.invalid : null;
  const [before, after] = labels.hint.split('{name}');
  const matches = norm(name) !== '' && norm(typed) === norm(name);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 100%' }}
    >
      <input type="hidden" name="subjectId" value={subjectId} />
      <p style={{ margin: 0, font: '400 var(--text-sm)/1.5 var(--font-ui)', color: 'var(--text-2)' }}>
        {before}
        <strong>{name}</strong>
        {after}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
          <span className="hy-label">{labels.label}</span>
          <input
            name="name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            style={{
              height: 'var(--control-h-md)',
              padding: '0 10px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border-strong)',
              background: 'var(--bg)',
              color: 'var(--text-1)',
              font: '400 var(--text-base)/1 var(--font-ui)',
            }}
          />
        </label>
        <button
          type="submit"
          disabled={!matches || pending}
          className="hy-btn"
          style={{
            ...buttonBase,
            border: '1px solid transparent',
            background: 'var(--danger)',
            color: 'var(--on-accent)',
            opacity: !matches || pending ? 0.5 : 1,
            cursor: !matches || pending ? 'not-allowed' : 'pointer',
          }}
        >
          <Icon name="delete_forever" size={15} />
          {labels.submit}
        </button>
        <button
          type="button"
          className="hy-btn hy-ghost"
          onClick={() => {
            setOpen(false);
            setTyped('');
          }}
          style={{ ...buttonBase, border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-2)' }}
        >
          {labels.cancel}
        </button>
      </div>
      {errorText && (
        <span role="alert" style={{ font: '400 var(--text-sm)/1.3 var(--font-ui)', color: 'var(--danger)' }}>
          {errorText}
        </span>
      )}
    </form>
  );
}
