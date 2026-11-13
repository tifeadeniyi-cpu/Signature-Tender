import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { retryFailedFinalizations } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { dispatchNotifications } from '@/lib/notifications';
import { runWebhookDispatch } from '@/lib/webhooks';
import { runIntegrationWorker } from '@/lib/integrations';

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
 * Retries documents that failed to finish. A successful finish queues the completion emails in
 * the same transaction (notifications outbox), so they are sent here and retried by the
 * notifications sweep if the email provider is down.
 */
async function retryFinishing() {
  const runs = await retryFailedFinalizations(db(), storage(), { appUrl: env().BETTER_AUTH_URL });
  for (const r of runs) {
    if (!r.ok) continue;
    await dispatchNotifications({ requestId: r.requestId }).catch((err) =>
      console.error('[ops-alert] Completion email dispatch failed after retry', err),
    );
  }
  const summary = {
    attempted: runs.length,
    succeeded: runs.filter((r) => r.ok).length,
    failed: runs.filter((r) => !r.ok).map((r) => r.requestId),
  };
  console.log(JSON.stringify({ event: 'finalization.retry', ...summary }));
  return summary;
}

/**
 * Vercel Cron (scheduled maintenance): sends due webhook deliveries and retries documents that
 * failed to finish. Refuses to run without CRON_SECRET.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const finishing = await retryFinishing();
  const result = await runWebhookDispatch();
  console.log(
    JSON.stringify({ event: 'webhooks.dispatch', ...(result ?? { skipped: 'public_api off' }) }),
  );
  const integrations = await runIntegrationWorker().catch((err) => {
    console.error('[ops-alert] Integration worker failed', err);
    return null;
  });
  console.log(
    JSON.stringify({ event: 'integrations.run', ...(integrations ?? { skipped: true }) }),
  );
  return Response.json({ webhooks: result ?? { skipped: true }, finishing, integrations });
}
