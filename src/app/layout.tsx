import type { Metadata } from 'next';
import './globals.css';

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
