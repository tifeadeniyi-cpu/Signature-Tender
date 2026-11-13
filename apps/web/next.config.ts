import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

// Pages get a per-request nonce CSP from src/proxy.ts. API responses (JSON and files) get a
// policy that allows nothing to run.
const apiCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const config: NextConfig = {
  transpilePackages: ['@st/db', '@st/core'],
  poweredByHeader: false,
  // resvg is a native module: load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ['postgres', '@resvg/resvg-js'],
  // Signature Studio renders exports on the server from the self-hosted font files.
  outputFileTracingIncludes: {
    '/api/stripe/webhook': ['./public/studio-fonts/*.woff'],
    '/api/studio/**': ['./public/studio-fonts/*.woff'],
    '/signature-studio/**': ['./public/studio-fonts/*.woff'],
    '/admin/signature-studio': ['./public/studio-fonts/*.woff'],
    '/sign/**': ['./public/studio-fonts/*.woff'],
  },
  // The API documentation moved behind sign-in. Old links land there (or on sign-in, then there).
  async redirects() {
    return [{ source: '/developers', destination: '/app/api-docs', permanent: false }];
  },
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
