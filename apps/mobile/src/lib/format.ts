/** Small formatting helpers with no React Native imports, so they can be unit tested in Node. */

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dayTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export const formatDay = (iso: string | null | undefined) => (iso ? day.format(new Date(iso)) : '—');
export const formatDayTime = (iso: string | null | undefined) =>
  iso ? dayTime.format(new Date(iso)) : '—';

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function firstName(name: string | null | undefined) {
  return (name ?? '').trim().split(/\s+/)[0] || 'there';
}

export function greeting(hour: number) {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * Pulls the signing token out of anything a signer might paste or open: a full link
 * (https://signaturetender.com/sign/<token>), a link without the scheme, or the bare token.
 * Returns null for anything else, so the app never opens an unrelated page.
 */
export function signingTokenFrom(input: string): string | null {
  const s = input.trim();
  const m = /(?:^|signaturetender\.com)\/sign\/([A-Za-z0-9_-]{20,200})(?:[/?#].*)?$/i.exec(s);
  if (m) return m[1]!;
  if (/^[A-Za-z0-9_-]{20,200}$/.test(s)) return s;
  return null;
}

/** Safe filename for a downloaded PDF. */
export function pdfName(title: string, suffix = '') {
  const base = title.replace(/\.pdf$/i, '').replace(/[^\w.\- ()]+/g, '_').trim() || 'document';
  return `${base}${suffix}.pdf`;
}
