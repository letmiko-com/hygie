'use client';
// Explorer controls. Client only because they build URLs: the selection, the
// window and the scale all live in the query string, so every view of the
// explorer is shareable and the server stays stateless (same contract as
// TimeNav). No state is duplicated here — what is rendered comes from props
// resolved server-side out of the URL.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';

export interface PickerOption {
  key: string;
  label: string;
  icon: string;
  color: string;
  unit: string | null;
  /** Family label, used as the group heading. */
  group: string;
  dailyOnly: boolean;
  /** Daily-only series on a window charted per hour or per minute. */
  disabled: boolean;
}

/**
 * Pre-rendered strings only: i18n messages are functions, and a function
 * cannot cross the server/client boundary. The counters they build depend on
 * the URL, which the server re-reads on every push, so nothing is lost.
 */
export interface PickerLabels {
  title: string;
  picked: string;
  clear: string;
  maxReached: string;
  dailyOnlyBadge: string;
  dailyOnlyHint: string;
}

function chipStyle(active: boolean, disabled: boolean, color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 26,
    padding: '0 9px 0 7px',
    borderRadius: 'var(--r-md)',
    border: `1px solid ${active ? 'transparent' : 'var(--border-strong)'}`,
    background: active ? `color-mix(in oklab, ${color} 16%, transparent)` : 'var(--surface)',
    color: active ? 'var(--text-1)' : 'var(--text-2)',
    font: `${active ? 600 : 400} var(--text-sm)/1 var(--font-ui)`,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  };
}

export function MetricPicker({
  options,
  selected,
  max,
  labels,
}: {
  options: PickerOption[];
  selected: string[];
  max: number;
  labels: PickerLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function push(keys: string[]) {
    const q = new URLSearchParams(params.toString());
    if (keys.length === 0) q.set('m', 'none');
    else q.set('m', keys.join(','));
    router.push(`${pathname}?${q.toString()}`);
  }

  function toggle(key: string) {
    const has = selected.includes(key);
    if (has) push(selected.filter((k) => k !== key));
    else if (selected.length < max) push([...selected, key]);
  }

  const groups = new Map<string, PickerOption[]>();
  for (const option of options) {
    const list = groups.get(option.group);
    if (list) list.push(option);
    else groups.set(option.group, [option]);
  }
  const full = selected.length >= max;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="hy-label" style={{ flex: 1 }}>
          {labels.title}
        </span>
        <span className="tnum" style={{ font: '400 var(--text-xs)/1 var(--font-data)', color: 'var(--text-3)' }}>
          {labels.picked}
        </span>
        {full && (
          <span style={{ font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-3)' }}>
            {labels.maxReached}
          </span>
        )}
        <button
          type="button"
          className="hy-btn hy-ghost"
          onClick={() => push([])}
          disabled={selected.length === 0}
          style={{
            height: 24,
            padding: '0 8px',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border-strong)',
            background: 'transparent',
            color: 'var(--text-2)',
            font: '500 var(--text-xs)/1 var(--font-ui)',
            cursor: selected.length === 0 ? 'not-allowed' : 'pointer',
            opacity: selected.length === 0 ? 0.45 : 1,
          }}
        >
          {labels.clear}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 300, overflowY: 'auto' }}>
        {[...groups.entries()].map(([group, items]) => (
          <div key={group} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span
              className="hy-label"
              style={{ width: 78, flex: 'none', paddingTop: 7, color: 'var(--text-3)' }}
            >
              {group}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
              {items.map((option) => {
                const active = selected.includes(option.key);
                const disabled = option.disabled || (!active && full);
                return (
                  <button
                    key={option.key}
                    type="button"
                    className="hy-btn"
                    aria-pressed={active}
                    disabled={disabled}
                    title={option.disabled ? labels.dailyOnlyHint : (option.unit ?? undefined)}
                    onClick={() => toggle(option.key)}
                    style={chipStyle(active, disabled, option.color)}
                  >
                    <Icon
                      name={active ? 'check' : option.icon}
                      size={14}
                      color={active ? option.color : 'var(--text-3)'}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{option.label}</span>
                    {option.unit && (
                      <span
                        className="tnum"
                        style={{ font: '400 var(--text-2xs)/1 var(--font-data)', color: 'var(--text-3)' }}
                      >
                        {option.unit}
                      </span>
                    )}
                    {option.dailyOnly && (
                      <span style={{ font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-3)' }}>
                        {labels.dailyOnlyBadge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Scale switch. "Auto" lets the chart decide (one axis when every series
 * shares a unit, two axes for two units, normalized beyond); "Normalized"
 * forces the comparable-shapes rendering even for two series.
 */
export function ScaleToggle({
  scale,
  labels,
}: {
  scale: 'auto' | 'normalized';
  labels: { title: string; auto: string; normalized: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(next: 'auto' | 'normalized') {
    const q = new URLSearchParams(params.toString());
    if (next === 'auto') q.delete('scale');
    else q.set('scale', next);
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="hy-label">{labels.title}</span>
      <div
        role="tablist"
        aria-label={labels.title}
        style={{
          display: 'inline-flex',
          gap: 2,
          padding: 2,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
        }}
      >
        {(
          [
            ['auto', labels.auto],
            ['normalized', labels.normalized],
          ] as const
        ).map(([value, label]) => {
          const active = scale === value;
          return (
            <button
              key={value}
              role="tab"
              aria-selected={active}
              onClick={() => select(value)}
              style={{
                height: 22,
                padding: '0 9px',
                borderRadius: 'calc(var(--r-md) - 2px)',
                border: 'none',
                cursor: 'pointer',
                background: active ? 'var(--surface)' : 'transparent',
                boxShadow: active ? 'var(--shadow-1)' : 'none',
                color: active ? 'var(--text-1)' : 'var(--text-2)',
                font: `${active ? 600 : 400} var(--text-xs)/1 var(--font-ui)`,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
