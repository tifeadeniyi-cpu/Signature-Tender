import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  schema,
  withActor,
  withBillingSystem,
  type Database,
  type ActorContext,
  type Tx,
} from '@st/db';
import { AppError } from './errors';
import { recordAudit } from './audit';
import { getConfigValue } from './config';

/**
 * Billing and credits (spec Part 3). One signing request costs one credit. Credits come from
 * purchases (never expire) or a subscription's monthly allowance (lasts one billing period). The
 * ledger is append-only: balances are sums, and every movement has a unique idempotency key.
 *
 * This module never talks to Stripe. The web layer creates Checkout sessions and verifies webhook
 * signatures, then hands plain, already-verified facts to the functions here.
 */

type Meta = { ipAddress?: string | null; userAgent?: string | null };
export type CreditBucket = 'purchased' | 'allowance';
/** How a send was paid for. `complimentary` spends nothing (see isComplimentary). */
export type SendCredit = CreditBucket | 'complimentary';

/**
 * app_config key listing workspaces that sign for free with no limit (the founder workspace). The
 * value is a JSON array of workspace ids. Only the database owner can change app_config, so no
 * customer can put their own workspace on the list. Removing an id turns normal billing back on.
 */
export const COMPLIMENTARY_WORKSPACES_KEY = 'billing.complimentary_workspaces';

const uuid = z.string().uuid();
const ACTIVE_SUB = ['active', 'trialing', 'past_due'];

async function permitted(tx: Tx, workspaceId: string, perm: string): Promise<boolean> {
  const [row] = (await tx.execute(
    sql`select st_has_permission(${workspaceId}::uuid, ${perm}) as ok`,
  )) as unknown as { ok: boolean }[];
  return Boolean(row?.ok);
}

async function requireBillingManager(tx: Tx, workspaceId: string) {
  if (!(await permitted(tx, workspaceId, 'billing.manage')))
    throw new AppError('forbidden', 'Only workspace owners and admins can manage billing.');
}

// ---------------------------------------------------------------------------------------------
// Balances and holds

