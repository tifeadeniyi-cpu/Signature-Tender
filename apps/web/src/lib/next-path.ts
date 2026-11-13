/**
 * Where to go after signing in or verifying an email. Only invitation links, document-claim
 * links, the Signature Studio hand-off and the signed-in API documentation are accepted, so the `next` parameter can never be used to send people to another site
 * or an arbitrary page.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (/^\/invite\/[A-Za-z0-9_-]{43}$/.test(next)) return next;
  if (/^\/claim\/[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{43}$/.test(next)) return next;
  if (next === '/signature-studio/continue') return next;
  if (next === '/app/api-docs') return next;
  return null;
}

/** True when `next` is a completed-document claim (post-signing registration). */
export function isClaimNext(next: string | null | undefined): boolean {
  return Boolean(next && next.startsWith('/claim/') && safeNextPath(next));
}

/** Reads `next` from the current URL in the browser. */
export function nextFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}
