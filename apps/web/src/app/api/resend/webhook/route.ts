import { Resend } from 'resend';
import { recordProviderEvent } from '@st/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

const TRACKED = new Set([
  'email.delivered',
  'email.bounced',
  'email.failed',
  'email.suppressed',
  'email.complained',
]);

/**
 * Delivery events from Resend (configure the endpoint in Resend > Webhooks and set
 * RESEND_WEBHOOK_SECRET). The signature is verified before anything is recorded. "Delivered" means
 * the receiving mail server accepted the email, not that anyone opened it.
 */
export async function POST(req: Request) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: 'Webhook not configured' }, { status: 503 });
  const payload = await req.text();
  let event: { type: string; created_at?: string; data?: Record<string, unknown> };
  try {
    event = new Resend(env().RESEND_API_KEY || 're_unused').webhooks.verify({
      payload,
      headers: {
        id: req.headers.get('svix-id') ?? '',
        timestamp: req.headers.get('svix-timestamp') ?? '',
        signature: req.headers.get('svix-signature') ?? '',
      },
      webhookSecret: secret,
    }) as unknown as typeof event;
  } catch {
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }
  if (!TRACKED.has(event.type)) return Response.json({ ignored: true });
  const data = event.data ?? {};
  const messageId = typeof data.email_id === 'string' ? data.email_id : null;
  if (!messageId) return Response.json({ ignored: true });
  const bounce = data.bounce as { message?: string; type?: string } | undefined;
  const failed = data.failed as { reason?: string } | undefined;
  const found = await recordProviderEvent(db(), {
    type: event.type,
    messageId,
    at: event.created_at ? new Date(event.created_at) : new Date(),
    reason: bounce?.message ?? failed?.reason ?? null,
  });
  if (event.type !== 'email.delivered' && found)
    console.warn(
      `Email ${messageId}: ${event.type}${bounce?.message ? ` (${bounce.message})` : ''}`,
    );
  return Response.json({ recorded: found });
}
