import { Icon } from '@/components/ui/Icon';
import Link from '@/components/ui/Link';

/**
 * Warning strip for the devices that have gone silent (same threshold as the
 * alert email, src/lib/silence.ts). Same shape as the info strip of the
 * Devices screen, tinted with the warn tokens. Lines come from the caller
 * (i18n lives at page level); nothing renders when there is none.
 */
export function SilenceBanner({
  lines,
  linkLabel,
  href,
}: {
  lines: Array<{ key: string; text: string }>;
  linkLabel: string;
  href: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '9px 12px',
        background: 'var(--warn-soft)',
        borderRadius: 'var(--r-md)',
        color: 'var(--text-1)',
        font: '400 var(--text-sm)/1.45 var(--font-ui)',
      }}
    >
      <Icon name="sync_problem" size={16} color="var(--warn)" style={{ marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {lines.map((l) => (
          <span key={l.key}>{l.text}</span>
        ))}
      </div>
      <Link href={href} style={{ color: 'inherit', fontWeight: 500, whiteSpace: 'nowrap' }}>
        {linkLabel}
      </Link>
    </div>
  );
}
