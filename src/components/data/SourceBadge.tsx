import { Icon } from '@/components/ui/Icon';

/** Best-effort icon for a real source or device name. */
function iconFor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('watch')) return 'watch';
  if (n.includes('iphone') || n.includes('phone')) return 'smartphone';
  if (n.includes('withings')) return 'monitor_weight';
  if (n.includes('healthfit')) return 'sync_alt';
  if (n.includes('garmin') || n.includes('edge')) return 'watch';
  if (n.includes('bluetooth') || n.includes('polar')) return 'bluetooth';
  return 'database';
}

/** Provenance chip: neutral, never colored (sources are facts, not families). */
export function SourceBadge({ name, title }: { name: string; title?: string }) {
  return (
    <span
      title={title ?? name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 18,
        padding: '0 6px',
        borderRadius: 'var(--r-sm)',
        border: '1px solid var(--border)',
        color: 'var(--text-2)',
        font: '400 var(--text-2xs)/1 var(--font-ui)',
        whiteSpace: 'nowrap',
        maxWidth: 180,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      <Icon name={iconFor(name)} size={12} color="var(--text-3)" />
      {name}
    </span>
  );
}
