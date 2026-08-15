// Drill-down plumbing: a chart bucket that covers one or more whole days can
// carry a link opening exactly that span (?from=&to= custom range). Pages
// build the zones; charts only render them as full-height hit bands.
import { fmtDay } from '@/lib/format';
import type { Locale, Messages } from '@/lib/i18n';

export interface DaySpan {
  fromDay: string;
  toDay: string;
}

/**
 * A clickable zone over one chart bucket. Renderers MUST pass
 * prefetch={false} to the Link: a chart carries hundreds of zones, and the
 * default viewport prefetch would fire one dynamic SSR request per zone
 * (enough to trip the Cloudflare per-IP rate limit on its own).
 */
export interface DrillZone {
  href: string;
  label: string;
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
  return { href, label };
}
