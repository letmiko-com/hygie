'use client';
// All-time scrubber: a brushable window over the full data history, with a
// silhouette of activity behind it. Dragging commits a custom range to the
// URL on release. Keyboard: the handles and the window are focusable;
// arrow keys move by one week (a11y the reference mock lacked).
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { DayRange } from '@/lib/queries/time';

const DAY_MS = 86_400_000;
const MIN_FRACTION = 0.02;

function dayToMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function msToDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function TimeScrubber({
  startDay,
  endDay,
  range,
  data,
  compare,
  height = 40,
  startLabel,
  endLabel,
  ariaLabel,
}: {
  startDay: string;
  endDay: string;
  range: DayRange;
  data: number[];
  compare: boolean;
  height?: number;
  startLabel: string;
  endLabel: string;
  ariaLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const startMs = dayToMs(startDay);
  const endMs = dayToMs(endDay) + DAY_MS;
  const total = Math.max(1, endMs - startMs);

  const toFraction = (day: string) => Math.max(0, Math.min(1, (dayToMs(day) - startMs) / total));
  const controlled: [number, number] = [toFraction(range.fromDay), toFraction(range.toDayExcl)];

  const [win, setWin] = useState<[number, number]>(controlled);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setWin(controlled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.fromDay, range.toDayExcl]);

  const boxRef = useRef<HTMLDivElement>(null);

  function commit([a, b]: [number, number]) {
    const fromMs = startMs + a * total;
    const toMsExcl = startMs + b * total;
    const from = msToDay(Math.round(fromMs / DAY_MS) * DAY_MS);
    const lastIncl = msToDay(Math.max(dayToMs(from), Math.round(toMsExcl / DAY_MS) * DAY_MS - DAY_MS));
    const q = new URLSearchParams({ from, to: lastIncl });
    if (compare) q.set('compare', '1');
    router.push(`${pathname}?${q.toString()}`);
  }

  function startDrag(mode: 'l' | 'r' | 'm', e: React.PointerEvent) {
    e.preventDefault();
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const [a0, b0] = win;
    const x0 = e.clientX;
    dragging.current = true;
    let latest: [number, number] = [a0, b0];

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / rect.width;
      let a = a0;
      let b = b0;
      if (mode === 'l') a = Math.min(a0 + dx, b0 - MIN_FRACTION);
      if (mode === 'r') b = Math.max(b0 + dx, a0 + MIN_FRACTION);
      if (mode === 'm') {
        const w = b0 - a0;
        a = Math.max(0, Math.min(1 - w, a0 + dx));
        b = a + w;
      }
      latest = [Math.max(0, a), Math.min(1, b)];
      setWin(latest);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      dragging.current = false;
      commit(latest);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function keyAdjust(mode: 'l' | 'r' | 'm', e: React.KeyboardEvent) {
    const step = (7 * DAY_MS) / total;
    let [a, b] = win;
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    if (mode === 'l') a = Math.max(0, Math.min(b - MIN_FRACTION, a + dir * step));
    if (mode === 'r') b = Math.min(1, Math.max(a + MIN_FRACTION, b + dir * step));
    if (mode === 'm') {
      const w = b - a;
      a = Math.max(0, Math.min(1 - w, a + dir * step));
      b = a + w;
    }
    const next: [number, number] = [a, b];
    setWin(next);
    commit(next);
  }

  const [a, b] = win;
  const max = Math.max(1, ...data);
  const points = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * 100},${100 - (v / max) * 88}`);

  return (
    <div>
      <div
        ref={boxRef}
        role="group"
        aria-label={ariaLabel}
        style={{
          position: 'relative',
          height,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)',
          overflow: 'hidden',
        }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
          {data.length > 1 && (
            <>
              <polygon points={`0,100 ${points.join(' ')} 100,100`} fill="var(--text-3)" opacity={0.18} />
              <polyline points={points.join(' ')} fill="none" stroke="var(--text-3)" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.6} />
            </>
          )}
        </svg>
        <div
          tabIndex={0}
          onPointerDown={(e) => startDrag('m', e)}
          onKeyDown={(e) => keyAdjust('m', e)}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${a * 100}%`,
            width: `${(b - a) * 100}%`,
            background: 'color-mix(in oklab, var(--accent) 14%, transparent)',
            borderTop: '1.5px solid var(--accent)',
            borderBottom: '1.5px solid var(--accent)',
            cursor: 'grab',
            touchAction: 'none',
          }}
        />
        {(['l', 'r'] as const).map((mode) => (
          <div
            key={mode}
            tabIndex={0}
            onPointerDown={(e) => startDrag(mode, e)}
            onKeyDown={(e) => keyAdjust(mode, e)}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `calc(${(mode === 'l' ? a : b) * 100}% - 4px)`,
              width: 8,
              cursor: 'ew-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              touchAction: 'none',
            }}
          >
            <span style={{ width: 4, height: '70%', borderRadius: 2, background: 'var(--accent)' }} />
          </div>
        ))}
      </div>
      <div
        className="tnum"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 3,
          font: '400 var(--text-2xs)/1 var(--font-data)',
          color: 'var(--chart-axis)',
        }}
      >
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
