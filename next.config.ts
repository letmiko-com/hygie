import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // One artifact for Railway and self-hosters: node server.js in a slim container.
  output: 'standalone',
  // Health payloads are streamed to disk in route handlers, never buffered by the
  // framework: keep every ingest route out of any proxy/middleware matcher.
  poweredByHeader: false,
};

export default nextConfig;
