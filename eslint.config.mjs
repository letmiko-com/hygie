// Flat config, minimal on purpose: the Next rules (core-web-vitals) plus the
// TypeScript ones, and nothing invented on top. `next lint` was removed in
// Next 16, which left `npm run lint` calling a command that no longer exists.
// eslint-config-next 16 ships flat configs, so no eslintrc compat layer.
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  // design/ is the design reference (JSX kept as-is on purpose), not app code.
  { ignores: ['.next/**', 'node_modules/**', 'design/**', 'next-env.d.ts', 'tools/**'] },
  ...coreWebVitals,
  ...typescript,
];

export default config;
