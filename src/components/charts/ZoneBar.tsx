import { fmtDuration, fmtInt } from '@/lib/format';
import type { Locale, Messages } from '@/lib/i18n';
import type { ZoneBreakdown } from '@/lib/queries/zones';

/** One tint per zone, a ramp of the heart colour: zones are a scale, not a verdict. */
const TINTS = [38, 52, 66, 82, 100];

/**
 * Time in heart rate zones: one stacked bar (share of recorded time per
 * zone) and the legend that makes it readable, zone by zone, with the bpm
 * bounds, the time and the share. Time under Z1 is stated below the bar and
 * not painted: it is recorded time, not training in a zone.
 */
export function ZoneBar({
  breakdown,
  locale,
  m,
  ariaLabel,
}: {
  breakdown: ZoneBreakdown;
  locale: Locale;
  m: Messages;
  ariaLabel: string;
}) {
  const inZones = breakdown.zones.reduce((a, z) => a + z.seconds, 0);
  const share = (s: number) => (breakdown.totalS === 0 ? 0 : (s / breakdown.totalS) * 100);
  return (
    <div role="img" aria-label={ariaLabel}>
      <div
        aria-hidden
        style={{
          display: 'flex',
          height: 14,
          borderRadius: 'var(--r-sm)',
          overflow: 'hidden',
          background: 'var(--surface-2)',
        }}
      >
        {breakdown.zones.map((z, i) =>
          z.seconds <= 0 ? null : (
            <span
              key={z.zone}
              style={{
                width: `${inZones === 0 ? 0 : (z.seconds / inZones) * 100}%`,
                background: `color-mix(in oklab, var(--data-heart) ${TINTS[i]}%, var(--surface-3))`,
              }}
            />
          )
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr auto auto',
          columnGap: 10,
          rowGap: 4,
          marginTop: 10,
          font: '400 var(--text-xs)/1.3 var(--font-ui)',
          color: 'var(--text-2)',
          alignItems: 'center',
        }}
      >
        {[...breakdown.zones].reverse().map((z, ri) => {
          const i = breakdown.zones.length - 1 - ri;
          return (
            <ZoneRow
              key={z.zone}
              swatch={`color-mix(in oklab, var(--data-heart) ${TINTS[i]}%, var(--surface-3))`}
              label={m.zones.zoneLabel(z.zone)}
              pct={m.zones.pctRange(Math.round(50 + 10 * i), i === 4 ? null : Math.round(60 + 10 * i))}
              bpm={z.toBpm === null ? `≥ ${fmtInt(z.fromBpm, locale)} bpm` : `${fmtInt(z.fromBpm, locale)}-${fmtInt(z.toBpm, locale)} bpm`}
              time={z.seconds > 0 ? fmtDuration(z.seconds) : '—'}
              share={z.seconds > 0 ? `${fmtInt(share(z.seconds), locale)} %` : ''}
            />
          );
        })}
      </div>
      {breakdown.belowS > 0 && (
        <p style={{ margin: '8px 0 0', font: '400 var(--text-2xs)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
          {m.zones.below(fmtDuration(breakdown.belowS), fmtInt(share(breakdown.belowS), locale))}
        </p>
      )}
    </div>
  );
}

function ZoneRow({ swatch, label, pct, bpm, time, share }: { swatch: string; label: string; pct: string; bpm: string; time: string; share: string }) {
  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: swatch }} />
        <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{label}</span>
      </span>
      <span className="tnum" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-data)' }}>{pct}</span>
      <span className="tnum" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-data)' }}>{bpm}</span>
      <span className="tnum" style={{ textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--text-1)' }}>{time}</span>
      <span className="tnum" style={{ textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--text-3)', minWidth: 36 }}>{share}</span>
    </>
  );
}
