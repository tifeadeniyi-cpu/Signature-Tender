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
import { stripe, stripeLiveMode, webhookSecret } from '@/lib/stripe';
import { liveSendingEnabled } from '@/lib/billing';
import { checkoutFacts, invoiceFacts, subscriptionFacts } from '@/lib/stripe-events';
import {
  applyStudioCheckoutClosed,
  applyStudioCheckoutCompleted,
  applyStudioReversal,
  generateStudioAssets,
  recordStudioEvent,
} from '@st/core/studio/server';
import { studioDeps, studioSettings } from '@/lib/studio';
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
    // Sign it yourself: the sender opens signing from the return page; no email to themselves.
    if (sent.selfSign) return;
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

const isStudio = (s: Stripe.Checkout.Session) => s.metadata?.st_kind === 'signature_studio';

/**
 * A Signature Studio checkout finished. Unlocks only the frozen design, only when our records
 * match what Stripe says was paid. Files are generated now; if that fails the customer keeps
 * access and the files are generated again on download, never with a new charge.
 */
async function studioCompleted(s: Stripe.Checkout.Session) {
  const out = await applyStudioCheckoutCompleted(db(), {
    sessionId: s.id,
    paymentStatus: s.payment_status,
    amountSubtotal: s.amount_subtotal,
    currency: s.currency,
    paymentIntentId: id(s.payment_intent),
    customerEmail: s.customer_details?.email ?? null,
  });
  if (out.action === 'refund_duplicate' && out.paymentIntentId) {
    await stripe().refunds.create(
      {
        payment_intent: out.paymentIntentId,
        reason: 'duplicate',
        metadata: { st_purchase_id: out.purchaseId },
      },
      { idempotencyKey: `studio-duplicate-refund:${out.purchaseId}` },
    );
    return true;
  }
  if (out.action === 'refund_duplicate') return true;
  if (out.action === 'none') return out.reason !== 'unknown_session';
  await recordStudioEvent(db(), 'purchase_completed', {
    userId: out.userId,
    designId: out.designId,
  }).catch(() => undefined);
  try {
    await generateStudioAssets(db(), studioDeps(), out.purchaseId, await studioSettings());
  } catch (err) {
    console.error(`Studio files for ${out.purchaseId} will be generated on download`, err);
  }
  return true;
}

async function handle(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (isStudio(event.data.object)) {
        await studioCompleted(event.data.object);
        return;
      }
      const out = await applyCheckoutCompleted(db(), checkoutFacts(event.data.object));
      if (out.action === 'dispatch') await dispatchPaid(out.requestId, out.dispatchAs);
      // Sessions without our metadata are matched by their id instead.
      if (out.action === 'none' && out.reason === 'unknown_session')
        await studioCompleted(event.data.object);
      return;
    }
    case 'checkout.session.expired':
      await applyCheckoutClosed(db(), event.data.object.id, 'expired');
      await applyStudioCheckoutClosed(db(), event.data.object.id, 'expired');
      return;
    case 'checkout.session.async_payment_failed':
      await applyCheckoutClosed(db(), event.data.object.id, 'failed');
      if (await applyStudioCheckoutClosed(db(), event.data.object.id, 'failed'))
        await recordStudioEvent(db(), 'purchase_failed').catch(() => undefined);
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
      if (pi) {
        const r = await applyReversal(db(), {
          paymentIntentId: pi,
          kind: 'refund',
          amountRefunded: event.data.object.amount_refunded,
        });
        if (!r.found)
          await applyStudioReversal(db(), {
            paymentIntentId: pi,
            kind: 'refund',
            amountRefunded: event.data.object.amount_refunded,
          });
      }
      return;
    }
    case 'charge.dispute.created': {
      const pi = id(event.data.object.payment_intent);
      if (pi) {
        const r = await applyReversal(db(), {
          paymentIntentId: pi,
          kind: 'dispute',
          disputeId: event.data.object.id,
        });
        if (!r.found) await applyStudioReversal(db(), { paymentIntentId: pi, kind: 'dispute' });
      }
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
  // Only act on events from the same mode as our key (live key: live events; test key: test events).
  if (event.livemode !== stripeLiveMode())
    return Response.json({ received: true, ignored: event.livemode ? 'livemode' : 'testmode' });

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
