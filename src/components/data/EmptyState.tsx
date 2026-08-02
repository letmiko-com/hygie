import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '36px 20px',
        textAlign: 'center',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'var(--surface-2)',
        }}
      >
        <Icon name={icon} size={20} color="var(--text-3)" />
      </span>
      <div style={{ font: '600 var(--text-md)/1.3 var(--font-ui)' }}>{title}</div>
      {hint && (
        <div style={{ font: '400 var(--text-sm)/1.5 var(--font-ui)', color: 'var(--text-3)', maxWidth: 340 }}>
          {hint}
        </div>
      )}
      {action}
    </div>
  );
}
