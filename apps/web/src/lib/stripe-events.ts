import type Stripe from 'stripe';
import type { CheckoutFacts, InvoiceFacts, SubscriptionFacts } from '@st/core';

/** Pure mappings from verified Stripe objects to the plain facts the billing service accepts. */

const id = (v: string | { id: string } | null | undefined) =>
  v == null ? null : typeof v === 'string' ? v : v.id;
const date = (s: number | null | undefined) => (s ? new Date(s * 1000) : null);

export function checkoutFacts(s: Stripe.Checkout.Session): CheckoutFacts {
  return {
    sessionId: s.id,
    mode: s.mode,
    paymentStatus: s.payment_status,
    amountSubtotal: s.amount_subtotal,
    currency: s.currency,
    paymentIntentId: id(s.payment_intent),
    invoiceId: id(s.invoice),
    customerId: id(s.customer),
    subscriptionId: id(s.subscription),
  };
}

export function subscriptionFacts(sub: Stripe.Subscription, deleted: boolean): SubscriptionFacts {
  const items = sub.items?.data ?? [];
  const starts = items.map((i) => i.current_period_start).filter(Boolean);
  const ends = items.map((i) => i.current_period_end).filter(Boolean);
  return {
    subscriptionId: sub.id,
    customerId: id(sub.customer)!,
    status: sub.status,
    planCode: sub.metadata?.st_plan_code ?? null,
    workspaceId: sub.metadata?.st_workspace_id ?? null,
    currentPeriodStart: starts.length ? date(Math.min(...starts)) : null,
    currentPeriodEnd: ends.length ? date(Math.max(...ends)) : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    deleted,
  };
}

export function invoiceFacts(inv: Stripe.Invoice): InvoiceFacts {
  const details = inv.parent?.subscription_details ?? null;
  const lines = inv.lines?.data ?? [];
  const regular = lines.filter((l) => !l.parent?.subscription_item_details?.proration);
  const startFrom = regular.length ? regular : lines;
  return {
    invoiceId: inv.id!,
    customerId: id(inv.customer)!,
    number: inv.number ?? null,
    status: inv.status ?? 'draft',
    description: inv.description ?? lines[0]?.description ?? null,
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    currency: inv.currency,
    hostedUrl: inv.hosted_invoice_url ?? null,
    pdfUrl: inv.invoice_pdf ?? null,
    billingReason: inv.billing_reason ?? null,
    createdAt: date(inv.created) ?? new Date(),
    subscriptionId: id(details?.subscription),
    planCode: details?.metadata?.st_plan_code ?? null,
    periodStart: startFrom.length ? date(Math.min(...startFrom.map((l) => l.period.start))) : null,
    periodEnd: lines.length ? date(Math.max(...lines.map((l) => l.period.end))) : null,
  };
}
