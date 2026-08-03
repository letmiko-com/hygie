import type { Metadata } from 'next';
// Self-hosted @font-face declarations (public/fonts): a self-hosted instance
// must not depend on Google Fonts at render time. The @import lines in
// design/tokens/fonts.css are reference-only and dead after bundling.
import './fonts.css';
import './globals.css';
// Small-screen rules, last so they win over the component styles they move.
import './responsive.css';

export const metadata: Metadata = {
  title: 'Hygie',
  description: 'Your Apple Health data, on a real screen.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
