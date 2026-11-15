import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDb, schema } from '@st/db';
import {
  createWorkspace,
  createDocumentFromUpload,
  saveRecipients,
  saveFields,
  markReadyToSend,
  getDocument,
  sendForSignature,
  beginCheckout,
  attachCheckoutSession,
  applyCheckoutCompleted,
  applyReversal,
  cancelRequest,
  getBillingOverview,
  ensureReferralLink,
  checkReferralCode,
  attributeNewAccount,
  markReferralVerified,
  grantWelcomeCredit,
  qualifyReferralPayment,
  releaseDueReferralRewards,
  getReferralCenter,
  getReferralAdmin,
  reviewReferral,
  setReferralLinkStatus,
  adjustReferralCredits,
  saveReferralProgram,
  getReferralProgram,
  canonicalEmail,
  maskName,
  normalizeReferralCode,
  needsReview,
  MemoryStorage,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, makePdf } from './helpers';

/** Give 1, Get 2: attribution, welcome credit, referrer reward, redemption, reversal, admin. */

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const LIVE = {
  mode: 'live' as const,
  testSigningEnabled: true,
  liveSendingEnabled: true,
  specializedAck: { source: 'sender' as const },
};
let referrer: string, referrerWs: string, code: string, staff: string;
let seq = 0;

async function newAccount(label: string, verified: boolean, emailOverride?: string) {
  const id = `test_${label}_${crypto.randomUUID()}`;
  const email = emailOverride ?? `${id}@example.test`;
  await owner_.db
    .insert(schema.user)
    .values({ id, name: `Pat ${label} Rivers`, email, emailVerified: verified });
  return { id, email };
}

async function readyDoc(userId: string, workspaceId: string) {
  const actor = { userId };
  const { id } = await createDocumentFromUpload(
    db,
    storage,
    actor,
    {
      workspaceId,
      title: 'Agreement',
      documentType: 'agreement',
      filename: 'a.pdf',
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
          name: 'Client',
          email: `client.${++seq}@example.test`,
          role: 'signer' as const,
          signingOrder: 1,
          authMethod: 'email_link' as const,
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
      y: 0.5,
      width: 0.3,
      height: 0.06,
    },
  ]);
  expect(await markReadyToSend(db, actor, id)).toEqual([]);
  return id;
}

