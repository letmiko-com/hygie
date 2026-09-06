// Unknown recording id: same shell, real 404 status (see sport/[id]/not-found.tsx).
import Link from '@/components/ui/Link';
import { EmptyState } from '@/components/data/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { getMessages } from '@/lib/i18n';
import { getSubjectContext } from '@/lib/queries/context';

export default async function EcgNotFound() {
  const ctx = await getSubjectContext();
  const m = getMessages(ctx?.locale);

  return (
    <Panel>
      <EmptyState
        icon="search_off"
        title={m.ecg.notFound}
        hint={m.ecg.notFoundHint}
        action={
          <Link
            href="/ecg"
            className="hy-btn"
            style={{ color: 'var(--accent-strong)', font: '500 var(--text-sm)/1 var(--font-ui)' }}
          >
            {m.ecg.back}
          </Link>
        }
      />
    </Panel>
  );
}
