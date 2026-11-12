import { timingSafeEqual } from 'node:crypto';
import type { DispatchResult } from '@st/core';
import { env } from '@/lib/env';
import { dispatchNotifications } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Scheduled sweep: sends queued notifications and retries failed sends whose backoff has passed.
 * Called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`; refused without it.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const results: DispatchResult[] = [];
  // Up to 4 batches of 25 per run keeps the run well inside the time limit.
  for (let i = 0; i < 4; i++) {
    const batch = await dispatchNotifications({ limit: 25 });
    results.push(...batch);
    if (batch.length < 25) break;
  }
  const count = (s: string) => results.filter((r) => r.status === s).length;
  return Response.json({
    processed: results.length,
    sent: count('sent'),
    retrying: count('retrying'),
    failed: count('failed'),
  });
}
