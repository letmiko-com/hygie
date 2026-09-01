'use client';
// Full-height hit bands over a chart, one per point, MERGED on the fly when a
// band would be too thin to hit. A finger needs about 24 px (a 397-point curve
// on a 300 px phone plot gave 0.8 px bands, a 60-night sleep chart 5.8 px), a
// mouse a few. The server renders one band per point, there is nothing to
// measure yet; after hydration the bands are regrouped from the measured
// width and the pointer kind, and again on resize. A merged band opens the
// span from its first zone's first day to its last zone's last day.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from '@/components/ui/Link';
import { fmtDay } from '@/lib/format';
import type { DrillSet } from '@/lib/drill';
import { groupDrill } from '@/lib/drill-groups';

/** Minimum band width in px, by pointer kind. */
const TOUCH_TARGET = 24;
const MOUSE_TARGET = 6;

/**
 * The hover card (when a band carries one) is centred on its band, which
 * overflows at the panel edges: bands in the outer 15 % of the axis pin the
 * card to their side instead (hy-tip-start / hy-tip-end, design/tokens/base.css).
 * On any panel wide enough to show a chart, 15 % covers the half card.
 */
function edgeClass(at: number): string {
  return at < 0.15 ? ' hy-tip-start' : at > 0.85 ? ' hy-tip-end' : '';
}

export function DrillBands({
  set,
  n,
  align,
  titles,
  tips,
}: {
  set: DrillSet;
  /** Points (or slots) on the axis; zones beyond it are ignored. */
  n: number;
  /**
   * 'point': the axis puts point i at i/(n-1) and a band spans to the
   * midpoints with its neighbours (line charts, edge bands overhang by half
   * a slot and are clipped). 'slot': the axis is n equal columns (bars,
   * nights).
   */
  align: 'point' | 'slot';
  /** Native tooltip per point, used while bands are one per point. */
  titles?: Array<string | undefined>;
  /** Hover card per point, rendered inside its band while bands are one per point. */
  tips?: Array<ReactNode | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [perBand, setPerBand] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const coarse = window.matchMedia('(pointer: coarse)');
    const measure = () => {
      const slots = Math.max(1, align === 'point' ? n - 1 : n);
      const slot = el.getBoundingClientRect().width / slots;
      const target = coarse.matches ? TOUCH_TARGET : MOUSE_TARGET;
      setPerBand(slot > 0 ? Math.max(1, Math.ceil(target / slot)) : 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    coarse.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      coarse.removeEventListener('change', measure);
    };
  }, [n, align]);

  const groups = groupDrill(set.zones.slice(0, n), perBand);
  const merged = perBand > 1;
  const denom = Math.max(1, align === 'point' ? n - 1 : n);
  const leftOf = (first: number) => (n <= 1 ? 0 : ((align === 'point' ? first - 0.5 : first) / denom) * 100);
  const widthOf = (first: number, last: number) => (n <= 1 ? 100 : ((last - first + 1) / denom) * 100);

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, overflow: align === 'point' ? 'hidden' : 'visible' }}>
      {groups.map((g) => {
        const label = g.single
          ? g.single.label
          : set.spanLabel
              .replace('{from}', fmtDay(g.fromDay, set.locale))
              .replace('{to}', fmtDay(g.toDay, set.locale));
        const tip = merged ? null : (tips?.[g.first] ?? null);
        const title = tip ? undefined : merged ? label : (titles?.[g.first] ?? label);
        return (
          <Link
            key={g.first}
            href={g.href}
            className={tip ? `hy-drill hy-tipwrap${edgeClass((g.first + 0.5) / n)}` : 'hy-drill'}
            aria-label={label}
            title={title}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${leftOf(g.first)}%`,
              width: `${widthOf(g.first, g.last)}%`,
            }}
          >
            {tip}
          </Link>
        );
      })}
    </div>
  );
}
