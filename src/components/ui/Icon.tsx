import type { CSSProperties } from 'react';

/** Material Symbols ligature glyph. Decorative by default (aria-hidden). */
export function Icon({
  name,
  size = 18,
  color,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <span className="msym" aria-hidden style={{ fontSize: size, color, ...style }}>
      {name}
    </span>
  );
}