async function pay(userId: string, workspaceId: string, requestId: string) {
  const plan = await beginCheckout(db, { userId }, workspaceId, { kind: 'request', requestId });
  const sid = `cs_test_ref_${++seq}_${Date.now()}`;
  await attachCheckoutSession(db, { userId }, plan.paymentId, sid);
  await applyCheckoutCompleted(db, {
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
  return { paymentId: plan.paymentId, paymentIntentId: `pi_${sid.slice(3)}` };
}

const balances = async (userId: string, ws: string) =>
  (await getBillingOverview(db, { userId }, ws)).balances;

async function setProgram(patch: Partial<typeof schema.referralPrograms.$inferInsert>) {
  await owner_.db
    .update(schema.referralPrograms)
    .set(patch)
    .where(eq(schema.referralPrograms.key, 'standard'));
}

beforeAll(async () => {
  await setProgram({ status: 'active', qualificationDelayHours: 0, settings: {} });
  referrer = await makeUser('ref_owner');
  referrerWs = (await createWorkspace(db, { userId: referrer }, { name: 'Referrer WS' })).id;
  code = (await ensureReferralLink(db, { userId: referrer }, referrerWs)).code;
  staff = await makeUser('ref_staff');
  await owner_.db.insert(schema.platformAdmins).values({ userId: staff }).onConflictDoNothing();
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('referral codes', () => {
  it('normalizes, masks and canonicalizes', () => {
    expect(normalizeReferralCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizeReferralCode('ABC10OIL')).toBeNull();
    expect(canonicalEmail('Jo.Ann+promo@GoogleMail.com')).toBe('joann@gmail.com');
    expect(canonicalEmail('jo.ann+x@example.com')).toBe('jo.ann@example.com');
    expect(maskName('Patricia Ann Rivers')).toBe('Patricia R.');
    expect(maskName('')).toBe('New customer');
    expect(needsReview(['shared_network'])).toBe(false);
    expect(needsReview(['shared_network', 'velocity'])).toBe(true);
  });

  it('gives each person one stable, random link per workspace', async () => {
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await ensureReferralLink(db, { userId: referrer }, referrerWs)).code).toBe(code);
    const other = await makeUser('ref_other');
    const otherWs = (await createWorkspace(db, { userId: other }, { name: 'Other' })).id;
    expect((await ensureReferralLink(db, { userId: other }, otherWs)).code).not.toBe(code);
    // Not a member: no link in someone else's workspace.
    await expect(ensureReferralLink(db, { userId: other }, referrerWs)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('rejects bad, own and existing-customer uses without revealing the owner', async () => {
    expect(await checkReferralCode(db, 'ZZZZZZZZ')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await checkReferralCode(db, 'nope')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await checkReferralCode(db, code.toLowerCase())).toMatchObject({
      ok: true,
      referredCredits: 1,
      referrerCredits: 2,
    });
    const ownEmail = `${referrer}@example.test`.replace('@', '+alt@');
    expect(await checkReferralCode(db, code, { email: ownEmail })).toMatchObject({
      reason: 'self_referral',
    });
    const existing = await makeUser('ref_existing');
    expect(await checkReferralCode(db, code, { email: `${existing}@example.test` })).toMatchObject({
      reason: 'existing_customer',
    });
    const res = await checkReferralCode(db, 'ZZZZZZZZ');
    expect(JSON.stringify(res)).not.toContain(referrer);
  });
});

describe('the full Give 1, Get 2 flow', () => {
  let friend: { id: string; email: string };
  let friendWs: string;

  it('attributes a new account but pays nothing until the email is verified', async () => {
    friend = await newAccount('ref_friend', false);
    const out = await attributeNewAccount(db, {
      userId: friend.id,
      email: friend.email,
      emailVerified: false,
      code,
      source: 'link',
    });
    expect(out.attributed).toBe(true);
    expect(out.notices).toEqual([
      expect.objectContaining({
        kind: 'referral_joined',
        to: `${referrer}@example.test`,
        referrerCredits: 2,
      }),
    ]);
    // A second attribution (another code, or the same twice) never replaces the first.
    const again = await attributeNewAccount(db, {
      userId: friend.id,
      email: friend.email,
      emailVerified: false,
      code,
      source: 'code',
    });
    expect(again).toMatchObject({ attributed: false, reason: 'already_referred' });
    expect((await balances(referrer, referrerWs)).referral).toBe(0);
  });

  it('pays exactly 1 welcome credit once verified and a workspace exists, once', async () => {
    await owner_.db
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, friend.id));
    // Verified but no workspace yet: nothing to pay into.
    expect(await markReferralVerified(db, friend.id)).toEqual([]);
    friendWs = (await createWorkspace(db, { userId: friend.id }, { name: 'Friend WS' })).id;
    const notices = await grantWelcomeCredit(db, friend.id);
    expect(notices).toEqual([expect.objectContaining({ kind: 'welcome_credit', credits: 1 })]);
    expect(await grantWelcomeCredit(db, friend.id)).toEqual([]);
    await Promise.all([grantWelcomeCredit(db, friend.id), grantWelcomeCredit(db, friend.id)]);
    expect((await balances(friend.id, friendWs)).referral).toBe(1);
    // Signing up alone does not reward the referrer.
    expect((await balances(referrer, referrerWs)).referral).toBe(0);
  });

  it('spends the referral credit on a web send, and returns it if the send is cancelled', async () => {
    const doc = await readyDoc(friend.id, friendWs);
    const res = await sendForSignature(db, storage, { userId: friend.id }, doc, LIVE);
    expect(res.status).toBe('sent');
    expect((await balances(friend.id, friendWs)).referral).toBe(0);
    await cancelRequest(db, { userId: friend.id }, res.requestId, 'Wrong file');
    expect((await balances(friend.id, friendWs)).referral).toBe(1);
  });

  it('never spends referral credits on an API send', async () => {
    const doc = await readyDoc(friend.id, friendWs);
    const res = await sendForSignature(db, storage, { userId: friend.id }, doc, {
      ...LIVE,
      channel: 'api',
    });
    expect(res.status).toBe('awaiting_payment');
    expect((await balances(friend.id, friendWs)).referral).toBe(1);
  });

  let qualifying: { paymentId: string; paymentIntentId: string };
  it('rewards the referrer exactly 2 credits on the first settled paid send', async () => {
    // Use the welcome credit, then pay for the next send.
    const first = await sendForSignature(
      db,
      storage,
      { userId: friend.id },
      await readyDoc(friend.id, friendWs),
      LIVE,
    );
    expect(first.status).toBe('sent');
    const second = await sendForSignature(
      db,
      storage,
      { userId: friend.id },
      await readyDoc(friend.id, friendWs),
      LIVE,
    );
    expect(second.status).toBe('awaiting_payment');
    qualifying = await pay(friend.id, friendWs, second.requestId);
    const notices = await qualifyReferralPayment(db, qualifying.paymentId);
    expect(notices).toEqual([expect.objectContaining({ kind: 'reward_earned', credits: 2 })]);
    // A repeated webhook, or two at once, never pays again.
    expect(await qualifyReferralPayment(db, qualifying.paymentId)).toEqual([]);
    await Promise.all([
      qualifyReferralPayment(db, qualifying.paymentId),
      qualifyReferralPayment(db, qualifying.paymentId),
      releaseDueReferralRewards(db),
    ]);
    expect((await balances(referrer, referrerWs)).referral).toBe(2);
    const center = await getReferralCenter(db, { userId: referrer }, referrerWs);
    expect(center.summary).toMatchObject({ successful: 1, earned: 2, available: 2 });
    expect(center.history[0]).toMatchObject({
      displayName: 'Pat R.',
      status: 'rewarded',
      step: 4,
      rewardCredits: 2,
    });
    expect(JSON.stringify(center.history)).not.toContain(friend.email);
    expect(center.activity.map((a) => a.type)).toContain('reward');
  });

  it('takes back unused reward credits when the qualifying payment is refunded', async () => {
    const out = await applyReversal(db, {
      paymentIntentId: qualifying.paymentIntentId,
      kind: 'refund',
      amountRefunded: 1_000_000,
    });
    expect(out.referralNotices).toEqual([expect.objectContaining({ kind: 'reward_adjusted' })]);
    expect((await balances(referrer, referrerWs)).referral).toBe(0);
    const center = await getReferralCenter(db, { userId: referrer }, referrerWs);
    expect(center.history[0]).toMatchObject({ status: 'reversed', rewardCredits: 0 });
    expect(center.activity[0]).toMatchObject({ type: 'reversal', delta: -2 });
  });
});

describe('payments that do not qualify', () => {
  it('a failed or unsettled payment does not reward anyone', async () => {
    const f = await newAccount('ref_unpaid', true);
    await attributeNewAccount(db, {
      userId: f.id,
      email: f.email,
      emailVerified: true,
      code,
      source: 'code',
    });
    const ws = (await createWorkspace(db, { userId: f.id }, { name: 'Unpaid WS' })).id;
    await grantWelcomeCredit(db, f.id);
    await sendForSignature(db, storage, { userId: f.id }, await readyDoc(f.id, ws), LIVE);
    const r = await sendForSignature(db, storage, { userId: f.id }, await readyDoc(f.id, ws), LIVE);
    const plan = await beginCheckout(db, { userId: f.id }, ws, {
      kind: 'request',
      requestId: r.requestId,
    });
    const sid = `cs_test_ref_unpaid_${Date.now()}`;
    await attachCheckoutSession(db, { userId: f.id }, plan.paymentId, sid);
    await applyCheckoutCompleted(db, {
      sessionId: sid,
      mode: 'payment',
      paymentStatus: 'unpaid',
      amountSubtotal: plan.lineItem.amountCents,
      currency: 'usd',
      paymentIntentId: null,
      invoiceId: null,
      customerId: null,
      subscriptionId: null,
    });
    const before = (await balances(referrer, referrerWs)).referral;
    expect(await qualifyReferralPayment(db, plan.paymentId)).toEqual([]);
    expect((await balances(referrer, referrerWs)).referral).toBe(before);
  });
});

describe('risk review and administration', () => {
  it('holds a risky referral for review; staff approval pays it, with an audit trail', async () => {
    const f = await newAccount('ref_risky', true, `risky.${Date.now()}@mailinator.com`);
    await attributeNewAccount(db, {
      userId: f.id,
      email: f.email,
      emailVerified: true,
      code,
      source: 'link',
    });
    const ws = (await createWorkspace(db, { userId: f.id }, { name: 'Risky WS' })).id;
    expect(await grantWelcomeCredit(db, f.id)).toEqual([]);
    expect((await balances(f.id, ws)).referral).toBe(0);
    const admin = await getReferralAdmin(db, staff, { status: 'under_review' });
    const row = admin.rows.find((r) => r.referred_email === f.email)!;
    expect(row).toMatchObject({ status: 'under_review', risk_flags: ['disposable_email'] });
    // Not staff: refused.
    await expect(reviewReferral(db, referrer, row.id, 'approve', '')).rejects.toBeTruthy();
    const notices = await reviewReferral(db, staff, row.id, 'approve', 'Real customer, checked');
    expect(notices).toEqual([expect.objectContaining({ kind: 'welcome_credit' })]);
    expect((await balances(f.id, ws)).referral).toBe(1);
    const [ev] = await owner_.db
      .select()
      .from(schema.referralEvents)
      .where(
        sql`${schema.referralEvents.attributionId} = ${row.id} and ${schema.referralEvents.type} = 'review.approved'`,
      );
    expect(ev).toMatchObject({ actorType: 'admin', actorUserId: staff });
  });

  it('a self-referral through a Gmail alias is rejected', async () => {
    const own = await makeUser('ref_gmail');
    const ownWs = (await createWorkspace(db, { userId: own }, { name: 'G' })).id;
    const tag = crypto.randomUUID().slice(0, 8);
    await owner_.db
      .update(schema.user)
      .set({ email: `pat.self.${tag}@gmail.com` })
      .where(eq(schema.user.id, own));
    const ownCode = (await ensureReferralLink(db, { userId: own }, ownWs)).code;
    const alias = await newAccount('ref_alias', true, `patself${tag}+x@gmail.com`);
    const out = await attributeNewAccount(db, {
      userId: alias.id,
      email: alias.email,
      emailVerified: true,
      code: ownCode,
      source: 'code',
    });
    expect(out).toMatchObject({ attributed: false, reason: 'self_referral' });
  });

  it('revoked links stop attributing; adjustments never go below zero; settings are audited', async () => {
    const other = await makeUser('ref_revoke');
    const otherWs = (await createWorkspace(db, { userId: other }, { name: 'R' })).id;
    const c = (await ensureReferralLink(db, { userId: other }, otherWs)).code;
    const [identity] = await owner_.db
      .select()
      .from(schema.referralIdentities)
      .where(eq(schema.referralIdentities.code, c));
    await setReferralLinkStatus(db, staff, identity!.id, 'revoked', 'Abuse');
    expect(await checkReferralCode(db, c)).toMatchObject({ reason: 'revoked' });

    await adjustReferralCredits(db, staff, { workspaceId: otherWs, delta: 3, reason: 'Goodwill' });
    expect((await balances(other, otherWs)).referral).toBe(3);
    await expect(
      adjustReferralCredits(db, staff, { workspaceId: otherWs, delta: -5, reason: 'Too many' }),
    ).rejects.toMatchObject({ code: 'conflict' });

    const p = await getReferralProgram(db);
    await saveReferralProgram(db, staff, {
      status: 'active',
      name: p.name,
      referrerCredits: 3,
      referredCredits: 1,
      attributionWindowDays: 30,
      qualificationDelayHours: 0,
      settings: p.settings,
    });
    expect((await getReferralProgram(db)).referrerCredits).toBe(3);
    const [ev] = await owner_.db
      .select()
      .from(schema.referralEvents)
      .where(sql`${schema.referralEvents.type} = 'settings.updated'`)
      .orderBy(sql`created_at desc`)
      .limit(1);
    expect(ev).toMatchObject({ actorUserId: staff });
    await setProgram({ referrerCredits: 2 });
  });

  it('a paused program attributes nobody', async () => {
    await setProgram({ status: 'paused' });
    const f = await newAccount('ref_paused', true);
    expect(
      await attributeNewAccount(db, {
        userId: f.id,
        email: f.email,
        emailVerified: true,
        code,
        source: 'code',
      }),
    ).toMatchObject({ attributed: false, reason: 'program_off' });
    await setProgram({ status: 'active' });
  });
});
