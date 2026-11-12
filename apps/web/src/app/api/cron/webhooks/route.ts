import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { retryFailedFinalizations } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { sendInvitations } from '@/lib/signing-mail';
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

/** Retries documents that failed to finish and emails the completed copies. */
async function retryFinishing() {
  const runs = await retryFailedFinalizations(db(), storage());
  for (const r of runs) {
    if (!r.ok || !r.result) continue;
    await sendInvitations(r.result.invitations, {
      title: r.result.title,
      senderName: r.result.senderName,
      workspaceName: r.result.workspaceName,
      message: null,
      isTest: r.result.isTest,
    }).catch(() => {});
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
  return Response.json({ webhooks: result ?? { skipped: true }, finishing });
}
