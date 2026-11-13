import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, schema } from '@st/db';
import {
  createWorkspace,
  createDocumentFromUpload,
  saveRecipients,
  saveFields,
  markReadyToSend,
  getDocument,
  sendForSignature,
  sendPaidRequest,
  openSelfSigning,
  startSigning,
  beginCheckout,
  attachCheckoutSession,
  applyCheckoutCompleted,
  getBillingOverview,
  getRequestBilling,
  MemoryStorage,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, addMember, makePdf } from './helpers';

/** "Sign it yourself": the sender is the only signer, for a flat $0.99 that never touches credits. */

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const LIVE = {
  mode: 'live' as const,
  testSigningEnabled: true,
  liveSendingEnabled: true,
  specializedAck: { source: 'sender' as const },
};
let me: string, myEmail: string, teammate: string, ws: string;
let seq = 0;

async function readyDoc(recipients: { name: string; email: string }[], who = me) {
  const actor = { userId: who };
  const { id } = await createDocumentFromUpload(
    db,
    storage,
    actor,
    {
      workspaceId: ws,
      title: 'My lease',
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
      recipients: recipients.map((r) => ({
        ...r,
        role: 'signer' as const,
        signingOrder: 1,
        authMethod: 'email_link' as const,
      })),
    },
    { maxSigners: 5 },
  );
  const d = await getDocument(db, actor, id);
  await saveFields(
    db,
    actor,
    id,
    d.recipients.map((r, i) => ({
      recipientId: r.id,
      type: 'signature' as const,
      page: 1,
      x: 0.1,
      y: 0.5 + i * 0.15,
      width: 0.3,
      height: 0.06,
    })),
  );
  expect(await markReadyToSend(db, actor, id)).toEqual([]);
  return id;
}

async function pay(requestId: string, who = me) {
  const plan = await beginCheckout(db, { userId: who }, ws, { kind: 'request', requestId });
  const sid = `cs_test_self_${++seq}_${Date.now()}`;
  await attachCheckoutSession(db, { userId: who }, plan.paymentId, sid);
  const out = await applyCheckoutCompleted(db, {
    sessionId: sid,
    mode: 'payment',
    paymentStatus: 'paid',
    amountSubtotal: plan.lineItem.amountCents,
    currency: 'usd',
    paymentIntentId: `pi_${sid.slice(3)}`,
    invoiceId: null,
    customerId: null,
    subscriptionId: null,
  });
  return { plan, out };
}

async function giveCredits(n: number) {
  await owner_.db.insert(schema.creditLedger).values({
    workspaceId: ws,
    entryType: 'purchase',
    bucket: 'purchased',
    delta: n,
    idempotencyKey: `test-credit:${crypto.randomUUID()}`,
  });
}

beforeAll(async () => {
  me = await makeUser('self_signer');
  myEmail = `${me}@example.test`;
  teammate = await makeUser('self_teammate');
  ws = (await createWorkspace(db, { userId: me }, { name: 'Self WS' })).id;
  await addMember(ws, teammate, 'manager');
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('sign it yourself', () => {
  it('waits for its own $0.99 payment and never spends a credit', async () => {
    await giveCredits(3);
    const before = (await getBillingOverview(db, { userId: me }, ws)).balances;
    const id = await readyDoc([{ name: 'Me', email: myEmail.toUpperCase() }]);
    const res = await sendForSignature(db, storage, { userId: me }, id, LIVE);
    expect(res).toMatchObject({ status: 'awaiting_payment', selfSign: true, invitations: [] });
    expect((await getBillingOverview(db, { userId: me }, ws)).balances).toEqual(before);

    const billing = await getRequestBilling(db, { userId: me }, res.requestId);
    expect(billing).toMatchObject({ selfSign: true, price: { amountCents: 99, currency: 'USD' } });

    // Not payable before paying: the signing link will not open.
    await expect(openSelfSigning(db, { userId: me }, res.requestId)).rejects.toMatchObject({
      code: 'conflict',
    });

    const { plan, out } = await pay(res.requestId);
    expect(plan.lineItem).toMatchObject({
      amountCents: 99,
      name: 'Signature Tender: sign it yourself',
    });
    expect(out).toMatchObject({ action: 'dispatch', requestId: res.requestId });
    const [payment] = await owner_.db
      .select()
      .from(schema.payments)
      .where(sql`${schema.payments.id} = ${plan.paymentId}`);
    expect(payment).toMatchObject({ credits: 0, priceCode: 'self_sign', status: 'paid' });

    const sent = await sendPaidRequest(db, { userId: me }, res.requestId, {
      liveSendingEnabled: true,
    });
    expect(sent.selfSign).toBe(true);
    expect((await getBillingOverview(db, { userId: me }, ws)).balances).toEqual(before);

    // The owner goes straight to signing with a fresh link; a teammate cannot.
    await expect(openSelfSigning(db, { userId: teammate }, res.requestId)).rejects.toMatchObject({
      code: 'not_found',
    });
    const { token } = await openSelfSigning(db, { userId: me }, res.requestId);
    expect(await startSigning(db, token)).toMatchObject({ session: expect.any(String) });
  });

  it('a document with another signer is a normal request and uses a credit', async () => {
    const id = await readyDoc([
      { name: 'Me', email: myEmail },
      { name: 'Ann', email: 'ann.self@example.test' },
    ]);
    const before = (await getBillingOverview(db, { userId: me }, ws)).balances;
    const res = await sendForSignature(db, storage, { userId: me }, id, LIVE);
    expect(res).toMatchObject({ status: 'sent', selfSign: false });
    expect((await getBillingOverview(db, { userId: me }, ws)).balances.purchased).toBe(
      before.purchased - 1,
    );
    await expect(openSelfSigning(db, { userId: me }, res.requestId)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('a request for someone else is never priced as self-signing', async () => {
    const id = await readyDoc([{ name: 'Ann', email: 'ann.only@example.test' }]);
    const res = await sendForSignature(db, storage, { userId: me }, id, LIVE);
    expect(res.selfSign).toBe(false);
  });

  it('a teammate without billing access pays for their own self-signing, and nothing else', async () => {
    const mateEmail = `${teammate}@example.test`;
    const id = await readyDoc([{ name: 'Mate', email: mateEmail }], teammate);
    const res = await sendForSignature(db, storage, { userId: teammate }, id, LIVE);
    expect(res).toMatchObject({ status: 'awaiting_payment', selfSign: true });
    expect(await getRequestBilling(db, { userId: teammate }, res.requestId)).toMatchObject({
      canManage: true,
      selfSign: true,
    });
    const { plan, out } = await pay(res.requestId, teammate);
    expect(plan.lineItem.amountCents).toBe(99);
    expect(out).toMatchObject({ action: 'dispatch' });
    const sent = await sendPaidRequest(db, { userId: teammate }, res.requestId, {
      liveSendingEnabled: true,
    });
    expect(sent.selfSign).toBe(true);
    expect(await openSelfSigning(db, { userId: teammate }, res.requestId)).toMatchObject({
      token: expect.any(String),
    });

    // A normal request still needs an owner or admin to pay.
    const other = await readyDoc([{ name: 'Zed', email: 'zed.other@example.test' }], teammate);
    const r2 = await sendForSignature(db, storage, { userId: teammate }, other, LIVE);
    if (r2.status === 'awaiting_payment')
      await expect(
        beginCheckout(db, { userId: teammate }, ws, { kind: 'request', requestId: r2.requestId }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    // And the owner's own self-sign payment is not the teammate's to touch.
    await expect(
      beginCheckout(db, { userId: teammate }, ws, { kind: 'credits', priceCode: 'pack_5' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
