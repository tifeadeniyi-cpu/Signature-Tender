import 'server-only';

/**
 * Guards for the privacy-first measurement endpoints. They accept only small same-origin JSON
 * posts, drop obvious bots and requests that ask not to be tracked, and limit how often one
 * address can post. Addresses are held only in this instance's memory, hashed, for one minute,
 * and are never written anywhere.
 */
const BOT =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|httpclient/i;
const WINDOW_MS = 60_000;
const hits = new Map<string, { n: number; reset: number }>();

function sameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

async function addressKey(req: Request): Promise<string> {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Buffer.from(digest).toString('base64url').slice(0, 16);
}

async function limited(req: Request, perMinute: number): Promise<boolean> {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const key = `${new URL(req.url).pathname}:${await addressKey(req)}`;
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + WINDOW_MS });
    return false;
  }
  h.n += 1;
  return h.n > perMinute;
}

/** Parsed JSON body when the request may be recorded, or null to ignore it quietly. */
export async function acceptMeasurement(
  req: Request,
  perMinute: number,
): Promise<Record<string, unknown> | null> {
  if (!sameOrigin(req)) return null;
  if (req.headers.get('sec-gpc') === '1' || req.headers.get('dnt') === '1') return null;
  if (BOT.test(req.headers.get('user-agent') ?? '')) return null;
  if (await limited(req, perMinute)) return null;
  const text = await req.text();
  if (text.length > 512) return null;
  try {
    const body = JSON.parse(text) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Every measurement endpoint answers the same way, so a response reveals nothing. */
export const noContent = () =>
  new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
