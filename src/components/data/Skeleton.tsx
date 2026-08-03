// Loading placeholder (design reference: design/components/data/Skeleton.jsx).
// Shimmer only, no spinner: the charter asks for sober, fast feedback.
// Always decorative — the accessible "loading" statement belongs to the
// region that hosts the skeletons (aria-busy + a visually hidden label).
import type { CSSProperties } from 'react';

export function Skeleton({
  width = '100%',
  height = 14,
  radius = 'var(--r-sm)',
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background: 'var(--surface-3)',
        animation: 'hy-shimmer 1.4s var(--ease) infinite',
        ...style,
      }}
    />
  );
}

/** Rectangular block of shimmering lines, for list and panel placeholders. */
export function SkeletonLines({
  lines = 3,
  gap = 10,
  height = 14,
}: {
  lines?: number;
  gap?: number;
  height?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={height} width={i === lines - 1 ? '62%' : '100%'} />
      ))}
    </div>
  );
}
