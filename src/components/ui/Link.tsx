// The app's Link: next/link with prefetching OFF, everywhere.
//
// Next prefetches every Link that enters the viewport (and again on hover).
// A Hygie page carries dozens of them (nav, metric cards, timeline entries,
// drill bands by the hundred), so one page load fired about 39 RSC prefetch
// requests on top of its statics: eight navigations in fifteen seconds on a
// phone tripped the Cloudflare per-IP rate limit (error 1015, 2026-09-01).
// Navigation stays client-side; the route is simply fetched on click.
//
// ESLint forbids importing next/link anywhere else (eslint.config.mjs), so a
// new component cannot reintroduce the default by accident. Pass prefetch
// explicitly for the rare link that must be warm.
import NextLink from 'next/link';
import type { ComponentProps } from 'react';

export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