/** Serializes credit movements per workspace so two sends can never spend the same credit. */
async function lockCredits(tx: Tx, workspaceId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'credits:' + workspaceId}, 0))`,
  );
}

export interface Balances {
  allowance: number;
  purchased: number;
  available: number;
  reserved: number;
  /** True for a complimentary workspace: sends never need a credit. */
  unlimited: boolean;
}

/** Whether this workspace signs for free, without credits or payment. */
export async function isComplimentary(tx: Tx, workspaceId: string): Promise<boolean> {
  const ids = await getConfigValue<unknown>(
    tx as unknown as Database,
    COMPLIMENTARY_WORKSPACES_KEY,
    [],
  );
  return Array.isArray(ids) && ids.includes(workspaceId);
}

export async function getBalances(tx: Tx, workspaceId: string): Promise<Balances> {
  const rows = await tx
    .select({
      bucket: schema.creditLedger.bucket,
      total: sql<number>`coalesce(sum(${schema.creditLedger.delta}), 0)::int`,
    })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.workspaceId, workspaceId))
    .groupBy(schema.creditLedger.bucket);
  const [held] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.creditHolds)
    .where(
      and(
        eq(schema.creditHolds.workspaceId, workspaceId),
        eq(schema.creditHolds.status, 'reserved'),
      ),
    );
  const allowance = Math.max(0, rows.find((r) => r.bucket === 'allowance')?.total ?? 0);
  const purchased = Math.max(0, rows.find((r) => r.bucket === 'purchased')?.total ?? 0);
  return {
    allowance,
    purchased,
    available: allowance + purchased,
    reserved: held?.n ?? 0,
    unlimited: await isComplimentary(tx, workspaceId),
  };
}

/**
 * Sets one credit aside for a request, spending the expiring allowance before purchased credits.
 * Returns the bucket used, `complimentary` for a workspace that signs for free (nothing is
 * spent or held), or null when the workspace has no credit available.
 */
export async function reserveCredit(
  tx: Tx,
  input: { workspaceId: string; requestId: string; userId: string },
): Promise<SendCredit | null> {
  await lockCredits(tx, input.workspaceId);
  const [existing] = await tx
    .select()
    .from(schema.creditHolds)
    .where(eq(schema.creditHolds.requestId, input.requestId));
  if (existing && existing.status !== 'restored') return existing.bucket;
  const b = await getBalances(tx, input.workspaceId);
  if (b.unlimited) return 'complimentary';
  const bucket: CreditBucket | null =
    b.allowance > 0 ? 'allowance' : b.purchased > 0 ? 'purchased' : null;
  if (!bucket) return null;
  const attempt = existing ? 2 : 1;
  await tx.insert(schema.creditLedger).values({
    workspaceId: input.workspaceId,
    entryType: 'reserve',
    bucket,
    delta: -1,
    requestId: input.requestId,
    idempotencyKey: `reserve:${input.requestId}:${attempt}`,
    createdBy: input.userId,
  });
  if (existing) {
    await tx
      .update(schema.creditHolds)
      .set({ bucket, status: 'reserved', updatedAt: new Date() })
      .where(eq(schema.creditHolds.id, existing.id));
  } else {
    await tx
      .insert(schema.creditHolds)
      .values({ workspaceId: input.workspaceId, requestId: input.requestId, bucket });
  }
  return bucket;
}

/** Marks the request's credit as used. Called in the same transaction that sends the request. */
export async function consumeHold(tx: Tx, requestId: string) {
  await tx
    .update(schema.creditHolds)
    .set({ status: 'consumed', updatedAt: new Date() })
    .where(
      and(eq(schema.creditHolds.requestId, requestId), eq(schema.creditHolds.status, 'reserved')),
    );
}

/**
 * Gives a request's credit back. `whenConsumed` decides whether an already-used credit returns too
 * (the cancellation policy); a reserved credit always returns. Returns true when a credit came back.
 */
export async function restoreHold(
  tx: Tx,
  input: { requestId: string; userId: string; whenConsumed: boolean; note: string },
): Promise<boolean> {
  const [hold] = await tx
    .select()
    .from(schema.creditHolds)
    .where(eq(schema.creditHolds.requestId, input.requestId))
    .for('update');
  if (!hold || hold.status === 'restored') return false;
  if (hold.status === 'consumed' && !input.whenConsumed) return false;
  await lockCredits(tx, hold.workspaceId);
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.requestId, input.requestId),
        eq(schema.creditLedger.entryType, 'restore'),
      ),
    );
  await tx.insert(schema.creditLedger).values({
    workspaceId: hold.workspaceId,
    entryType: 'restore',
    bucket: hold.bucket,
    delta: 1,
    requestId: input.requestId,
    idempotencyKey: `restore:${input.requestId}:${n + 1}`,
    note: input.note,
    createdBy: input.userId,
  });
  await tx
    .update(schema.creditHolds)
    .set({ status: 'restored', updatedAt: new Date() })
    .where(eq(schema.creditHolds.id, hold.id));
  return true;
}

/** Applies the configured cancellation policy to a request that is being cancelled. */
export async function restoreOnCancel(tx: Tx, requestId: string, userId: string): Promise<boolean> {
  const policy = await getConfigValue<string>(
    tx as unknown as Database,
    'billing.cancel_credit_policy',
    'restore_if_unopened',
  );
  let whenConsumed = false;
  if (policy === 'restore_if_unopened') {
    const [opened] = await tx
      .select({ id: schema.requestRecipients.id })
      .from(schema.requestRecipients)
      .where(
        and(
          eq(schema.requestRecipients.requestId, requestId),
          sql`(${schema.requestRecipients.viewedAt} is not null or ${schema.requestRecipients.status} in ('viewed','signed','declined'))`,
        ),
      )
      .limit(1);
    whenConsumed = !opened;
  }
  return restoreHold(tx, {
    requestId,
    userId,
    whenConsumed,
    note: 'Request cancelled',
  });
}

// ---------------------------------------------------------------------------------------------
// Prices

async function accountRow(tx: Tx, workspaceId: string) {
  const [acct] = await tx
    .select()
    .from(schema.billingAccounts)
    .where(eq(schema.billingAccounts.workspaceId, workspaceId));
  return acct ?? null;
}

function subscribed(acct: Awaited<ReturnType<typeof accountRow>>) {
  return Boolean(acct?.stripeSubscriptionId && ACTIVE_SUB.includes(acct.subscriptionStatus ?? ''));
}

export interface RequestPrice {
  amountCents: number;
  currency: string;
  /** `overage` is a subscriber's additional-request price; `single` is pay-as-you-go. */
  source: 'single' | 'overage';
  planCode: string;
}

/** What one more request costs this workspace at checkout, from the database prices. */
export async function priceForOneRequest(tx: Tx, workspaceId: string): Promise<RequestPrice> {
  const acct = await accountRow(tx, workspaceId);
  if (subscribed(acct)) {
    const [plan] = await tx
      .select()
      .from(schema.subscriptionPlans)
      .where(eq(schema.subscriptionPlans.code, acct!.planCode));
    if (plan?.overagePriceCents != null)
      return {
        amountCents: plan.overagePriceCents,
        currency: plan.currency,
        source: 'overage',
        planCode: plan.code,
      };
  }
  const [single] = await tx
    .select()
    .from(schema.prices)
    .where(and(eq(schema.prices.code, 'single_request'), eq(schema.prices.active, true)));
  if (!single) throw new Error('The single_request price is not configured');
  return {
    amountCents: single.amountCents,
    currency: single.currency,
    source: 'single',
    planCode: 'payg',
  };
}

// ---------------------------------------------------------------------------------------------
// Sign it yourself: a request whose only recipient is its sender

/** The flat price for signing your own document. Set `billing.self_sign_price` to change it. */
export const SELF_SIGN_DEFAULT_PRICE = { amountCents: 99, currency: 'USD' };
export const SELF_SIGN_PRICE_CODE = 'self_sign';

/** True when the sender is the one and only recipient, and they sign. */
export function isSelfSignRecipients(
  recipients: { email: string; role: string }[],
  senderEmail: string | null | undefined,
) {
  return (
    recipients.length === 1 &&
    recipients[0]!.role === 'signer' &&
    Boolean(senderEmail) &&
    recipients[0]!.email.trim().toLowerCase() === senderEmail!.trim().toLowerCase()
  );
}

export async function isSelfSignRequest(tx: Tx, requestId: string) {
  const [req] = await tx
    .select({ senderEmail: schema.signingRequests.senderEmail })
    .from(schema.signingRequests)
    .where(eq(schema.signingRequests.id, requestId));
  if (!req) return false;
  const recips = await tx
    .select({ email: schema.requestRecipients.email, role: schema.requestRecipients.role })
    .from(schema.requestRecipients)
    .where(eq(schema.requestRecipients.requestId, requestId));
  return isSelfSignRecipients(recips, req.senderEmail);
}

export async function selfSignPrice(tx: Tx): Promise<RequestPrice> {
  const [row] = await tx
    .select()
    .from(schema.appConfig)
    .where(eq(schema.appConfig.key, 'billing.self_sign_price'));
  const v = (row?.value ?? {}) as { amountCents?: unknown; currency?: unknown };
  const amountCents =
    Number.isInteger(v.amountCents) && (v.amountCents as number) >= 50
      ? (v.amountCents as number)
      : SELF_SIGN_DEFAULT_PRICE.amountCents;
  const currency = typeof v.currency === 'string' ? v.currency : SELF_SIGN_DEFAULT_PRICE.currency;
  return { amountCents, currency, source: 'single', planCode: SELF_SIGN_PRICE_CODE };
}

/** A self-signing request is paid for once its own $0.99 payment has been confirmed by Stripe. */
export async function hasPaidSelfSign(tx: Tx, requestId: string) {
  const [p] = await tx
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.requestId, requestId),
        eq(schema.payments.priceCode, SELF_SIGN_PRICE_CODE),
        eq(schema.payments.status, 'paid'),
      ),
    );
  return Boolean(p);
}

// ---------------------------------------------------------------------------------------------
// Overview for the Billing & Credits page

export async function getBillingOverview(db: Database, actor: ActorContext, workspaceId: string) {
  if (!uuid.safeParse(workspaceId).success) throw new AppError('not_found', 'Workspace not found');
  return withActor(db, actor, async (tx) => {
    const canManage = await permitted(tx, workspaceId, 'billing.manage');
    const canSend = await permitted(tx, workspaceId, 'documents.send');
    if (!canManage && !canSend)
      throw new AppError('forbidden', 'Your role does not include billing access.');
    const acct = await accountRow(tx, workspaceId);
    const balances = await getBalances(tx, workspaceId);
    const plans = await tx
      .select()
      .from(schema.subscriptionPlans)
      .where(eq(schema.subscriptionPlans.active, true))
      .orderBy(asc(schema.subscriptionPlans.sortOrder));
    const prices = await tx
      .select()
      .from(schema.prices)
      .where(eq(schema.prices.active, true))
      .orderBy(asc(schema.prices.sortOrder));
    const isSubscribed = subscribed(acct);
    const plan = plans.find((p) => p.code === (isSubscribed ? acct!.planCode : 'payg')) ?? null;
    const requestPrice = await priceForOneRequest(tx, workspaceId);

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [usage] = (await tx.execute(sql`
      select
        count(*) filter (where r.sent_at >= ${monthStart.toISOString()}::timestamptz and not r.is_test)::int as sent_this_month,
        count(*) filter (where r.status = 'completed' and not r.is_test)::int as completed,
        count(*) filter (where r.status = 'cancelled' and not r.is_test)::int as cancelled,
        count(*) filter (where r.status in ('awaiting_payment','payment_processing'))::int as awaiting_payment
      from signing_requests r where r.workspace_id = ${workspaceId}::uuid
    `)) as unknown as {
      sent_this_month: number;
      completed: number;
      cancelled: number;
      awaiting_payment: number;
    }[];
    const [ledgerTotals] = (await tx.execute(sql`
      select
        coalesce(sum(delta) filter (where entry_type in ('purchase','promotional','admin_adjustment') and delta > 0), 0)::int as purchased,
        coalesce(-sum(delta) filter (where entry_type = 'reserve'), 0)::int
          - coalesce(sum(delta) filter (where entry_type = 'restore'), 0)::int as consumed,
        coalesce(-sum(delta) filter (where entry_type = 'reserve' and bucket = 'allowance'
          and created_at >= ${(acct?.currentPeriodStart ?? monthStart).toISOString()}::timestamptz), 0)::int
          - coalesce(sum(delta) filter (where entry_type = 'restore' and bucket = 'allowance'
          and created_at >= ${(acct?.currentPeriodStart ?? monthStart).toISOString()}::timestamptz), 0)::int as allowance_used
      from credit_ledger where workspace_id = ${workspaceId}::uuid
    `)) as unknown as { purchased: number; consumed: number; allowance_used: number }[];

    let payments: (typeof schema.payments.$inferSelect)[] = [];
    let invoiceRows: (typeof schema.invoices.$inferSelect)[] = [];
    let ledger: (typeof schema.creditLedger.$inferSelect)[] = [];
    let spend = { total: 0, month: 0 };
    if (canManage) {
      payments = await tx
        .select()
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.workspaceId, workspaceId),
            sql`${schema.payments.stripeCheckoutSessionId} is not null or ${schema.payments.kind} = 'subscription'`,
          ),
        )
        .orderBy(desc(schema.payments.createdAt))
        .limit(200);
      invoiceRows = await tx
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.workspaceId, workspaceId))
        .orderBy(desc(schema.invoices.issuedAt))
        .limit(200);
      ledger = await tx
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.workspaceId, workspaceId))
        .orderBy(desc(schema.creditLedger.seq))
        .limit(200);
      const paid = payments.filter((p) =>
        ['paid', 'partially_refunded', 'disputed'].includes(p.status),
      );
      spend = {
        total: paid.reduce((s, p) => s + p.amountCents - p.amountRefundedCents, 0),
        month: paid
          .filter((p) => (p.paidAt ?? p.createdAt) >= monthStart)
          .reduce((s, p) => s + p.amountCents - p.amountRefundedCents, 0),
      };
    }

    return {
      canManage,
      complimentary: balances.unlimited,
      account: acct
        ? {
            planCode: acct.planCode,
            subscriptionStatus: acct.subscriptionStatus,
            currentPeriodEnd: acct.currentPeriodEnd,
            cancelAtPeriodEnd: acct.cancelAtPeriodEnd,
            hasCustomer: Boolean(acct.stripeCustomerId),
          }
        : null,
      isSubscribed,
      plan,
      plans,
      prices,
      requestPrice,
      balances,
      usage: {
        sentThisMonth: usage?.sent_this_month ?? 0,
        completed: usage?.completed ?? 0,
        cancelled: usage?.cancelled ?? 0,
        awaitingPayment: usage?.awaiting_payment ?? 0,
        creditsPurchased: ledgerTotals?.purchased ?? 0,
        creditsConsumed: ledgerTotals?.consumed ?? 0,
        allowanceUsed: ledgerTotals?.allowance_used ?? 0,
      },
      spend,
      payments,
      invoices: invoiceRows,
      ledger,
    };
  });
}

/** Payments marked paid whose credits never reached the ledger, or the reverse. Should be empty. */
export async function reconcileCredits(db: Database, actor: ActorContext, workspaceId: string) {
  return withActor(db, actor, async (tx) => {
    await requireBillingManager(tx, workspaceId);
    const rows = (await tx.execute(sql`
      select p.id, p.description, p.status, p.credits,
        coalesce((select sum(l.delta) from credit_ledger l
                  where l.payment_id = p.id and l.entry_type = 'purchase'), 0)::int as granted
      from payments p
      where p.workspace_id = ${workspaceId}::uuid and p.kind in ('credits','request')
    `)) as unknown as {
      id: string;
      description: string;
      status: string;
      credits: number;
      granted: number;
    }[];
    const paidStates = ['paid', 'refunded', 'partially_refunded', 'disputed'];
    return rows.filter((r) =>
      paidStates.includes(r.status) ? r.granted !== r.credits : r.granted !== 0,
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Starting a checkout (signed-in billing manager)

export const checkoutInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('credits'), priceCode: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('request'), requestId: uuid }),
  z.object({ kind: z.literal('subscription'), planCode: z.string().min(1).max(64) }),
]);
export type CheckoutInput = z.infer<typeof checkoutInput>;

export interface CheckoutPlan {
  paymentId: string;
  workspaceId: string;
  workspaceName: string;
  customerId: string | null;
  customerEmail: string;
  mode: 'payment' | 'subscription';
  lineItem: { name: string; description: string; amountCents: number; currency: string };
  planCode: string | null;
  requestId: string | null;
  documentId: string | null;
}

/**
 * Records a pending payment with the amount fixed from the database, before the customer reaches
 * Stripe. The webhook later grants credits only if Stripe's totals match this row.
 */
export async function beginCheckout(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: CheckoutInput,
): Promise<CheckoutPlan> {
  if (!uuid.safeParse(workspaceId).success) throw new AppError('not_found', 'Workspace not found');
  const input = checkoutInput.parse(raw);
  return withActor(db, actor, async (tx) => {
    await requireBillingManager(tx, workspaceId);
    if (await isComplimentary(tx, workspaceId))
      throw new AppError('conflict', 'This workspace signs for free, so there is nothing to pay.');
    const acct = await accountRow(tx, workspaceId);
    const [ws] = await tx
      .select({ name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId));
    const [me] = await tx
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, actor.userId));

    let values: typeof schema.payments.$inferInsert;
    let plan: CheckoutPlan['lineItem'];
    let mode: CheckoutPlan['mode'] = 'payment';
    let documentId: string | null = null;

    if (input.kind === 'credits') {
      const [price] = await tx
        .select()
        .from(schema.prices)
        .where(and(eq(schema.prices.code, input.priceCode), eq(schema.prices.active, true)));
      if (!price) throw new AppError('invalid', 'That credit pack is not available.');
      plan = {
        name: `Signature Tender: ${price.name}`,
        description: `${price.credits} signing request credit${price.credits === 1 ? '' : 's'}. Purchased credits do not expire.`,
        amountCents: price.amountCents,
        currency: price.currency,
      };
      values = {
        workspaceId,
        kind: 'credits',
        description: price.name,
        priceCode: price.code,
        credits: price.credits,
        amountCents: price.amountCents,
        currency: price.currency,
        createdBy: actor.userId,
      };
    } else if (input.kind === 'request') {
      const [req] = await tx
        .select()
        .from(schema.signingRequests)
        .where(eq(schema.signingRequests.id, input.requestId))
        .for('update');
      if (!req || req.workspaceId !== workspaceId)
        throw new AppError('not_found', 'Request not found');
      if (!['awaiting_payment', 'payment_processing'].includes(req.status))
        throw new AppError('conflict', 'This request does not need payment.');
      const [canSend] = (await tx.execute(
        sql`select st_can_send_request(${req.id}::uuid) as ok`,
      )) as unknown as { ok: boolean }[];
      if (!canSend?.ok)
        throw new AppError('forbidden', 'Your role does not allow sending this document.');
      // Signing your own document is a flat fee that never buys or uses a credit.
      const self = await isSelfSignRequest(tx, req.id);
      const price = self ? await selfSignPrice(tx) : await priceForOneRequest(tx, workspaceId);
      documentId = req.documentId;
      plan = self
        ? {
            name: 'Signature Tender: sign it yourself',
            description: `Sign "${req.title.slice(0, 120)}" yourself, with a Certificate of Completion.`,
            amountCents: price.amountCents,
            currency: price.currency,
          }
        : {
            name: `Signature Tender: signing request`,
            description: `Send "${req.title.slice(0, 120)}" for signature. Includes up to five signers.`,
            amountCents: price.amountCents,
            currency: price.currency,
          };
      values = {
        workspaceId,
        kind: 'request',
        description: self
          ? `Sign it yourself: ${req.title.slice(0, 120)}`
          : `Signing request: ${req.title.slice(0, 120)}`,
        priceCode: self
          ? SELF_SIGN_PRICE_CODE
          : price.source === 'single'
            ? 'single_request'
            : `overage:${price.planCode}`,
        credits: self ? 0 : 1,
        amountCents: price.amountCents,
        currency: price.currency,
        requestId: req.id,
        dispatchAs: req.sentBy,
        createdBy: actor.userId,
      };
    } else {
      const [p] = await tx
        .select()
        .from(schema.subscriptionPlans)
        .where(
          and(
            eq(schema.subscriptionPlans.code, input.planCode),
            eq(schema.subscriptionPlans.active, true),
          ),
        );
      if (!p || p.isCustom || !p.monthlyPriceCents)
        throw new AppError('invalid', 'That plan cannot be bought online.');
      if (subscribed(acct))
        throw new AppError(
          'conflict',
          'This workspace already has a subscription. Change plans instead.',
        );
      mode = 'subscription';
      plan = {
        name: `Signature Tender ${p.name}`,
        description: `${p.includedRequests} signing requests each month. Additional requests are charged per request.`,
        amountCents: p.monthlyPriceCents,
        currency: p.currency,
      };
      values = {
        workspaceId,
        kind: 'subscription',
        description: `${p.name} plan, first month`,
        planCode: p.code,
        credits: 0,
        amountCents: p.monthlyPriceCents,
        currency: p.currency,
        createdBy: actor.userId,
      };
    }
    const [row] = await tx.insert(schema.payments).values(values).returning();
    return {
      paymentId: row!.id,
      workspaceId,
      workspaceName: ws?.name ?? '',
      customerId: acct?.stripeCustomerId ?? null,
      customerEmail: me?.email ?? '',
      mode,
      lineItem: plan,
      planCode: values.planCode ?? null,
      requestId: values.requestId ?? null,
      documentId,
    };
  });
}

/** Stores the workspace's Stripe customer the first time a checkout needs one. */
export async function linkStripeCustomer(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  customerId: string,
) {
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new Error('Invalid Stripe customer id');
  await withActor(db, actor, (tx) => requireBillingManager(tx, workspaceId));
  await withBillingSystem(db, async (tx) => {
    await tx
      .insert(schema.billingAccounts)
      .values({ workspaceId, stripeCustomerId: customerId })
      .onConflictDoUpdate({
        target: schema.billingAccounts.workspaceId,
        set: { stripeCustomerId: customerId, updatedAt: new Date() },
        setWhere: sql`${schema.billingAccounts.stripeCustomerId} is null`,
      });
  });
}

/** Links the pending payment to its Stripe Checkout session; a paid request waits for the webhook. */
export async function attachCheckoutSession(
  db: Database,
  actor: ActorContext,
  paymentId: string,
  sessionId: string,
  meta: Meta = {},
) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Error('Invalid Checkout session id');
  await withActor(db, actor, async (tx) => {
    const [p] = await tx
      .update(schema.payments)
      .set({ stripeCheckoutSessionId: sessionId, updatedAt: new Date() })
      .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, 'pending')))
      .returning();
    if (!p) throw new AppError('not_found', 'Payment not found');
    if (p.kind === 'request' && p.requestId) {
      await tx
        .update(schema.signingRequests)
        .set({ status: 'payment_processing', updatedAt: new Date() })
        .where(
          and(
            eq(schema.signingRequests.id, p.requestId),
            eq(schema.signingRequests.status, 'awaiting_payment'),
          ),
        );
    }
    await recordAudit(tx, {
      workspaceId: p.workspaceId,
      actorUserId: actor.userId,
      action: 'billing.checkout_started',
      targetType: 'payment',
      targetId: p.id,
      metadata: { kind: p.kind, amountCents: p.amountCents, currency: p.currency },
      ...meta,
    });
  });
}

/** Marks a pending payment failed when Stripe refused to create the session. */
export async function abandonCheckout(
  db: Database,
  actor: ActorContext,
  paymentId: string,
  reason: string,
) {
  await withActor(db, actor, async (tx) => {
    await tx
      .update(schema.payments)
      .set({ status: 'failed', failureReason: reason.slice(0, 300), updatedAt: new Date() })
      .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, 'pending')));
  });
}

/** The workspace's Stripe ids, for opening the customer portal or changing a plan. */
export async function getStripeLinks(db: Database, actor: ActorContext, workspaceId: string) {
  return withActor(db, actor, async (tx) => {
    await requireBillingManager(tx, workspaceId);
    const acct = await accountRow(tx, workspaceId);
    return {
      customerId: acct?.stripeCustomerId ?? null,
      subscriptionId: subscribed(acct) ? acct!.stripeSubscriptionId : null,
      planCode: subscribed(acct) ? acct!.planCode : 'payg',
    };
  });
}

/** Checks a plan change and returns what Stripe needs. Downgrades apply from the next bill. */
export async function planChange(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  planCode: string,
) {
  return withActor(db, actor, async (tx) => {
    await requireBillingManager(tx, workspaceId);
    const acct = await accountRow(tx, workspaceId);
    if (!subscribed(acct)) throw new AppError('conflict', 'Subscribe to a plan first.');
    if (acct!.planCode === planCode)
      throw new AppError('conflict', 'You are already on this plan.');
    const plans = await tx.select().from(schema.subscriptionPlans);
    const from = plans.find((p) => p.code === acct!.planCode);
    const to = plans.find((p) => p.code === planCode && p.active);
    if (!to || to.isCustom || !to.monthlyPriceCents)
      throw new AppError('invalid', 'That plan cannot be chosen online.');
    const upgrade = (to.monthlyPriceCents ?? 0) > (from?.monthlyPriceCents ?? 0);
    return {
      subscriptionId: acct!.stripeSubscriptionId!,
      upgrade,
      plan: {
        code: to.code,
        name: to.name,
        amountCents: to.monthlyPriceCents,
        currency: to.currency,
        includedRequests: to.includedRequests ?? 0,
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Webhook side (runs as the billing system after Stripe's signature has been verified)

/** Returns false when this Stripe event was already processed, so a retry does nothing twice. */
export async function claimStripeEvent(
  db: Database,
  e: { id: string; type: string; livemode: boolean },
): Promise<boolean> {
  return withBillingSystem(db, async (tx) => {
    const [row] = await tx
      .insert(schema.stripeEvents)
      .values({ id: e.id, type: e.type, livemode: e.livemode, attempts: 1 })
      .onConflictDoUpdate({
        target: schema.stripeEvents.id,
        set: { attempts: sql`${schema.stripeEvents.attempts} + 1` },
      })
      .returning();
    return !row!.processedAt;
  });
}

export async function finishStripeEvent(db: Database, id: string, error: string | null) {
  await withBillingSystem(db, async (tx) => {
    await tx
      .update(schema.stripeEvents)
      .set(error ? { error: error.slice(0, 1000) } : { processedAt: new Date(), error: null })
      .where(eq(schema.stripeEvents.id, id));
  });
}

async function grant(
  tx: Tx,
  e: {
    workspaceId: string;
    entryType: 'purchase' | 'subscription_allowance' | 'expire' | 'reversal';
    bucket: CreditBucket;
    delta: number;
    key: string;
    paymentId?: string | null;
    periodEnd?: Date | null;
    note?: string;
  },
) {
  if (e.delta === 0) return;
  await tx
    .insert(schema.creditLedger)
    .values({
      workspaceId: e.workspaceId,
      entryType: e.entryType,
      bucket: e.bucket,
      delta: e.delta,
      paymentId: e.paymentId ?? null,
      idempotencyKey: e.key,
      periodEnd: e.periodEnd ?? null,
      note: e.note ?? null,
    })
    .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey });
}

export interface CheckoutFacts {
  sessionId: string;
  mode: string;
  paymentStatus: string;
  amountSubtotal: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
}

export type CheckoutOutcome =
  | { action: 'none'; reason: string }
  | { action: 'granted'; workspaceId: string; credits: number }
  | {
      action: 'dispatch';
      workspaceId: string;
      requestId: string;
      dispatchAs: string;
      paymentId: string;
    };

/**
 * Checkout finished. Credits are granted only when Stripe says it is paid and its subtotal and
 * currency equal the amount we fixed before checkout. Safe to call any number of times.
 */
export async function applyCheckoutCompleted(
  db: Database,
  f: CheckoutFacts,
): Promise<CheckoutOutcome> {
  return withBillingSystem(db, async (tx) => {
    const [p] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.stripeCheckoutSessionId, f.sessionId))
      .for('update');
    if (!p) return { action: 'none', reason: 'unknown_session' };

    if (f.customerId) {
      await tx
        .insert(schema.billingAccounts)
        .values({ workspaceId: p.workspaceId, stripeCustomerId: f.customerId })
        .onConflictDoUpdate({
          target: schema.billingAccounts.workspaceId,
          set: { stripeCustomerId: f.customerId, updatedAt: new Date() },
          setWhere: sql`${schema.billingAccounts.stripeCustomerId} is null`,
        });
    }

    if (p.kind === 'subscription') {
      // The allowance arrives with the subscription's paid invoice; here we only link it.
      if (f.subscriptionId) {
        await tx
          .update(schema.billingAccounts)
          .set({ stripeSubscriptionId: f.subscriptionId, updatedAt: new Date() })
          .where(eq(schema.billingAccounts.workspaceId, p.workspaceId));
      }
      await tx
        .update(schema.payments)
        .set({
          status: f.paymentStatus === 'paid' ? 'paid' : 'processing',
          paidAt: f.paymentStatus === 'paid' ? new Date() : null,
          stripeInvoiceId: f.invoiceId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.payments.id, p.id),
            inArray(schema.payments.status, ['pending', 'processing']),
          ),
        );
      return { action: 'none', reason: 'subscription_linked' };
    }

    if (f.paymentStatus !== 'paid') {
      // Bank debits and similar settle later; checkout.session.async_payment_succeeded follows.
      await tx
        .update(schema.payments)
        .set({
          status: 'processing',
          stripePaymentIntentId: f.paymentIntentId,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.payments.id, p.id), eq(schema.payments.status, 'pending')));
      return { action: 'none', reason: 'awaiting_settlement' };
    }

    const amountOk =
      f.amountSubtotal === p.amountCents &&
      (f.currency ?? '').toLowerCase() === p.currency.toLowerCase();
    if (!amountOk) {
      await tx
        .update(schema.payments)
        .set({
          status: 'failed',
          failureReason: `Amount mismatch: Stripe ${f.amountSubtotal} ${f.currency}, expected ${p.amountCents} ${p.currency}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.payments.id, p.id));
      throw new Error(`Checkout ${f.sessionId} amount does not match payment ${p.id}`);
    }

    if (['pending', 'processing', 'expired', 'failed'].includes(p.status)) {
      await tx
        .update(schema.payments)
        .set({
          status: 'paid',
          paidAt: new Date(),
          stripePaymentIntentId: f.paymentIntentId,
          stripeInvoiceId: f.invoiceId,
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.payments.id, p.id));
    }
    await grant(tx, {
      workspaceId: p.workspaceId,
      entryType: 'purchase',
      bucket: 'purchased',
      delta: p.credits,
      key: `purchase:${p.id}`,
      paymentId: p.id,
      note: p.description,
    });
    if (p.kind === 'request' && p.requestId && p.dispatchAs)
      return {
        action: 'dispatch',
        workspaceId: p.workspaceId,
        requestId: p.requestId,
        dispatchAs: p.dispatchAs,
        paymentId: p.id,
      };
    return { action: 'granted', workspaceId: p.workspaceId, credits: p.credits };
  });
}

