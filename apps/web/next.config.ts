import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

// Pages get a per-request nonce CSP from src/proxy.ts. API responses (JSON and files) get a
// policy that allows nothing to run.
const apiCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const config: NextConfig = {
  transpilePackages: ['@st/db', '@st/core'],
  poweredByHeader: false,
  serverExternalPackages: ['postgres'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isDev
            ? []
            : [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]),
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: apiCsp }],
      },
      {
        // Recipient links carry a secret token: never leak it via Referer, cache or index the pages.
        source: '/(sign|api/sign|retrieve|api/retrieve|invite)/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
    ];
  },
};

export default config;
