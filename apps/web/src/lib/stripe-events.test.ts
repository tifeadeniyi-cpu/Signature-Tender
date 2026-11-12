import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { checkoutFacts, invoiceFacts, subscriptionFacts } from './stripe-events';

describe('Stripe event mapping', () => {
  it('reads checkout sessions with expanded or plain ids', () => {
    const f = checkoutFacts({
      id: 'cs_test_1',
      mode: 'payment',
      payment_status: 'paid',
      amount_subtotal: 1299,
      currency: 'usd',
      payment_intent: { id: 'pi_1' },
      invoice: 'in_1',
      customer: 'cus_1',
      subscription: null,
    } as unknown as Stripe.Checkout.Session);
    expect(f).toMatchObject({ paymentIntentId: 'pi_1', invoiceId: 'in_1', amountSubtotal: 1299 });
  });

  it('takes subscription periods from its items and plan from metadata', () => {
    const f = subscriptionFacts(
      {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        cancel_at: null,
        metadata: { st_plan_code: 'business', st_workspace_id: 'w' },
        items: {
          data: [{ current_period_start: 1_800_000_000, current_period_end: 1_802_592_000 }],
        },
      } as unknown as Stripe.Subscription,
      false,
    );
    expect(f.planCode).toBe('business');
    expect(f.currentPeriodEnd?.toISOString()).toBe(new Date(1_802_592_000_000).toISOString());
  });

  it('uses the regular line for the period start and the latest end, ignoring proration starts', () => {
    const f = invoiceFacts({
      id: 'in_2',
      customer: 'cus_1',
      number: 'ST-2',
      status: 'paid',
      amount_due: 1500,
      amount_paid: 1500,
      currency: 'usd',
      billing_reason: 'subscription_update',
      created: 1_800_000_100,
      parent: {
        subscription_details: { subscription: 'sub_1', metadata: { st_plan_code: 'business' } },
      },
      lines: {
        data: [
          {
            period: { start: 1_800_500_000, end: 1_802_592_000 },
            parent: { subscription_item_details: { proration: true } },
          },
          {
            period: { start: 1_800_000_000, end: 1_802_592_000 },
            parent: { subscription_item_details: { proration: false } },
          },
        ],
      },
    } as unknown as Stripe.Invoice);
    expect(f).toMatchObject({ subscriptionId: 'sub_1', planCode: 'business' });
    expect(f.periodStart?.getTime()).toBe(1_800_000_000_000);
    expect(f.periodEnd?.getTime()).toBe(1_802_592_000_000);
  });
});