/** Checkout expired or an async payment failed: nothing is granted and the request can be paid again. */
export async function applyCheckoutClosed(
  db: Database,
  sessionId: string,
  status: 'expired' | 'failed',
): Promise<{ requestId: string; dispatchAs: string } | null> {
  const p = await withBillingSystem(db, async (tx) => {
    const [row] = await tx
      .update(schema.payments)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(schema.payments.stripeCheckoutSessionId, sessionId),
          inArray(schema.payments.status, ['pending', 'processing']),
        ),
      )
      .returning();
    return row ?? null;
  });
  if (!p?.requestId || !p.dispatchAs) return null;
  // Put the request back to awaiting payment, acting as its sender (the system cannot edit requests).
  await withActor(db, { userId: p.dispatchAs }, async (tx) => {
    await tx
      .update(schema.signingRequests)
      .set({ status: 'awaiting_payment', updatedAt: new Date() })
      .where(
        and(
          eq(schema.signingRequests.id, p.requestId!),
          eq(schema.signingRequests.status, 'payment_processing'),
        ),
      );
  });
  return { requestId: p.requestId, dispatchAs: p.dispatchAs };
}

export interface SubscriptionFacts {
  subscriptionId: string;
  customerId: string;
  status: string;
  planCode: string | null;
  workspaceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  deleted: boolean;
}

