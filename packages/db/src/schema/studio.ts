import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';

/**
 * Signature Studio: custom signature designs sold for a fixed price per finalized design.
 *
 * Anyone can design and preview. A guest draft belongs to a browser session, identified only by
 * the SHA-256 of a random httpOnly cookie, until the visitor signs in and the draft moves to their
 * account. Buying needs an account. Payment is never taken from the browser: an entitlement exists
 * only after the Stripe webhook has verified a paid checkout whose amount matches the purchase.
 */
export const signatureDesignStatus = pgEnum('signature_design_status', [
  'draft',
  'purchased',
  'archived',
]);

export const signatureDesigns = pgTable(
  'signature_designs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorSessionHash: text('creator_session_hash'),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull().default('My signature'),
    kind: text('kind').notNull().default('signature'),
    creationMethod: text('creation_method').notNull(),
    styleFamily: text('style_family'),
    /** The canonical design document (see @st/core studio/design). */
    design: jsonb('design').$type<Record<string, unknown>>().notNull(),
    canonicalDesignHash: text('canonical_design_hash').notNull(),
    rendererVersion: integer('renderer_version').notNull().default(1),
    version: integer('version').notNull().default(1),
    status: signatureDesignStatus('status').notNull().default('draft'),
    /** For a copy made with "Duplicate as new design": the design it started from. */
    duplicatedFrom: uuid('duplicated_from'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }),
  },
  (t) => [
    index('signature_designs_owner_idx').on(t.ownerUserId, t.updatedAt),
    index('signature_designs_session_idx').on(t.creatorSessionHash, t.updatedAt),
    uniqueIndex('signature_designs_default_uq')
      .on(t.ownerUserId, t.kind)
      .where(sql`${t.isDefault} and ${t.ownerUserId} is not null`),
    check(
      'signature_designs_has_owner',
      sql`${t.ownerUserId} is not null or ${t.creatorSessionHash} is not null`,
    ),
    check('signature_designs_kind', sql`${t.kind} in ('signature', 'initials')`),
  ],
);

/** Private upload images referenced by designs (sanitized PNG bytes live in object storage). */
export const signatureUploads = pgTable(
  'signature_uploads',
  {
    sha256: text('sha256').primaryKey(),
    storageKey: text('storage_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    creatorSessionHash: text('creator_session_hash'),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('signature_uploads_session_idx').on(t.creatorSessionHash)],
);

export const signaturePurchaseStatus = pgEnum('signature_purchase_status', [
  'pending',
  'processing',
  'paid',
  'failed',
  'expired',
  'refunded',
  'disputed',
  /** A second payment for a design that was already paid for; refunded automatically. */
  'duplicate',
]);

export const signaturePurchases = pgTable(
  'signature_purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    signatureDesignId: uuid('signature_design_id')
      .notNull()
      .references(() => signatureDesigns.id, { onDelete: 'restrict' }),
    /** Exactly what was bought: frozen copy of the design and its hash at checkout. */
    designSnapshot: jsonb('design_snapshot').$type<Record<string, unknown>>().notNull(),
    designHash: text('design_hash').notNull(),
    /** Purchases need an account: the buyer, who owns the purchased design. */
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    /** Email Stripe collected, for the receipt. */
    customerEmail: text('customer_email'),
    paymentProvider: text('payment_provider').notNull().default('stripe'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    amountCents: integer('amount_cents').notNull(),
    amountRefundedCents: integer('amount_refunded_cents').notNull().default(0),
    currency: text('currency').notNull(),
    paymentStatus: signaturePurchaseStatus('payment_status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('signature_purchases_session_uq').on(t.stripeCheckoutSessionId),
    index('signature_purchases_intent_idx').on(t.stripePaymentIntentId),
    index('signature_purchases_design_idx').on(t.signatureDesignId),
    index('signature_purchases_owner_idx').on(t.ownerUserId, t.createdAt),
    check('signature_purchases_amount_nonneg', sql`${t.amountCents} >= 0`),
  ],
);

export const signatureEntitlements = pgTable(
  'signature_entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    signatureDesignId: uuid('signature_design_id')
      .notNull()
      .references(() => signatureDesigns.id, { onDelete: 'restrict' }),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => signaturePurchases.id, { onDelete: 'restrict' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    accessStatus: text('access_status').notNull().default('active'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    uniqueIndex('signature_entitlements_purchase_uq').on(t.purchaseId),
    // One active entitlement per design: a second payment cannot create a second grant.
    uniqueIndex('signature_entitlements_design_active_uq')
      .on(t.signatureDesignId)
      .where(sql`${t.accessStatus} = 'active'`),
    index('signature_entitlements_owner_idx').on(t.ownerUserId),
    check('signature_entitlements_status', sql`${t.accessStatus} in ('active', 'revoked')`),
  ],
);

export const signatureAssets = pgTable(
  'signature_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    signatureDesignId: uuid('signature_design_id')
      .notNull()
      .references(() => signatureDesigns.id, { onDelete: 'restrict' }),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => signaturePurchases.id, { onDelete: 'restrict' }),
    format: text('format').notNull(),
    /** JPEG background colour; empty for PNG and SVG. */
    background: text('background').notNull().default(''),
    status: text('status').notNull().default('ready'),
    storageReference: text('storage_reference'),
    contentHash: text('content_hash'),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('signature_assets_variant_uq').on(t.purchaseId, t.format, t.background),
    index('signature_assets_status_idx').on(t.status),
    check('signature_assets_format', sql`${t.format} in ('png', 'svg', 'jpeg')`),
    check('signature_assets_status', sql`${t.status} in ('ready', 'failed')`),
  ],
);

export const signatureDownloads = pgTable(
  'signature_downloads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entitlementId: uuid('entitlement_id')
      .notNull()
      .references(() => signatureEntitlements.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => signatureAssets.id, { onDelete: 'set null' }),
    format: text('format').notNull(),
    via: text('via').notNull(),
    result: text('result').notNull(),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('signature_downloads_entitlement_idx').on(t.entitlementId, t.downloadedAt)],
);

/**
 * First-party funnel events for aggregate conversion reporting. Never holds artwork, typed names,
 * emails or payment details; ids only.
 */
export const signatureStudioEvents = pgTable(
  'signature_studio_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    event: text('event').notNull(),
    sessionHash: text('session_hash'),
    userId: text('user_id'),
    designId: uuid('design_id'),
    props: jsonb('props').$type<Record<string, string | number | boolean>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('signature_studio_events_event_idx').on(t.event, t.createdAt)],
);

/** Fixed-window counters for Studio rate limits (draft saves, uploads, checkout, recovery). */
export const signatureStudioRateLimits = pgTable('signature_studio_rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
});
