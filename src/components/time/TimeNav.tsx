'use client';
// Central time navigation: preset segmented control, chevrons, custom range
// picker (native date inputs, no dependency) and the compare toggle. The
// whole state lives in the URL (?p&a, ?from&to, &compare=1): the server
// resolves it with parseTimeParams, this component only builds URLs.
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { Locale } from '@/lib/i18n';
import {
  comparisonRange,
  daysBetween,
  shiftRange,
  PRESETS,
  type DayRange,
  type Preset,
} from '@/lib/queries/time';
import { comparisonLabel, rangeLabel } from '@/lib/time-format';

export interface TimeNavLabels {
  presets: Record<Preset, string>;
  compare: string;
  customTitle: string;
  from: string;
  to: string;
  apply: string;
  prevPeriod: string;
  nextPeriod: string;
  vsWord: string;
}

function lastDayOf(range: DayRange): string {
  const t = Date.parse(`${range.toDayExcl}T00:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function TimeNav({
  preset,
  range,
  compare,
  firstDataDay,
  today,
  locale,
  labels,
}: {
  preset: Preset | null;
  range: DayRange;
  compare: boolean;
  firstDataDay: string | null;
  today: string;
  locale: Locale;
  labels: TimeNavLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pickerOpen, setPickerOpen] = useState(false);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  function push(params: Record<string, string | null>) {
    const q = new URLSearchParams();
    if (compare) q.set('compare', '1');
    for (const [k, v] of Object.entries(params)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.push(`${pathname}?${q.toString()}`);
  }

  function selectPreset(p: Preset) {
    push({ p, a: null, from: null, to: null });
  }

  function chevron(dir: -1 | 1) {
    if (preset && preset !== 'all') {
      const shifted = shiftRange(preset, range, dir);
      if (!shifted) return;
      // The shifted range's last day re-anchors every preset correctly.
      push({ p: preset, a: lastDayOf(shifted), from: null, to: null });
    } else if (!preset) {
      const span = daysBetween(range.fromDay, range.toDayExcl);
      const shift = dir * span;
      const from = addDaysStr(range.fromDay, shift);
      const to = addDaysStr(lastDayOf(range), shift);
      push({ from, to, p: null, a: null });
    }
  }

  function addDaysStr(day: string, n: number): string {
    return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  }

  function applyCustom() {
    const from = fromRef.current?.value;
    const to = toRef.current?.value;
    if (!from || !to || from > to) return;
    setPickerOpen(false);
    push({ from, to, p: null, a: null });
  }

  const chevronsDisabled = preset === 'all';
  const nextDisabled = chevronsDisabled || range.toDayExcl > today;
  const prev = comparisonRange(preset, range);
  const compareLabel = comparisonLabel(prev, locale, labels.vsWord);

  const navBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 'var(--control-h-md)',
    padding: '0 9px',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--border-strong)',
    background: 'var(--surface)',
    color: 'var(--text-1)',
    cursor: 'pointer',
    font: '500 var(--text-sm)/1 var(--font-ui)',
    ...extra,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', position: 'relative' }}>
      <div
        role="tablist"
        aria-label={labels.customTitle}
        style={{
          display: 'inline-flex',
          gap: 2,
          padding: 2,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
        }}
      >
        {PRESETS.map((p) => {
          const active = p === preset;
          return (
            <button
              key={p}
              role="tab"
              aria-selected={active}
              onClick={() => selectPreset(p)}
              style={{
                height: 24,
                padding: '0 9px',
                borderRadius: 'calc(var(--r-md) - 2px)',
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: active ? 'var(--surface)' : 'transparent',
                boxShadow: active ? 'var(--shadow-1)' : 'none',
                color: active ? 'var(--text-1)' : 'var(--text-2)',
                font: `${active ? 600 : 400} var(--text-sm)/1 var(--font-ui)`,
              }}
            >
              {labels.presets[p]}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          className="hy-btn hy-ghost"
          title={labels.prevPeriod}
          aria-label={labels.prevPeriod}
          disabled={chevronsDisabled}
          onClick={() => chevron(-1)}
          style={navBtn({ width: 26, padding: 0, opacity: chevronsDisabled ? 0.4 : 1, border: 'none', background: 'transparent' })}
        >
          <Icon name="chevron_left" size={17} />
        </button>
        <button
          type="button"
          className="hy-btn hy-ghost"
          title={labels.customTitle}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((o) => !o)}
          style={navBtn()}
        >
          <Icon name="calendar_month" size={15} color="var(--text-3)" />
          <span className="tnum" style={{ font: '500 var(--text-sm)/1 var(--font-data)' }}>
            {rangeLabel(preset, range, locale)}
          </span>
          <Icon name="expand_more" size={14} color="var(--text-3)" />
        </button>
        <button
          type="button"
          className="hy-btn hy-ghost"
          title={labels.nextPeriod}
          aria-label={labels.nextPeriod}
          disabled={nextDisabled}
          onClick={() => chevron(1)}
          style={navBtn({ width: 26, padding: 0, opacity: nextDisabled ? 0.4 : 1, border: 'none', background: 'transparent' })}
        >
          <Icon name="chevron_right" size={17} />
        </button>
      </div>

      {pickerOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 20,
            display: 'flex',
            alignItems: 'flex-end',
            gap: 10,
            padding: 12,
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-2)',
          }}
        >
          {(
            [
              [labels.from, fromRef, range.fromDay],
              [labels.to, toRef, lastDayOf(range)],
            ] as const
          ).map(([label, ref, def]) => (
            <label key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="hy-label">{label}</span>
              <input
                ref={ref}
                type="date"
                defaultValue={def}
                min={firstDataDay ?? undefined}
                max={today}
                className="tnum"
                style={{
                  height: 'var(--control-h-md)',
                  padding: '0 8px',
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--border-strong)',
                  background: 'var(--bg)',
                  color: 'var(--text-1)',
                  font: '400 var(--text-sm)/1 var(--font-data)',
                  colorScheme: 'light dark',
                }}
              />
            </label>
          ))}
          <button type="button" className="hy-btn" onClick={applyCustom} style={navBtn({ background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid transparent' })}>
            {labels.apply}
          </button>
        </div>
      )}

      <button
        type="button"
        className="hy-btn"
        title={labels.compare}
        aria-pressed={compare}
        onClick={() => {
          const q = new URLSearchParams();
          if (preset) {
            q.set('p', preset);
          } else {
            q.set('from', range.fromDay);
            q.set('to', lastDayOf(range));
          }
          if (preset && lastDayOf(range) !== today) q.set('a', lastDayOf(range));
          if (!compare) q.set('compare', '1');
          router.push(`${pathname}?${q.toString()}`);
        }}
        style={navBtn(
          compare
            ? { background: 'var(--accent-soft)', color: 'var(--accent-strong)', border: '1px solid transparent' }
            : { color: 'var(--text-2)' }
        )}
      >
        <Icon name="compare_arrows" size={15} />
        {compare ? compareLabel : labels.compare}
      </button>
    </div>
  );
}
