'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  AppError,
  abandonCheckout,
  attachCheckoutSession,
  beginCheckout,
  getStripeLinks,
  linkStripeCustomer,
  planChange,
  type CheckoutInput,
} from '@st/core';
import { db } from '@/lib/db';
import { stripe } from '@/lib/stripe';
import { appUrl, paymentsAvailable } from '@/lib/billing';
import { requireWorkspace, requestMeta } from '@/lib/session';

export type BillingActionState = { ok: boolean; message?: string } | null;

const UNAVAILABLE = 'Payments are not switched on yet. No charge was made.';
const STRIPE_DOWN = 'Stripe could not be reached. No charge was made. Please try again.';

/**
 * Starts Stripe Checkout for credits, one request or a plan. The amount comes from our database;
 * the browser only says which product. Payment is confirmed later by the webhook, never by the
 * redirect back.
 */
async function checkout(input: CheckoutInput, returnPath: string): Promise<BillingActionState> {
  if (!(await paymentsAvailable())) return { ok: false, message: UNAVAILABLE };
  const { user, membership } = await requireWorkspace();
  const actor = { userId: user.id };
  const workspaceId = membership.workspace.id;
  let url: string;
  try {
    const plan = await beginCheckout(db(), actor, workspaceId, input);
    try {
      let customer = plan.customerId;
      if (!customer) {
        const c = await stripe().customers.create(
          {
            name: plan.workspaceName,
            email: plan.customerEmail || undefined,
            metadata: { st_workspace_id: workspaceId },
          },
          { idempotencyKey: `customer:${workspaceId}` },
        );
        customer = c.id;
        await linkStripeCustomer(db(), actor, workspaceId, customer);
      }
      const meta = { st_payment_id: plan.paymentId, st_workspace_id: workspaceId };
      const back = plan.documentId ? `/app/documents/${plan.documentId}` : returnPath;
      const session = await stripe().checkout.sessions.create(
        {
          mode: plan.mode,
          customer,
          client_reference_id: plan.paymentId,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: plan.lineItem.currency.toLowerCase(),
                unit_amount: plan.lineItem.amountCents,
                product_data: { name: plan.lineItem.name, description: plan.lineItem.description },
                ...(plan.mode === 'subscription'
                  ? { recurring: { interval: 'month' as const } }
                  : {}),
              },
            },
          ],
          metadata: meta,
          ...(plan.mode === 'payment'
            ? {
                payment_intent_data: { metadata: meta },
                invoice_creation: {
                  enabled: true,
                  invoice_data: { description: plan.lineItem.name, metadata: meta },
                },
              }
            : {
                subscription_data: {
                  metadata: { st_workspace_id: workspaceId, st_plan_code: plan.planCode ?? '' },
                },
              }),
          success_url: appUrl(
            `/app/billing/return?session_id={CHECKOUT_SESSION_ID}&back=${encodeURIComponent(back)}`,
          ),
          cancel_url: appUrl(`${back}${back.includes('?') ? '&' : '?'}checkout=cancelled`),
        },
        { idempotencyKey: `checkout:${plan.paymentId}` },
      );
      if (!session.url) throw new Error('Stripe returned no checkout URL');
      await attachCheckoutSession(db(), actor, plan.paymentId, session.id, await requestMeta());
      url = session.url;
    } catch (err) {
      console.error('Stripe checkout failed', err);
      await abandonCheckout(
        db(),
        actor,
        plan.paymentId,
        err instanceof Error ? err.message : 'error',
      );
      return { ok: false, message: STRIPE_DOWN };
    }
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    throw err;
  }
  redirect(url);
}

export async function buyCreditsAction(
  priceCode: string,
  _prev: BillingActionState,
): Promise<BillingActionState> {
  return checkout({ kind: 'credits', priceCode }, '/app/billing?tab=credits');
}

export async function subscribeAction(
  planCode: string,
  _prev: BillingActionState,
): Promise<BillingActionState> {
  return checkout({ kind: 'subscription', planCode }, '/app/billing?tab=plans');
}

/** Opens Stripe Checkout for one request straight away (used right after "Sign it yourself"). */
export async function startRequestCheckout(requestId: string): Promise<BillingActionState> {
  return checkout({ kind: 'request', requestId }, '/app/documents');
}

export async function payForRequestAction(
  requestId: string,
  _prev: BillingActionState,
): Promise<BillingActionState> {
  return checkout({ kind: 'request', requestId }, '/app/documents');
}

/** Upgrades take effect and are invoiced now (prorated); downgrades apply from the next bill. */
export async function changePlanAction(
  planCode: string,
  _prev: BillingActionState,
): Promise<BillingActionState> {
  if (!(await paymentsAvailable())) return { ok: false, message: UNAVAILABLE };
  const { user, membership } = await requireWorkspace();
  const workspaceId = membership.workspace.id;
  let change: Awaited<ReturnType<typeof planChange>>;
  try {
    change = await planChange(db(), { userId: user.id }, workspaceId, planCode);
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    throw err;
  }
  try {
    const s = stripe();
    const productId = `st_plan_${change.plan.code}`;
    try {
      await s.products.retrieve(productId);
    } catch {
      await s.products.create({ id: productId, name: `Signature Tender ${change.plan.name}` });
    }
    const sub = await s.subscriptions.retrieve(change.subscriptionId);
    const item = sub.items.data[0];
    if (!item) throw new Error('Subscription has no items');
    await s.subscriptions.update(change.subscriptionId, {
      items: [
        {
          id: item.id,
          price_data: {
            currency: change.plan.currency.toLowerCase(),
            product: productId,
            unit_amount: change.plan.amountCents,
            recurring: { interval: 'month' },
          },
        },
      ],
      metadata: { st_workspace_id: workspaceId, st_plan_code: change.plan.code },
      proration_behavior: change.upgrade ? 'always_invoice' : 'none',
      ...(change.upgrade ? { payment_behavior: 'error_if_incomplete' as const } : {}),
    });
  } catch (err) {
    console.error('Plan change failed', err);
    return {
      ok: false,
      message: 'Your plan could not be changed. No change was made. Please try again.',
    };
  }
  revalidatePath('/app/billing');
  return {
    ok: true,
    message: change.upgrade
      ? `Upgraded to ${change.plan.name}. The extra requests are added as soon as Stripe confirms the prorated charge.`
      : `Your plan changes to ${change.plan.name} from your next billing date. This month's requests stay available.`,
  };
}

/** Stripe's hosted portal: payment methods, cancel or reactivate renewal, invoices. */
export async function openPortalAction(_prev: BillingActionState): Promise<BillingActionState> {
  if (!(await paymentsAvailable())) return { ok: false, message: UNAVAILABLE };
  const { user, membership } = await requireWorkspace();
  let url: string;
  try {
    const links = await getStripeLinks(db(), { userId: user.id }, membership.workspace.id);
    if (!links.customerId)
      return { ok: false, message: 'There is nothing to manage yet. Make a purchase first.' };
    const portal = await stripe().billingPortal.sessions.create({
      customer: links.customerId,
      return_url: appUrl('/app/billing'),
    });
    url = portal.url;
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error('Billing portal failed', err);
    return { ok: false, message: 'Stripe could not be reached. Please try again.' };
  }
  redirect(url);
}
