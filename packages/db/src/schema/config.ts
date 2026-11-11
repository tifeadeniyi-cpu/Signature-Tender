import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Feature flags. `production_signing` stays false until release gates pass. */
export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  /** Optional environment allow-list, e.g. ['development','staging']. Empty = all environments. */
  environments: text('environments')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Configurable values that must not be hardcoded: limits, legal text versions, support email. */
export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    currency: text('currency').notNull().default('USD'),
    /** NULL means custom/negotiated pricing (Enterprise). */
    monthlyPriceCents: integer('monthly_price_cents'),
    /** NULL means none included (Pay As You Go) or configurable (Enterprise). */
    includedRequests: integer('included_requests'),
    overagePriceCents: integer('overage_price_cents'),
    isCustom: boolean('is_custom').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    stripePriceId: text('stripe_price_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('plans_code_uq').on(t.code),
    check('plans_price_nonneg', sql`${t.monthlyPriceCents} is null or ${t.monthlyPriceCents} >= 0`),
    check(
      'plans_overage_nonneg',
      sql`${t.overagePriceCents} is null or ${t.overagePriceCents} >= 0`,
    ),
  ],
);

/** One-time products: single signing request and prepaid credit bundles. */
export const prices = pgTable(
  'prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    credits: integer('credits').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    stripePriceId: text('stripe_price_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('prices_code_uq').on(t.code),
    check('prices_credits_pos', sql`${t.credits} > 0`),
    check('prices_amount_nonneg', sql`${t.amountCents} >= 0`),
  ],
);
