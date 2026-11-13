import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content Security Policy with a script nonce. Next.js reads the nonce from the
 * request's CSP header and adds it to its own scripts, so inline scripts without it never run.
 * Styles keep 'unsafe-inline' because React style attributes (for example brand colours) need it.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  // The signed-in app embeds the Google Drive file picker (Google's own iframe and scripts).
  const google = request.nextUrl.pathname.startsWith('/app/');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${google ? ' https://*.googleusercontent.com https://ssl.gstatic.com https://www.gstatic.com' : ''}`,
    "font-src 'self'",
    `connect-src 'self'${google ? ' https://apis.google.com https://content.googleapis.com https://www.googleapis.com' : ''}`,
    ...(google
      ? [
          'frame-src https://docs.google.com https://drive.google.com https://accounts.google.com https://content.googleapis.com',
        ]
      : []),
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
  return response;
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
