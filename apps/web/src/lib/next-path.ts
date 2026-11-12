/**
 * Where to go after signing in or verifying an email. Only invitation links are accepted, so the
 * `next` parameter can never be used to send people to another site or an arbitrary page.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  return next && /^\/invite\/[A-Za-z0-9_-]{43}$/.test(next) ? next : null;
}

/** Reads `next` from the current URL in the browser. */
export function nextFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}
