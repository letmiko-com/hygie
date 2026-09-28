// One freshness verdict per member for the Administration screens, from the
// instance state alone. Same threshold as the silence alert email and the
// member's own Sync and Devices screens (src/lib/silence.ts).
import type { SyncState } from '@/components/data/SyncBadge';
import type { MemberSummary } from '@/lib/queries/instance';
import { staleAfterMs } from '@/lib/silence';

export function memberState(s: MemberSummary): SyncState {
  if (s.activeDevices === 0 || s.lastReceivedAt === null) return 'never';
  if (s.lastBatchFailed) return 'error';
  if (s.pendingBatches > 0) return 'syncing';
  // Any active device past the threshold is behind: that is the device the
  // alert email names, even when another device of the member still pushes.
  if (s.quietestSince && Date.now() - s.quietestSince.getTime() >= staleAfterMs()) return 'stale';
  return 'fresh';
}
