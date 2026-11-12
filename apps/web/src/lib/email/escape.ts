/**
 * Output safety for email HTML. Every dynamic value goes through `esc` (text and attributes) and
 * every link through `safeUrl`, so document titles, names and other user-supplied text can never
 * inject markup, scripts or unexpected links.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
};

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`=]/g, (c) => HTML_ESCAPES[c]!);
}

/** Collapses whitespace and control characters in a single-line value (subjects, names). */
export function oneLine(value: unknown, max = 200): string {
  const s = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Returns the URL if it is an absolute https URL (http only for localhost during development),
 * without credentials; otherwise null. Callers omit the link when this returns null.
 */
export function safeUrl(raw: string | null | undefined, opts: { allowHttpLocal?: boolean } = {}) {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:') return u.toString();
  if (u.protocol === 'http:' && local && opts.allowHttpLocal) return u.toString();
  return null;
}

/** Only allows plain email addresses in mailto: links. */
export function safeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  return /^[^\s@<>"'(),;:\\[\]]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s) && s.length <= 254
    ? s
    : null;
}
