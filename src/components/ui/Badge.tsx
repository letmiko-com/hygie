import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const TONES: Record<BadgeTone, { fg: string; bg: string }> = {
  neutral: { fg: 'var(--text-2)', bg: 'var(--surface-2)' },
  accent: { fg: 'var(--accent-strong)', bg: 'var(--accent-soft)' },
  ok: { fg: 'var(--ok)', bg: 'var(--ok-soft)' },
  warn: { fg: 'var(--warn)', bg: 'var(--warn-soft)' },
  danger: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
};

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  mono = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  mono?: boolean;
}) {
  const { fg, bg } = TONES[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 18,
        padding: '0 6px',
        borderRadius: 'var(--r-sm)',
        background: bg,
        color: fg,
        font: `500 var(--text-xs)/1 ${mono ? 'var(--font-data)' : 'var(--font-ui)'}`,
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span
          aria-hidden
          style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flex: 'none' }}
        />
      )}
      {children}
    </span>
  );
}
