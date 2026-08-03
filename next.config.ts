import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // One artifact for Railway and self-hosters: node server.js in a slim container.
  output: 'standalone',
  // Health payloads are streamed to disk in route handlers, never buffered by the
  // framework: keep every ingest route out of any proxy/middleware matcher.
  // Enforced today by the matcher in src/proxy.ts (session gate), which excludes
  // /api/v1/ingest explicitly; any future matcher change must preserve this.
  poweredByHeader: false,
  // Dev only: the local verification stack serves next dev from a container
  // reached as http://hygie-dev:3210 (headless browser on the same Docker
  // network). Without this, Next treats the origin as foreign and dev pages
  // never hydrate. No effect on production builds.
  allowedDevOrigins: ['hygie-dev'],

  // Security headers on every response. The app serves personal health data to
  // a single household: it is never framed, never embedded, and needs no
  // third-party origin. Fonts are self-hosted, so the CSP can stay tight;
  // 'unsafe-inline' on styles is required by the inline style attributes the
  // design system relies on, and Next injects its own inline bootstrap scripts
  // (hence 'unsafe-inline' on script-src until a nonce-based CSP is wired).
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          // Railway terminates TLS; the app is only reached over https in
          // production. Harmless over http in local dev (browsers ignore it).
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