async function expireAllowance(tx: Tx, workspaceId: string, key: string) {
  await lockCredits(tx, workspaceId);
  const b = await getBalances(tx, workspaceId);
  await grant(tx, {
    workspaceId,
    entryType: 'expire',
    bucket: 'allowance',
    delta: -b.allowance,
    key,
    note: 'Unused monthly allowance expired',
  });
}

/** Mirrors a subscription created, changed, cancelled or ended in Stripe. */
export async function applySubscription(db: Database, f: SubscriptionFacts) {
  await withBillingSystem(db, async (tx) => {
    const [byCustomer] = await tx
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.stripeCustomerId, f.customerId));
    const workspaceId = byCustomer?.workspaceId ?? f.workspaceId;
    if (!workspaceId) throw new Error(`No workspace for Stripe customer ${f.customerId}`);
    if (byCustomer?.stripeSubscriptionId && byCustomer.stripeSubscriptionId !== f.subscriptionId) {
      // An older subscription ending must not wipe out the current one.
      if (f.deleted || !ACTIVE_SUB.includes(f.status)) return;
    }
    const plan = f.planCode
      ? (
          await tx
            .select()
            .from(schema.subscriptionPlans)
            .where(eq(schema.subscriptionPlans.code, f.planCode))
        )[0]
      : undefined;
    const ended = f.deleted || ['canceled', 'incomplete_expired', 'unpaid'].includes(f.status);
    await tx
      .insert(schema.billingAccounts)
      .values({ workspaceId, stripeCustomerId: f.customerId })
      .onConflictDoNothing({ target: schema.billingAccounts.workspaceId });
    await tx
      .update(schema.billingAccounts)
      .set({
        stripeSubscriptionId: ended ? null : f.subscriptionId,
        subscriptionStatus: f.status,
        planCode: ended ? 'payg' : (plan?.code ?? byCustomer?.planCode ?? 'payg'),
        currentPeriodStart: ended ? null : f.currentPeriodStart,
        currentPeriodEnd: ended ? null : f.currentPeriodEnd,
        cancelAtPeriodEnd: ended ? false : f.cancelAtPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(schema.billingAccounts.workspaceId, workspaceId));
    if (ended) await expireAllowance(tx, workspaceId, `expire:sub_end:${f.subscriptionId}`);
  });
}

