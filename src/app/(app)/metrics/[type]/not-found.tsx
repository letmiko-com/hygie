// Rendered for a slug that resolves to no type this subject has data for, with
// a real 404 status. Same reasoning as the session not-found: an unknown
// identifier answered with 200 tells every client (browser history, a shared
// link, a monitor) that the resource exists.
//
// This route deliberately has NO loading.tsx. A loading file wraps the page in
// a Suspense boundary, so Next streams the shell — and the status line — before
// the page has resolved its slug, and notFound() can no longer turn a 200 into
// a 404 (measured: it did exactly that). The page answers in 130-440 ms on the
// real database, so the skeleton was worth less than the status code.
import Link from 'next/link';
import { EmptyState } from '@/components/data/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { getMessages } from '@/lib/i18n';
import { getSubjectContext } from '@/lib/queries/context';

export default async function MetricNotFound() {
  const ctx = await getSubjectContext();
  const m = getMessages(ctx?.locale);

  return (
    <Panel>
      <EmptyState
        icon="search_off"
        title={m.metric.notFound}
        hint={m.metric.notFoundHint}
        action={
          <Link
            href="/metrics"
            className="hy-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 'var(--control-h-md)',
              padding: '0 12px',
              borderRadius: 'var(--r-md)',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              textDecoration: 'none',
              font: '500 var(--text-sm)/1 var(--font-ui)',
            }}
          >
            {m.metric.back}
          </Link>
        }
      />
    </Panel>
  );
}
