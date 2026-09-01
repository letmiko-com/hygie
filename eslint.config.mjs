// Flat config, minimal on purpose: the Next rules (core-web-vitals) plus the
// TypeScript ones, and one rule of our own. `next lint` was removed in
// Next 16, which left `npm run lint` calling a command that no longer exists.
// eslint-config-next 16 ships flat configs, so no eslintrc compat layer.
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  // design/ is the design reference (JSX kept as-is on purpose), not app code.
  { ignores: ['.next/**', 'node_modules/**', 'design/**', 'next-env.d.ts', 'tools/**'] },
  ...coreWebVitals,
  ...typescript,
  // Links never prefetch (Cloudflare per-IP rate limit, see the wrapper). The
  // only place allowed to import next/link is the wrapper itself.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/Link.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/link',
              message: "Import Link from '@/components/ui/Link' (no prefetch, app-wide).",
            },
          ],
        },
      ],
    },
  },
];

export default config;
