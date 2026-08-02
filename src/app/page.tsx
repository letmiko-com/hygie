export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--sp-3)',
      }}
    >
      <svg width="32" height="32" viewBox="0 0 32 32" fill="var(--accent)" aria-hidden>
        <rect x="4" y="13" width="6" height="15" rx="3" />
        <rect x="13" y="4" width="6" height="24" rx="3" />
        <rect x="22" y="9" width="6" height="12" rx="3" />
      </svg>
      <h1 style={{ margin: 0, font: '600 var(--text-xl)/1.2 var(--font-ui)' }}>Hygie</h1>
      <p style={{ margin: 0, color: 'var(--text-3)', font: '400 var(--text-sm)/1.5 var(--font-ui)' }}>
        Skeleton under construction.
      </p>
    </main>
  );
}
