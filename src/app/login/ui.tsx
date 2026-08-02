// Visual primitives of the sign-in flow, transcribed from the reference mock
// design/ui_kits/app/Login.jsx (server components, inline styles on the CSS
// tokens imported by globals.css).
import type { CSSProperties, ReactNode } from 'react';

export const panelStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-lg)',
  padding: 28,
  width: 400,
  maxWidth: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

export const primaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 'var(--control-h-md)',
  padding: '0 14px',
  borderRadius: 'var(--r-md)',
  font: '500 var(--text-base)/1 var(--font-ui)',
  cursor: 'pointer',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  border: '1px solid transparent',
};

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="var(--accent)" style={{ flex: 'none' }} aria-hidden>
        <rect x="4" y="13" width="6" height="15" rx="3" />
        <rect x="13" y="4" width="6" height="24" rx="3" />
        <rect x="22" y="9" width="6" height="12" rx="3" />
      </svg>
      <span style={{ font: `600 ${Math.round(size * 0.85)}px/1 var(--font-ui)`, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
        Hygie
      </span>
    </span>
  );
}

/** Centered column: logo, one panel, AGPL footer. */
export function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <Logo />
      {children}
      <span className="tnum" style={{ font: '400 var(--text-2xs)/1 var(--font-data)', color: 'var(--text-3)' }}>
        Hygie — self-hosted · AGPL-3.0
      </span>
    </div>
  );
}

export function PanelHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <div style={{ font: '600 var(--text-lg)/1.3 var(--font-ui)' }}>{title}</div>
      {children && (
        <div style={{ font: '400 var(--text-sm)/1.5 var(--font-ui)', color: 'var(--text-3)', marginTop: 4 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Round icon badge (Material Symbols ligature), as in the mock's sent/confirmed steps. */
export function IconBadge({ name, tone }: { name: string; tone: 'accent' | 'ok' | 'danger' }) {
  const palette = {
    accent: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' },
    ok: { background: 'var(--ok-soft)', color: 'var(--ok)' },
    danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
  }[tone];
  return (
    <span
      className="msym"
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 44,
        height: 44,
        borderRadius: 'var(--r-full)',
        fontSize: 22,
        ...palette,
      }}
    >
      {name}
    </span>
  );
}
