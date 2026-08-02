/** Hygie wordmark: three bars + name. Single definition for the whole app. */
export function Logo({ size = 26, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="var(--accent)"
        style={{ flex: 'none' }}
        aria-hidden
      >
        <rect x="4" y="13" width="6" height="15" rx="3" />
        <rect x="13" y="4" width="6" height="24" rx="3" />
        <rect x="22" y="9" width="6" height="12" rx="3" />
      </svg>
      {wordmark && (
        <span
          style={{
            font: `600 ${Math.round(size * 0.85)}px/1 var(--font-ui)`,
            color: 'var(--text-1)',
            letterSpacing: '-0.01em',
          }}
        >
          Hygie
        </span>
      )}
    </span>
  );
}
