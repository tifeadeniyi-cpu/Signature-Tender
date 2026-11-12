import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, withActor, withBillingSystem, schema } from '@st/db';
import {
  createWorkspace,
  createDocumentFromUpload,
  saveRecipients,
  saveFields,
  markReadyToSend,
  getDocument,
  sendForSignature,
  sendPaidRequest,
  cancelRequest,
  getSignerView,
  beginCheckout,
  attachCheckoutSession,
  applyCheckoutCompleted,
  applyCheckoutClosed,
  applySubscription,
  applyInvoice,
  applyReversal,
  claimStripeEvent,
  finishStripeEvent,
  getBillingOverview,
  reconcileCredits,
  planChange,
  linkStripeCustomer,
  MemoryStorage,
  type CheckoutFacts,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, addMember, makePdf } from './helpers';

const { db, close } = createDb(APP_URL, { max: 6 });
const storage = new MemoryStorage();
const LIVE = { mode: 'live' as const, testSigningEnabled: true, liveSendingEnabled: true };
let owner: string, manager: string, editor: string, ws: string;
let sessionSeq = 0;
const RUN = Date.now().toString(36);

async function readyDoc(workspaceId = ws, userId = owner) {
  const actor = { userId };
  const { id } = await createDocumentFromUpload(
    db,
    storage,
    actor,
    {
      workspaceId,
      title: 'Lease',
      documentType: 'agreement',
      filename: 'l.pdf',
      bytes: await makePdf(1),
    },
    { maxBytes: 5 * 1024 * 1024, maxPages: 10 },
  );
  await saveRecipients(
    db,
    actor,
    id,
    {
      signingOrderEnabled: false,
      recipients: [
        {
          name: 'Ann',
          email: 'ann@example.test',
          role: 'signer',
          signingOrder: 1,
          authMethod: 'email_link',
        },
      ],
    },
    { maxSigners: 5 },
  );
  const d = await getDocument(db, actor, id);
  await saveFields(db, actor, id, [
    {
      recipientId: d.recipients[0]!.id,
      type: 'signature',
      page: 1,
      x: 0.1,
      y: 0.7,
      width: 0.3,
      height: 0.06,
    },
  ]);
  expect(await markReadyToSend(db, actor, id)).toEqual([]);
  return id;
}

async function balance(workspaceId = ws) {
  return (await getBillingOverview(db, { userId: owner }, workspaceId)).balances;
}

function facts(
  sessionId: string,
  amount: number,
  extra: Partial<CheckoutFacts> = {},
): CheckoutFacts {
  return {
    sessionId,
    mode: 'payment',
    paymentStatus: 'paid',
    amountSubtotal: amount,
    currency: 'usd',
    paymentIntentId: `pi_${sessionId.slice(3)}`,
    invoiceId: null,
    customerId: null,
    subscriptionId: null,
    ...extra,
  };
}

/** Buys a credit pack through the same path the webhook takes. */
async function buy(priceCode: string, workspaceId = ws) {
  const plan = await beginCheckout(db, { userId: owner }, workspaceId, {
    kind: 'credits',
    priceCode,
  });
  const sid = `cs_test_${++sessionSeq}_${Date.now()}`;
  await attachCheckoutSession(db, { userId: owner }, plan.paymentId, sid);
  const out = await applyCheckoutCompleted(db, facts(sid, plan.lineItem.amountCents));
  return { plan, sid, out };
}

beforeAll(async () => {
  owner = await makeUser('billing_owner');
  manager = await makeUser('billing_manager');
  editor = await makeUser('billing_editor');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Billing WS' })).id;
  await addMember(ws, manager, 'manager');
  await addMember(ws, editor, 'editor');
});
afterAll(async () => {
  await close();
});

