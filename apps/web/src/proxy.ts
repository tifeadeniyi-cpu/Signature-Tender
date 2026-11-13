import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content Security Policy with a script nonce. Next.js reads the nonce from the
 * request's CSP header and adds it to its own scripts, so inline scripts without it never run.
 * Styles keep 'unsafe-inline' because React style attributes (for example brand colours) need it.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  // Only the canonical domain belongs in search results. The vercel.app address and preview
  // deployments serve the same pages, so tell crawlers to skip them.
  if (isDuplicateHost(request.headers.get('host'))) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
}

function isDuplicateHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.split(':')[0]!.toLowerCase();
  if (name === 'localhost' || name === '127.0.0.1') return false;
  const canonical = process.env.SITE_URL || process.env.BETTER_AUTH_URL;
  if (!canonical) return false;
  try {
    return name !== new URL(canonical).hostname.toLowerCase();
  } catch {
    return false;
  }
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|brand|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
