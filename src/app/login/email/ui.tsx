'use client';
// The confirmation button and its outcome. Rendering the page changes
// nothing (mailbox link scanners fetch it): only the POST of this form does.
import { startTransition, useActionState } from 'react';
import Link from '@/components/ui/Link';
import { IconBadge, PanelHeading, primaryButtonStyle } from '../ui';
import { confirmEmailChangeAction, type ConfirmResult } from './actions';

export interface ConfirmLabels {
  title: string;
  body: string;
  button: string;
  done: string;
  doneSignedIn: string;
  doneSignIn: string;
  back: string;
  signIn: string;
  invalid: string;
  invalidBody: string;
  taken: string;
}

export function ConfirmEmailChange({ token, labels }: { token: string; labels: ConfirmLabels }) {
  const [result, formAction, pending] = useActionState<ConfirmResult | null, FormData>(confirmEmailChangeAction, null);

  if (result?.ok) {
    return (
      <>
        <IconBadge name="mark_email_read" tone="ok" />
        <PanelHeading title={labels.done}>{result.signedIn ? labels.doneSignedIn : labels.doneSignIn}</PanelHeading>
        <Link href={result.signedIn ? '/profile' : '/login'} style={{ font: '400 var(--text-sm)/1 var(--font-ui)' }}>
          {result.signedIn ? labels.back : labels.signIn}
        </Link>
      </>
    );
  }
  if (result && !result.ok) {
    return (
      <>
        <IconBadge name="link_off" tone="danger" />
        <PanelHeading title={labels.invalid}>{result.error === 'taken' ? labels.taken : labels.invalidBody}</PanelHeading>
        <Link href="/profile" style={{ font: '400 var(--text-sm)/1 var(--font-ui)' }}>
          {labels.back}
        </Link>
      </>
    );
  }

  return (
    <>
      <IconBadge name="alternate_email" tone="accent" />
      <PanelHeading title={labels.title}>{labels.body}</PanelHeading>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => formAction(data));
        }}
        style={{ width: '100%' }}
      >
        <input type="hidden" name="token" value={token} />
        <button type="submit" disabled={pending} className="hy-btn" style={{ ...primaryButtonStyle, width: '100%', opacity: pending ? 0.6 : 1 }}>
          <span className="msym" aria-hidden style={{ fontSize: 16 }}>
            check_circle
          </span>
          {labels.button}
        </button>
      </form>
    </>
  );
}