export interface InvoiceFacts {
  invoiceId: string;
  customerId: string;
  number: string | null;
  status: string;
  description: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
  billingReason: string | null;
  createdAt: Date;
  subscriptionId: string | null;
  planCode: string | null;
  /** The subscription period this invoice pays for, when it is a subscription invoice. */
  periodStart: Date | null;
  periodEnd: Date | null;
}

/**
 * Records an invoice or receipt. A paid subscription invoice for a new period expires the unused
 * allowance and grants the plan's included requests; an upgrade tops the allowance up.
 */
export async function applyInvoice(db: Database, f: InvoiceFacts) {
  await withBillingSystem(db, async (tx) => {
    const [acct] = await tx
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.stripeCustomerId, f.customerId));
    if (!acct) throw new Error(`No workspace for Stripe customer ${f.customerId}`);
    const workspaceId = acct.workspaceId;
    const row = {
      workspaceId,
      stripeInvoiceId: f.invoiceId,
      number: f.number,
      status: f.status,
      description: f.description,
      amountDueCents: f.amountDue,
      amountPaidCents: f.amountPaid,
      currency: f.currency,
      hostedUrl: f.hostedUrl,
      pdfUrl: f.pdfUrl,
      billingReason: f.billingReason,
      periodStart: f.periodStart,
      periodEnd: f.periodEnd,
      issuedAt: f.createdAt,
    };
    await tx
      .insert(schema.invoices)
      .values(row)
      .onConflictDoUpdate({
        target: schema.invoices.stripeInvoiceId,
        set: { ...row, updatedAt: new Date() },
      });

    if (!f.subscriptionId || f.status !== 'paid') return;
    const plan = f.planCode
      ? (
          await tx
            .select()
            .from(schema.subscriptionPlans)
            .where(eq(schema.subscriptionPlans.code, f.planCode))
        )[0]
      : undefined;

    // A payment row per subscription invoice, for the payment history.
    const [existing] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.stripeInvoiceId, f.invoiceId));
    if (!existing) {
      await tx.insert(schema.payments).values({
        workspaceId,
        kind: 'subscription',
        status: 'paid',
        description:
          f.billingReason === 'subscription_update'
            ? `${plan?.name ?? 'Plan'} change`
            : `${plan?.name ?? 'Subscription'} plan`,
        planCode: plan?.code ?? null,
        amountCents: f.amountPaid,
        currency: f.currency.toUpperCase(),
        stripeInvoiceId: f.invoiceId,
        paidAt: new Date(),
      });
    }

    if (!plan?.includedRequests || !f.periodEnd) return;
    const periodEnd = f.periodEnd;
    const [already] = await tx
      .select({ id: schema.creditLedger.id })
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.idempotencyKey, `allowance:${f.invoiceId}`));
    if (already) return;
    if (f.billingReason === 'subscription_create' || f.billingReason === 'subscription_cycle') {
      await expireAllowance(tx, workspaceId, `expire:${f.invoiceId}`);
      await grant(tx, {
        workspaceId,
        entryType: 'subscription_allowance',
        bucket: 'allowance',
        delta: plan.includedRequests,
        key: `allowance:${f.invoiceId}`,
        periodEnd,
        note: `${plan.name}: ${plan.includedRequests} requests for this billing period`,
      });
    } else if (f.billingReason === 'subscription_update') {
      // Upgrade mid-period: add the difference between the new plan and what this period granted.
      const [{ granted } = { granted: 0 }] = await tx
        .select({ granted: sql<number>`coalesce(sum(${schema.creditLedger.delta}), 0)::int` })
        .from(schema.creditLedger)
        .where(
          and(
            eq(schema.creditLedger.workspaceId, workspaceId),
            eq(schema.creditLedger.entryType, 'subscription_allowance'),
            sql`${schema.creditLedger.periodEnd} >= ${new Date(periodEnd.getTime() - 86_400_000).toISOString()}::timestamptz`,
          ),
        );
      await grant(tx, {
        workspaceId,
        entryType: 'subscription_allowance',
        bucket: 'allowance',
        delta: Math.max(0, plan.includedRequests - granted),
        key: `allowance:${f.invoiceId}`,
        periodEnd,
        note: `Upgraded to ${plan.name}: allowance topped up for this billing period`,
      });
    }
  });
}

