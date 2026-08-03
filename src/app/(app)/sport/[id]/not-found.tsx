// Rendered for an unknown session id, with a real 404 status: the page used
// to return this same panel inside a 200, which told every client (browser
// history, a shared link, a crawler, a monitor) that the session existed.
// Same shell as the app, so a mistyped URL does not throw the user out.
import Link from 'next/link';
import { EmptyState } from '@/components/data/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { getMessages } from '@/lib/i18n';
import { getSubjectContext } from '@/lib/queries/context';

export default async function SessionNotFound() {
  const ctx = await getSubjectContext();
  const m = getMessages(ctx?.locale);

  return (
    <Panel>
      <EmptyState
        icon="search_off"
        title={m.session.notFound}
        hint={m.session.notFoundHint}
        action={
          <Link
            href="/sport"
            className="hy-btn"
            style={{ color: 'var(--accent-strong)', font: '500 var(--text-sm)/1 var(--font-ui)' }}
          >
            {m.session.back}
          </Link>
        }
      />
    </Panel>
  );
}
