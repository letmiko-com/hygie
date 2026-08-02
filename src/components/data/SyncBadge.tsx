import { Icon } from '@/components/ui/Icon';

export type SyncState = 'fresh' | 'syncing' | 'stale' | 'error' | 'never';

const STATES: Record<SyncState, { fg: string; bg: string }> = {
  fresh: { fg: 'var(--ok)', bg: 'var(--ok-soft)' },
  syncing: { fg: 'var(--accent)', bg: 'var(--accent-soft)' },
  stale: { fg: 'var(--warn)', bg: 'var(--warn-soft)' },
  error: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
  never: { fg: 'var(--text-3)', bg: 'var(--surface-2)' },
};

/** Freshness pill. Label comes from the caller (i18n lives at page level). */
export function SyncBadge({
  state,
  label,
  detail,
}: {
  state: SyncState;
  label: string;
  detail?: string;
}) {
  const { fg, bg } = STATES[state];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        padding: '0 8px',
        borderRadius: 'var(--r-sm)',
        background: bg,
        color: fg,
        font: '500 var(--text-xs)/1 var(--font-ui)',
        whiteSpace: 'nowrap',
      }}
    >
      {state === 'syncing' ? (
        <Icon
          name="progress_activity"
          size={12}
          color={fg}
          style={{ animation: 'hy-spin 1s linear infinite' }}
        />
      ) : (
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flex: 'none' }} />
      )}
      {label}
      {detail && (
        <span className="tnum" style={{ font: '400 var(--text-2xs)/1 var(--font-data)', color: 'var(--text-3)' }}>
          {detail}
        </span>
      )}
    </span>
  );
}
