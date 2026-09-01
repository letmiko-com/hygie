// Drill-down plumbing: a chart bucket that covers one or more whole days can
// carry a link opening exactly that span (?from=&to= custom range). Pages
// build the zones; charts render them as full-height hit bands (DrillBands),
// merged on the fly when a band would be too thin to hit.
import { fmtDay } from '@/lib/format';
import type { Locale, Messages } from '@/lib/i18n';

export interface DaySpan {
  fromDay: string;
  toDay: string;
}

/**
 * A clickable zone over one chart bucket. `href` MUST carry the span as
 * `from=` and `to=` query parameters: when bands are merged for a finger, the
 * merged band reuses its first zone's href with both parameters rewritten
 * (drill-groups.ts). The shared Link never prefetches, which is what keeps a
 * chart with hundreds of zones from firing one dynamic SSR request per zone
 * (enough to trip the Cloudflare per-IP rate limit on its own).
 */
export interface DrillZone {
  span: DaySpan;
  href: string;
  label: string;
}

/**
 * What a chart needs to render drill bands: the zones, plus what a merged
 * band's label takes on the client (the locale for the dates, and the
 * "from … to …" message with `{from}` / `{to}` placeholders, since a message
 * function cannot cross into a client component).
 */
export interface DrillSet {
  zones: Array<DrillZone | null>;
  locale: Locale;
  spanLabel: string;
}

export function drillSet(zones: Array<DrillZone | null>, locale: Locale, m: Messages): DrillSet {
  return { zones, locale, spanLabel: m.common.drillSpan('{from}', '{to}') };
}

/**
 * The day span each downsampled point covers. Mirrors the pages' downsample()
 * bucketing (size = ceil(n / target), mean per bucket) so the spans stay
 * aligned with the averaged points.
 */
export function bucketSpans(days: string[], target: number): DaySpan[] {
  if (days.length <= target) return days.map((d) => ({ fromDay: d, toDay: d }));
  const size = Math.ceil(days.length / target);
  const out: DaySpan[] = [];
  for (let i = 0; i < days.length; i += size) {
    out.push({ fromDay: days[i], toDay: days[Math.min(i + size, days.length) - 1] });
  }
  return out;
}

export function spanQuery(span: DaySpan): string {
  return `from=${span.fromDay}&to=${span.toDay}`;
}

export function drillZone(span: DaySpan, href: string, locale: Locale, m: Messages): DrillZone {
  const label =
    span.fromDay === span.toDay
      ? m.common.drillDay(fmtDay(span.fromDay, locale))
      : m.common.drillSpan(fmtDay(span.fromDay, locale), fmtDay(span.toDay, locale));
  return { span, href, label };
}
