import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  bigserial,
  index,
  uniqueIndex,
  pgEnum,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { workspaces } from './tenancy';
import { signingRequests } from './signing';

/**
 * Billing for one workspace. Stripe holds card details; this row only links the workspace to its
 * Stripe customer and mirrors the subscription state that Stripe reports through webhooks.
 */
export const billingAccounts = pgTable(
  'billing_accounts',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    stripeCustomerId: text('stripe_customer_id'),
    /** `payg` unless an active subscription says otherwise. */
    planCode: text('plan_code').notNull().default('payg'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    subscriptionStatus: text('subscription_status'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    /** The card saved for the company (Stripe Checkout setup mode); display details only. */
    cardPaymentMethodId: text('card_payment_method_id'),
    cardBrand: text('card_brand'),
    cardLast4: text('card_last4'),
    cardSavedAt: timestamp('card_saved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('billing_accounts_customer_uq').on(t.stripeCustomerId),
    uniqueIndex('billing_accounts_subscription_uq').on(t.stripeSubscriptionId),
  ],
);

export const paymentKind = pgEnum('payment_kind', ['credits', 'request', 'subscription']);
export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'processing',
  'paid',
  'failed',
  'expired',
  'refunded',
  'partially_refunded',
  'disputed',
]);

/**
 * One payment attempt. The amount and credits are fixed here, from the database price, before the
 * customer reaches Stripe; a webhook must match them before anything is granted.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    kind: paymentKind('kind').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    description: text('description').notNull(),
    priceCode: text('price_code'),
    planCode: text('plan_code'),
    credits: integer('credits').notNull().default(0),
    amountCents: integer('amount_cents').notNull(),
    amountRefundedCents: integer('amount_refunded_cents').notNull().default(0),
    currency: text('currency').notNull(),
    /** For `request` payments: the request to send once payment is confirmed, and as whom. */
    requestId: uuid('request_id').references(() => signingRequests.id, { onDelete: 'restrict' }),
    dispatchAs: text('dispatch_as').references(() => user.id, { onDelete: 'restrict' }),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeInvoiceId: text('stripe_invoice_id'),
    failureReason: text('failure_reason'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payments_session_uq').on(t.stripeCheckoutSessionId),
    uniqueIndex('payments_invoice_uq').on(t.stripeInvoiceId),
    index('payments_workspace_idx').on(t.workspaceId, t.createdAt),
    index('payments_intent_idx').on(t.stripePaymentIntentId),
    check('payments_amount_nonneg', sql`${t.amountCents} >= 0`),
    check('payments_credits_nonneg', sql`${t.credits} >= 0`),
    check(
      'payments_request_has_sender',
      sql`${t.kind} <> 'request' or (${t.requestId} is not null and ${t.dispatchAs} is not null)`,
    ),
  ],
);

export const creditEntryType = pgEnum('credit_entry_type', [
  'purchase',
  'subscription_allowance',
  'promotional',
  'admin_adjustment',
  'reserve',
  'restore',
  'expire',
  'reversal',
]);
/** Purchased credits never expire; a subscription allowance lasts one billing period. */
export const creditBucket = pgEnum('credit_bucket', ['purchased', 'allowance']);

/**
 * Append-only credit ledger. The balance is always the sum of `delta`; nothing is ever edited. The
 * unique idempotency key makes a repeated webhook or double click a no-op instead of a double grant.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    entryType: creditEntryType('entry_type').notNull(),
    bucket: creditBucket('bucket').notNull(),
    delta: integer('delta').notNull(),
    requestId: uuid('request_id').references(() => signingRequests.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    note: text('note'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('credit_ledger_idem_uq').on(t.idempotencyKey),
    index('credit_ledger_workspace_idx').on(t.workspaceId, t.seq),
    check('credit_ledger_delta_nonzero', sql`${t.delta} <> 0`),
  ],
);

export const holdStatus = pgEnum('credit_hold_status', ['reserved', 'consumed', 'restored']);

/** The credit set aside for one signing request: reserved, then consumed or restored. */
export const creditHolds = pgTable(
  'credit_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => signingRequests.id, { onDelete: 'restrict' }),
    bucket: creditBucket('bucket').notNull(),
    status: holdStatus('status').notNull().default('reserved'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('credit_holds_request_uq').on(t.requestId),
    index('credit_holds_workspace_idx').on(t.workspaceId),
  ],
);

/** Invoices and receipts as Stripe reports them; the PDF and hosted page stay on Stripe. */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    stripeInvoiceId: text('stripe_invoice_id').notNull(),
    number: text('number'),
    status: text('status').notNull(),
    description: text('description'),
    amountDueCents: integer('amount_due_cents').notNull(),
    amountPaidCents: integer('amount_paid_cents').notNull(),
    currency: text('currency').notNull(),
    hostedUrl: text('hosted_url'),
    pdfUrl: text('pdf_url'),
    billingReason: text('billing_reason'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invoices_stripe_uq').on(t.stripeInvoiceId),
    index('invoices_workspace_idx').on(t.workspaceId, t.issuedAt),
  ],
);

/** Every Stripe event received, so a retried delivery is recognised and processed once. */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  livemode: boolean('livemode').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
});
