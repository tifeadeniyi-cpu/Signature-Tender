import { kickWebhooks } from '@/lib/webhooks';
import type Stripe from 'stripe';
import {
  AppError,
  applyCheckoutClosed,
  applyCheckoutCompleted,
  applyInvoice,
  applyReversal,
  applySubscription,
  claimStripeEvent,
  finishStripeEvent,
  sendPaidRequest,
} from '@st/core';
import { db } from '@/lib/db';
import { stripe, webhookSecret } from '@/lib/stripe';
import { liveSendingEnabled } from '@/lib/billing';
import { checkoutFacts, invoiceFacts, subscriptionFacts } from '@/lib/stripe-events';
import { sendInvitations } from '@/lib/signing-mail';

export const dynamic = 'force-dynamic';

const id = (v: string | { id: string } | null | undefined) =>
  v == null ? null : typeof v === 'string' ? v : v.id;

/** Sends a request that was just paid for, as the person who prepared it. */
async function dispatchPaid(requestId: string, dispatchAs: string) {
  try {
    const sent = await sendPaidRequest(
      db(),
      { userId: dispatchAs },
      requestId,
      { liveSendingEnabled: await liveSendingEnabled() },
      { userAgent: 'Stripe webhook' },
    );
    await sendInvitations(sent.invitations, {
      title: sent.title,
      senderName: sent.senderName,
      workspaceName: sent.workspaceName,
      message: sent.emailMessage,
      isTest: false,
      workspaceId: sent.workspaceId,
    });
  } catch (err) {
    // The payment is safe as a credit; the sender can use it from the document page.
    if (err instanceof AppError) {
      console.warn(`Paid request ${requestId} was not sent: ${err.message}`);
      return;
    }
    throw err;
  }
}

async function handle(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const out = await applyCheckoutCompleted(db(), checkoutFacts(event.data.object));
      if (out.action === 'dispatch') await dispatchPaid(out.requestId, out.dispatchAs);
      return;
    }
    case 'checkout.session.expired':
      await applyCheckoutClosed(db(), event.data.object.id, 'expired');
      return;
    case 'checkout.session.async_payment_failed':
      await applyCheckoutClosed(db(), event.data.object.id, 'failed');
      return;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applySubscription(
        db(),
        subscriptionFacts(event.data.object, event.type === 'customer.subscription.deleted'),
      );
      return;
    case 'invoice.finalized':
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.voided':
      await applyInvoice(db(), invoiceFacts(event.data.object));
      return;
    case 'charge.refunded': {
      const pi = id(event.data.object.payment_intent);
      if (pi)
        await applyReversal(db(), {
          paymentIntentId: pi,
          kind: 'refund',
          amountRefunded: event.data.object.amount_refunded,
        });
      return;
    }
    case 'charge.dispute.created': {
      const pi = id(event.data.object.payment_intent);
      if (pi)
        await applyReversal(db(), {
          paymentIntentId: pi,
          kind: 'dispute',
          disputeId: event.data.object.id,
        });
      return;
    }
    default:
      return;
  }
}

/**
 * Stripe webhook. Nothing here trusts the browser: credits and sends happen only for events whose
 * signature verifies with our endpoint secret. Each event is processed once; a failure returns 500
 * so Stripe retries, and every step is idempotent so a retry cannot double-grant.
 */
export async function POST(req: Request) {
  kickWebhooks();
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, webhookSecret());
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
  // Test mode only for now: live events are acknowledged and ignored.
  if (event.livemode) return Response.json({ received: true, ignored: 'livemode' });

  if (!(await claimStripeEvent(db(), event)))
    return Response.json({ received: true, duplicate: true });
  try {
    await handle(event);
    await finishStripeEvent(db(), event.id, null);
  } catch (err) {
    console.error(`Stripe event ${event.id} (${event.type}) failed`, err);
    await finishStripeEvent(db(), event.id, err instanceof Error ? err.message : String(err));
    return new Response('Processing failed', { status: 500 });
  }
  return Response.json({ received: true });
}