/**
 * A refund or a dispute. Unused credits from that purchase are reversed, up to the workspace's
 * purchased balance; credits already spent on sent requests cannot be taken back.
 */
export async function applyReversal(
  db: Database,
  f: {
    paymentIntentId: string;
    kind: 'refund' | 'dispute';
    amountRefunded?: number;
    disputeId?: string;
  },
) {
  return withBillingSystem(db, async (tx) => {
    const [p] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.stripePaymentIntentId, f.paymentIntentId))
      .for('update');
    if (!p) return { reversed: 0, found: false };
    let target = p.credits;
    let status: (typeof schema.payments.$inferSelect)['status'] = 'disputed';
    let refunded = p.amountRefundedCents;
    if (f.kind === 'refund') {
      refunded = Math.min(p.amountCents, f.amountRefunded ?? 0);
      const full = refunded >= p.amountCents;
      status = full ? 'refunded' : 'partially_refunded';
      target = full ? p.credits : Math.floor((p.credits * refunded) / Math.max(1, p.amountCents));
    }
    await tx
      .update(schema.payments)
      .set({ status, amountRefundedCents: refunded, updatedAt: new Date() })
      .where(eq(schema.payments.id, p.id));
    if (!p.credits) return { reversed: 0, found: true };
    await lockCredits(tx, p.workspaceId);
    const [{ done } = { done: 0 }] = await tx
      .select({ done: sql<number>`coalesce(-sum(${schema.creditLedger.delta}), 0)::int` })
      .from(schema.creditLedger)
      .where(
        and(eq(schema.creditLedger.paymentId, p.id), eq(schema.creditLedger.entryType, 'reversal')),
      );
    const b = await getBalances(tx, p.workspaceId);
    const n = Math.max(0, Math.min(target - done, b.purchased));
    await grant(tx, {
      workspaceId: p.workspaceId,
      entryType: 'reversal',
      bucket: 'purchased',
      delta: -n,
      key: `reversal:${p.id}:${f.kind}:${f.kind === 'refund' ? refunded : (f.disputeId ?? '')}`,
      paymentId: p.id,
      note: f.kind === 'refund' ? 'Refunded purchase' : 'Disputed payment',
    });
    return { reversed: n, found: true };
  });
}

