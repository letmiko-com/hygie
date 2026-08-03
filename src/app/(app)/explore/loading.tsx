// Explorer loading state. The window can be all-time on six series, so the
// wait is real and deserves a shape rather than a blank page: header, picker
// and chart placeholders in the exact layout that will replace them.
import { Skeleton, SkeletonLines } from '@/components/data/Skeleton';
import { Panel } from '@/components/ui/Panel';
import { getMessages } from '@/lib/i18n';

export default function ExploreLoading() {
  const m = getMessages(undefined);
  return (
    <div
      aria-busy="true"
      aria-label={m.explore.loading}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton width={180} height={22} />
          <Skeleton width="60%" height={13} />
        </div>
        <Skeleton width={320} height={30} radius="var(--r-md)" />
      </div>
      <Skeleton height={34} radius="var(--r-lg)" />
      <Panel>
        <SkeletonLines lines={3} height={22} gap={12} />
      </Panel>
      <Panel>
        <Skeleton width={140} height={11} style={{ marginBottom: 14 }} />
        <Skeleton height={320} radius="var(--r-md)" />
      </Panel>
    </div>
  );
}
