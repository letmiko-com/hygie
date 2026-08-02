import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hygie',
  description: 'Your Apple Health data, on a real screen.',
};

// Font stylesheets are declared here, not via the @import lines of
// design/tokens/fonts.css: once bundled, those nested external @import rules
// end up after other CSS rules and browsers ignore them (no fonts at all).
// React 19 hoists and dedupes these links into <head>. Self-hosting the
// fonts is the planned follow-up for a strict self-hosted story.
const FONT_LINKS = [
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,300,0..1,0&display=block',
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>
        {FONT_LINKS.map((href) => (
          // eslint-disable-next-line react/no-unknown-property
          <link key={href} rel="stylesheet" href={href} precedence="default" />
        ))}
        {children}
      </body>
    </html>
  );
}
