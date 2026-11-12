import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { runWebhookDispatch } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Vercel Cron: sends due webhook deliveries. Refuses to run without CRON_SECRET. */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runWebhookDispatch();
  console.log(
    JSON.stringify({ event: 'webhooks.dispatch', ...(result ?? { skipped: 'public_api off' }) }),
  );
  return Response.json(result ?? { skipped: true });
}
