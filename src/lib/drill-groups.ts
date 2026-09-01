// Pure grouping of drill zones into hit bands. No runtime import on purpose:
// `node --experimental-strip-types` runs it as-is for a quick check.
import type { DrillZone } from '@/lib/drill';

export interface DrillGroup {
  /** First and last point index the band covers, inclusive. */
  first: number;
  last: number;
  fromDay: string;
  toDay: string;
  href: string;
  /** The zone itself when the band holds exactly one: its label and title apply. */
  single: DrillZone | null;
}

/** Same href, `from` and `to` rewritten. */
export function spanHref(href: string, fromDay: string, toDay: string): string {
  const q = href.indexOf('?');
  const path = q < 0 ? href : href.slice(0, q);
  const params = new URLSearchParams(q < 0 ? '' : href.slice(q + 1));
  params.set('from', fromDay);
  params.set('to', toDay);
  return `${path}?${params.toString()}`;
}

/**
 * Cuts the points into runs of `perBand` and returns one band per run that
 * holds at least one zone. A band covers its whole run (null points included,
 * so the geometry stays a regular grid) and opens the span from its first
 * zone's first day to its last zone's last day: days without data inside it
 * are not bridged away, the target page shows them as such. With perBand 1
 * every zone is its own band, untouched.
 */
export function groupDrill(zones: Array<DrillZone | null>, perBand: number): DrillGroup[] {
  const k = Math.max(1, Math.floor(perBand));
  const out: DrillGroup[] = [];
  for (let start = 0; start < zones.length; start += k) {
    const end = Math.min(start + k, zones.length) - 1;
    const present: DrillZone[] = [];
    for (let i = start; i <= end; i++) {
      const zone = zones[i];
      if (zone) present.push(zone);
    }
    if (present.length === 0) continue;
    const head = present[0];
    const tail = present[present.length - 1];
    out.push(
      present.length === 1
        ? { first: start, last: end, fromDay: head.span.fromDay, toDay: head.span.toDay, href: head.href, single: head }
        : {
            first: start,
            last: end,
            fromDay: head.span.fromDay,
            toDay: tail.span.toDay,
            href: spanHref(head.href, head.span.fromDay, tail.span.toDay),
            single: null,
          }
    );
  }
  return out;
}
