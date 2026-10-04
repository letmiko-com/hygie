'use client';
// Correcting a mistyped invitation, shown only while the member has no
// device and no data (MemberDetail.invitation). Submitted through onSubmit:
// a form action would reset the fields to their first render after saving.
import { startTransition, useActionState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { correctInvitationAction, type CorrectionResult } from '../../actions';

export interface CorrectLabels {
  title: string;
  hint: string;
  name: string;
  email: string;
  submit: string;
  /** Templates with an {email} slot: functions cannot cross to a client component. */
  saved: string;
  savedName: string;
  noMail: string;
  locked: string;
  exists: string;
  invalid: string;
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

export function CorrectInvitation({
  subjectId,
  name,
  email,
  labels,
}: {
  subjectId: string;
  name: string;
  email: string;
  labels: CorrectLabels;
}) {
  const [result, formAction, pending] = useActionState<CorrectionResult | null, FormData>(correctInvitationAction, null);
  const error = result && !result.ok ? result.error : null;
  const errorText =
    error === 'locked' ? labels.locked : error === 'exists' ? labels.exists : error === 'invalid' ? labels.invalid : null;
  const done = result?.ok ? result : null;
  const doneText = done
    ? !done.emailChanged
      ? labels.savedName
      : (done.mailSent ? labels.saved : labels.noMail).replace('{email}', done.email)
    : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <input type="hidden" name="subjectId" value={subjectId} />
      <p style={{ margin: 0, font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)' }}>{labels.hint}</p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px' }}>
          <span className="hy-label">{labels.name}</span>
          <input name="name" required maxLength={80} defaultValue={name} style={fieldStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 240px' }}>
          <span className="hy-label">{labels.email}</span>
          <input name="email" type="email" required maxLength={254} defaultValue={email} autoComplete="off" style={fieldStyle} />
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
      </div>
      {errorText && (
        <span role="alert" style={{ font: '400 var(--text-sm)/1.3 var(--font-ui)', color: 'var(--danger)' }}>
          {errorText}
        </span>
      )}
      {doneText && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '400 var(--text-sm)/1.4 var(--font-ui)', color: done?.mailSent || !done?.emailChanged ? 'var(--ok)' : 'var(--warn)' }}>
            <Icon name={done?.mailSent || !done?.emailChanged ? 'check' : 'warning'} size={15} />
            {doneText}
          </span>
          {done?.emailChanged && (
            <span style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)' }}>{labels.proxy}</span>
          )}
        </div>
      )}
    </form>
  );
}