// ---------------------------------------------------------------------------------------------
// Request payment state, for the document page

export async function getRequestBilling(db: Database, actor: ActorContext, requestId: string) {
  if (!uuid.safeParse(requestId).success) return null;
  return withActor(db, actor, async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (!req) return null;
    const canManage = await permitted(tx, req.workspaceId, 'billing.manage');
    const canSee = canManage || (await permitted(tx, req.workspaceId, 'documents.send'));
    const [hold] = canSee
      ? await tx
          .select()
          .from(schema.creditHolds)
          .where(eq(schema.creditHolds.requestId, requestId))
      : [];
    const selfSign = await isSelfSignRequest(tx, requestId);
    return {
      canManage,
      selfSign,
      balances: canSee ? await getBalances(tx, req.workspaceId) : null,
      price: canSee
        ? selfSign
          ? await selfSignPrice(tx)
          : await priceForOneRequest(tx, req.workspaceId)
        : null,
      hold: hold ? { bucket: hold.bucket, status: hold.status } : null,
    };
  });
}

/** What our records say about a checkout, for the page Stripe returns to. Never Stripe's redirect. */
export async function getCheckoutStatus(db: Database, actor: ActorContext, sessionId: string) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
  return withActor(db, actor, async (tx) => {
    const [p] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.stripeCheckoutSessionId, sessionId));
    if (!p) return null;
    let documentId: string | null = null;
    let requestStatus: string | null = null;
    if (p.requestId) {
      const [r] = await tx
        .select({
          documentId: schema.signingRequests.documentId,
          status: schema.signingRequests.status,
        })
        .from(schema.signingRequests)
        .where(eq(schema.signingRequests.id, p.requestId));
      documentId = r?.documentId ?? null;
      requestStatus = r?.status ?? null;
    }
    return {
      kind: p.kind,
      status: p.status,
      description: p.description,
      credits: p.credits,
      amountCents: p.amountCents,
      currency: p.currency,
      documentId,
      requestStatus,
      selfSign: p.priceCode === SELF_SIGN_PRICE_CODE,
    };
  });
}

/** What sending one more request will cost this workspace, for the review step. */
export async function getSendQuote(db: Database, actor: ActorContext, workspaceId: string) {
  return withActor(db, actor, async (tx) => {
    if (!(await permitted(tx, workspaceId, 'documents.send'))) return null;
    return {
      balances: await getBalances(tx, workspaceId),
      price: await priceForOneRequest(tx, workspaceId),
      canBuy: await permitted(tx, workspaceId, 'billing.manage'),
    };
  });
}