describe('live sending and credits', () => {
  it('refuses live sending unless both release flags allow it', async () => {
    const id = await readyDoc();
    await expect(
      sendForSignature(db, storage, { userId: owner }, id, { ...LIVE, liveSendingEnabled: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('holds a live request for payment when there are no credits, and emails nobody', async () => {
    const id = await readyDoc();
    const res = await sendForSignature(db, storage, { userId: owner }, id, LIVE);
    expect(res.status).toBe('awaiting_payment');
    expect(res.invitations).toEqual([]);
    const o = createDb(OWNER_URL, { max: 1 });
    const recips = await o.db
      .select()
      .from(schema.requestRecipients)
      .where(sql`${schema.requestRecipients.requestId} = ${res.requestId}`);
    expect(recips.every((r) => r.tokenHash === null)).toBe(true);
    const [req] = await o.db
      .select()
      .from(schema.signingRequests)
      .where(sql`${schema.signingRequests.id} = ${res.requestId}`);
    expect(req!.isTest).toBe(false);
    expect(req!.sentAt).toBeNull();
    await o.close();
    // Without a credit, "use a credit and send" changes nothing.
    await expect(
      sendPaidRequest(db, { userId: owner }, res.requestId, { liveSendingEnabled: true }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('prices checkout from the database and only lets billing managers start one', async () => {
    const plan = await beginCheckout(db, { userId: owner }, ws, {
      kind: 'credits',
      priceCode: 'bundle_5',
    });
    expect(plan.lineItem.amountCents).toBe(1299);
    expect(plan.mode).toBe('payment');
    await expect(
      beginCheckout(db, { userId: manager }, ws, { kind: 'credits', priceCode: 'bundle_5' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      beginCheckout(db, { userId: owner }, ws, { kind: 'credits', priceCode: 'bundle_999' }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('grants purchased credits once, however many times Stripe repeats the event', async () => {
    const before = await balance();
    const { sid, plan, out } = await buy('bundle_5');
    expect(out).toMatchObject({ action: 'granted', credits: 5 });
    await applyCheckoutCompleted(db, facts(sid, plan.lineItem.amountCents));
    await applyCheckoutCompleted(db, facts(sid, plan.lineItem.amountCents));
    const after = await balance();
    expect(after.purchased - before.purchased).toBe(5);
  });

  it('grants nothing when the amount Stripe reports does not match the database price', async () => {
    const before = await balance();
    const plan = await beginCheckout(db, { userId: owner }, ws, {
      kind: 'credits',
      priceCode: 'bundle_10',
    });
    const sid = `cs_test_mismatch_${Date.now()}`;
    await attachCheckoutSession(db, { userId: owner }, plan.paymentId, sid);
    await expect(applyCheckoutCompleted(db, facts(sid, 1))).rejects.toThrow(/amount/);
    await expect(
      applyCheckoutCompleted(db, facts(sid, plan.lineItem.amountCents, { currency: 'eur' })),
    ).rejects.toThrow(/amount/);
    // An unpaid (settling) checkout grants nothing either.
    const plan2 = await beginCheckout(db, { userId: owner }, ws, {
      kind: 'credits',
      priceCode: 'bundle_10',
    });
    const sid2 = `cs_test_unpaid_${Date.now()}`;
    await attachCheckoutSession(db, { userId: owner }, plan2.paymentId, sid2);
    expect(
      await applyCheckoutCompleted(db, facts(sid2, 2299, { paymentStatus: 'unpaid' })),
    ).toMatchObject({ action: 'none', reason: 'awaiting_settlement' });
    expect((await balance()).purchased).toBe(before.purchased);
    expect(await applyCheckoutCompleted(db, facts('cs_test_unknown', 100))).toMatchObject({
      action: 'none',
      reason: 'unknown_session',
    });
  });

  it('spends a credit when sending live, and a manager can send with workspace credits', async () => {
    const before = await balance();
    expect(before.available).toBeGreaterThan(0);
    const id = await readyDoc(ws, manager);
    const res = await sendForSignature(db, storage, { userId: manager }, id, LIVE);
    expect(res.status).toBe('sent');
    expect(res.invitations).toHaveLength(1);
    expect((await balance()).available).toBe(before.available - 1);
    const view = await getSignerView(db, res.invitations[0]!.token, undefined);
    expect(view.stage).toBe('start');
  });

  it('never spends the same credit twice when sends race', async () => {
    const ws2 = (await createWorkspace(db, { userId: owner }, { name: 'Race WS' })).id;
    await buy('single_request', ws2);
    const docs = await Promise.all([readyDoc(ws2), readyDoc(ws2), readyDoc(ws2)]);
    const results = await Promise.all(
      docs.map((d) => sendForSignature(db, storage, { userId: owner }, d, LIVE)),
    );
    expect(results.filter((r) => r.status === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'awaiting_payment')).toHaveLength(2);
    expect((await balance(ws2)).available).toBe(0);
  });
});

describe('paying for one request', () => {
  it('waits for Stripe, then sends as the original sender; a redirect alone proves nothing', async () => {
    const ws3 = (await createWorkspace(db, { userId: owner }, { name: 'Pay WS' })).id;
    const id = await readyDoc(ws3);
    const res = await sendForSignature(db, storage, { userId: owner }, id, LIVE);
    expect(res.status).toBe('awaiting_payment');
    const plan = await beginCheckout(db, { userId: owner }, ws3, {
      kind: 'request',
      requestId: res.requestId,
    });
    expect(plan.lineItem.amountCents).toBe(299);
    const sid = `cs_test_req_${Date.now()}`;
    await attachCheckoutSession(db, { userId: owner }, plan.paymentId, sid);
    const o = createDb(OWNER_URL, { max: 1 });
    const status = async () =>
      (
        await o.db
          .select({ s: schema.signingRequests.status })
          .from(schema.signingRequests)
          .where(sql`${schema.signingRequests.id} = ${res.requestId}`)
      )[0]!.s;
    expect(await status()).toBe('payment_processing');

    const out = await applyCheckoutCompleted(db, facts(sid, 299));
    expect(out).toMatchObject({ action: 'dispatch', requestId: res.requestId, dispatchAs: owner });
    if (out.action !== 'dispatch') throw new Error('expected dispatch');
    const sent = await sendPaidRequest(db, { userId: out.dispatchAs }, out.requestId, {
      liveSendingEnabled: true,
    });
    expect(sent.invitations).toHaveLength(1);
    expect(await status()).toBe('sent');
    // A repeated webhook neither re-sends nor grants again.
    await applyCheckoutCompleted(db, facts(sid, 299));
    await expect(
      sendPaidRequest(db, { userId: owner }, res.requestId, { liveSendingEnabled: true }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await balance(ws3)).available).toBe(0);
    await o.close();
  });

  it('returns an expired checkout to awaiting payment', async () => {
    const ws4 = (await createWorkspace(db, { userId: owner }, { name: 'Expire WS' })).id;
    const id = await readyDoc(ws4);
    const res = await sendForSignature(db, storage, { userId: owner }, id, LIVE);
    const plan = await beginCheckout(db, { userId: owner }, ws4, {
      kind: 'request',
      requestId: res.requestId,
    });
    const sid = `cs_test_exp_${Date.now()}`;
    await attachCheckoutSession(db, { userId: owner }, plan.paymentId, sid);
    expect(await applyCheckoutClosed(db, sid, 'expired')).toMatchObject({
      requestId: res.requestId,
    });
    const o = createDb(OWNER_URL, { max: 1 });
    const [r] = await o.db
      .select()
      .from(schema.signingRequests)
      .where(sql`${schema.signingRequests.id} = ${res.requestId}`);
    const [p] = await o.db
      .select()
      .from(schema.payments)
      .where(sql`${schema.payments.id} = ${plan.paymentId}`);
    expect(r!.status).toBe('awaiting_payment');
    expect(p!.status).toBe('expired');
    await o.close();
  });
});

describe('cancellation policy', () => {
  it('restores the credit for an unopened request but not after a recipient opened it', async () => {
    const ws5 = (await createWorkspace(db, { userId: owner }, { name: 'Cancel WS' })).id;
    await buy('bundle_5', ws5);
    const a = await sendForSignature(db, storage, { userId: owner }, await readyDoc(ws5), LIVE);
    const b = await sendForSignature(db, storage, { userId: owner }, await readyDoc(ws5), LIVE);
    expect((await balance(ws5)).available).toBe(3);
    await cancelRequest(db, { userId: owner }, a.requestId, 'Wrong file');
    expect((await balance(ws5)).available).toBe(4);
    // Cancelling again cannot restore twice.
    await expect(cancelRequest(db, { userId: owner }, a.requestId, '')).rejects.toMatchObject({
      code: 'conflict',
    });
    const o = createDb(OWNER_URL, { max: 1 });
    await o.db
      .update(schema.requestRecipients)
      .set({ viewedAt: new Date(), status: 'viewed' })
      .where(sql`${schema.requestRecipients.requestId} = ${b.requestId}`);
    await o.close();
    await cancelRequest(db, { userId: owner }, b.requestId, 'Changed mind');
    expect((await balance(ws5)).available).toBe(4);
  });
});

describe('subscriptions', () => {
  it('grants the monthly allowance, spends it first, and expires it at the next period', async () => {
    const ws6 = (await createWorkspace(db, { userId: owner }, { name: 'Sub WS' })).id;
    await buy('single_request', ws6);
    const plan = await beginCheckout(db, { userId: owner }, ws6, {
      kind: 'subscription',
      planCode: 'starter',
    });
    expect(plan).toMatchObject({ mode: 'subscription', lineItem: { amountCents: 999 } });
    const cus = `cus_test${Date.now()}`;
    await linkStripeCustomer(db, { userId: owner }, ws6, cus);
    const sid = `cs_test_sub_${Date.now()}`;
    await attachCheckoutSession(db, { userId: owner }, plan.paymentId, sid);
    await applyCheckoutCompleted(
      db,
      facts(sid, 999, { mode: 'subscription', customerId: cus, subscriptionId: `sub_1_${RUN}` }),
    );
    const start = new Date();
    const end = new Date(Date.now() + 30 * 86_400_000);
    await applySubscription(db, {
      subscriptionId: `sub_1_${RUN}`,
      customerId: cus,
      status: 'active',
      planCode: 'starter',
      workspaceId: ws6,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      deleted: false,
    });
    const inv = {
      customerId: cus,
      number: 'ST-1',
      status: 'paid',
      description: null,
      amountDue: 999,
      amountPaid: 999,
      currency: 'usd',
      hostedUrl: 'https://invoice.stripe.com/i/x',
      pdfUrl: 'https://pay.stripe.com/invoice/x/pdf',
      createdAt: new Date(),
      subscriptionId: `sub_1_${RUN}`,
      planCode: 'starter',
      periodStart: start,
      periodEnd: end,
    };
    await applyInvoice(db, {
      ...inv,
      invoiceId: `in_1_${RUN}`,
      billingReason: 'subscription_create',
    });
    await applyInvoice(db, {
      ...inv,
      invoiceId: `in_1_${RUN}`,
      billingReason: 'subscription_create',
    });
    let b = await balance(ws6);
    expect(b).toMatchObject({ allowance: 10, purchased: 1 });
    const overview = await getBillingOverview(db, { userId: owner }, ws6);
    expect(overview.isSubscribed).toBe(true);
    expect(overview.requestPrice).toMatchObject({ amountCents: 149, source: 'overage' });
    expect(overview.invoices).toHaveLength(1);

    await sendForSignature(db, storage, { userId: owner }, await readyDoc(ws6), LIVE);
    b = await balance(ws6);
    expect(b).toMatchObject({ allowance: 9, purchased: 1 });

    // Upgrade mid-period tops the allowance up to the new plan's amount.
    const change = await planChange(db, { userId: owner }, ws6, 'business');
    expect(change.upgrade).toBe(true);
    await applyInvoice(db, {
      ...inv,
      invoiceId: `in_up_${RUN}`,
      billingReason: 'subscription_update',
      planCode: 'business',
    });
    expect((await balance(ws6)).allowance).toBe(9 + 25);

    // Next period: unused allowance expires, the new allowance arrives, purchased credits stay.
    const end2 = new Date(end.getTime() + 30 * 86_400_000);
    await applyInvoice(db, {
      ...inv,
      invoiceId: `in_2_${RUN}`,
      billingReason: 'subscription_cycle',
      planCode: 'business',
      periodStart: end,
      periodEnd: end2,
    });
    expect(await balance(ws6)).toMatchObject({ allowance: 35, purchased: 1 });

    // Subscription ends: allowance expires, back to pay-as-you-go pricing.
    await applySubscription(db, {
      subscriptionId: `sub_1_${RUN}`,
      customerId: cus,
      status: 'canceled',
      planCode: 'business',
      workspaceId: ws6,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      deleted: true,
    });
    expect(await balance(ws6)).toMatchObject({ allowance: 0, purchased: 1 });
    const after = await getBillingOverview(db, { userId: owner }, ws6);
    expect(after.isSubscribed).toBe(false);
    expect(after.requestPrice).toMatchObject({ amountCents: 299, source: 'single' });
  });
});

describe('refunds and disputes', () => {
  it('reverses unused credits from a refunded purchase, never below zero', async () => {
    const ws7 = (await createWorkspace(db, { userId: owner }, { name: 'Refund WS' })).id;
    const { sid } = await buy('bundle_5', ws7);
    const pi = `pi_${sid.slice(3)}`;
    await sendForSignature(db, storage, { userId: owner }, await readyDoc(ws7), LIVE);
    await sendForSignature(db, storage, { userId: owner }, await readyDoc(ws7), LIVE);
    expect((await balance(ws7)).purchased).toBe(3);
    // Partial refund of about 40%: two credits' worth.
    await applyReversal(db, { paymentIntentId: pi, kind: 'refund', amountRefunded: 520 });
    expect((await balance(ws7)).purchased).toBe(1);
    await applyReversal(db, { paymentIntentId: pi, kind: 'refund', amountRefunded: 520 });
    expect((await balance(ws7)).purchased).toBe(1);
    // Full refund: the rest is reversed, but used credits cannot go negative.
    await applyReversal(db, { paymentIntentId: pi, kind: 'refund', amountRefunded: 1299 });
    expect((await balance(ws7)).purchased).toBe(0);
    const o = (await getBillingOverview(db, { userId: owner }, ws7)).payments[0]!;
    expect(o.status).toBe('refunded');
    expect(await reconcileCredits(db, { userId: owner }, ws7)).toEqual([]);
  });

  it('reverses credits when a payment is disputed', async () => {
    const ws8 = (await createWorkspace(db, { userId: owner }, { name: 'Dispute WS' })).id;
    const { sid } = await buy('bundle_10', ws8);
    await applyReversal(db, {
      paymentIntentId: `pi_${sid.slice(3)}`,
      kind: 'dispute',
      disputeId: `dp_1_${RUN}`,
    });
    expect((await balance(ws8)).purchased).toBe(0);
  });
});

describe('billing access rules', () => {
  it('lets nobody signed in grant credits, and hides payments from non-billing roles', async () => {
    await expect(
      withActor(db, { userId: owner }, (tx) =>
        tx.insert(schema.creditLedger).values({
          workspaceId: ws,
          entryType: 'purchase',
          bucket: 'purchased',
          delta: 100,
          idempotencyKey: `forged:${Date.now()}`,
          createdBy: owner,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withActor(db, { userId: owner }, (tx) =>
        tx
          .update(schema.creditLedger)
          .set({ delta: 50 })
          .where(sql`true`),
      ),
    ).rejects.toThrow();
    const asManager = await getBillingOverview(db, { userId: manager }, ws);
    expect(asManager.canManage).toBe(false);
    expect(asManager.payments).toEqual([]);
    expect(asManager.balances.available).toBeGreaterThanOrEqual(0);
    const seen = await withActor(db, { userId: manager }, (tx) =>
      tx.select().from(schema.payments),
    );
    expect(seen).toEqual([]);
    await expect(getBillingOverview(db, { userId: editor }, ws)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const outsider = await makeUser('billing_outsider');
    const rows = await withActor(db, { userId: outsider }, (tx) =>
      tx.select().from(schema.creditLedger),
    );
    expect(rows).toEqual([]);
  });

  it('processes each Stripe event once', async () => {
    const id = `evt_test_${Date.now()}`;
    expect(
      await claimStripeEvent(db, { id, type: 'checkout.session.completed', livemode: false }),
    ).toBe(true);
    expect(
      await claimStripeEvent(db, { id, type: 'checkout.session.completed', livemode: false }),
    ).toBe(true);
    await finishStripeEvent(db, id, null);
    expect(
      await claimStripeEvent(db, { id, type: 'checkout.session.completed', livemode: false }),
    ).toBe(false);
    // Event records are invisible outside the billing system context.
    const asUser = await withActor(db, { userId: owner }, (tx) =>
      tx.select().from(schema.stripeEvents),
    );
    expect(asUser).toEqual([]);
    const asSystem = await withBillingSystem(db, (tx) =>
      tx
        .select()
        .from(schema.stripeEvents)
        .where(sql`${schema.stripeEvents.id} = ${id}`),
    );
    expect(asSystem[0]!.attempts).toBe(3);
  });
});
