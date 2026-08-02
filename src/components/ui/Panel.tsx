import type { CSSProperties, ReactNode } from 'react';

/** Standard card surface: no resting shadow, 1px border, r-lg radius. */
export function Panel({
  children,
  padding = 14,
  style,
}: {
  children: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/** Micro-caps section label (.hy-label) with an optional right-side slot. */
export function PanelLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <span className="hy-label" style={{ flex: 1 }}>
        {children}
      </span>
      {trailing}
    </div>
  );
}
