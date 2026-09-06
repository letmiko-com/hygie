// Unknown series id: same shell, real 404 status (see ecg/[id]/not-found.tsx).
import { EmptyState } from '@/components/data/EmptyState';
import Link from '@/components/ui/Link';
import { Panel } from '@/components/ui/Panel';
import { getMessages } from '@/lib/i18n';
import { getSubjectContext } from '@/lib/queries/context';

export default async function HeartbeatSeriesNotFound() {
  const ctx = await getSubjectContext();
  const m = getMessages(ctx?.locale);

  return (
    <Panel>
      <EmptyState
        icon="search_off"
        title={m.hrv.notFound}
        hint={m.hrv.notFoundHint}
        action={
          <Link
            href="/hrv"
            className="hy-btn"
            style={{ color: 'var(--accent-strong)', font: '500 var(--text-sm)/1 var(--font-ui)' }}
          >
            {m.hrv.backToList}
          </Link>
        }
      />
    </Panel>
  );
}
