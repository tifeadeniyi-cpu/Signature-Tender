import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  date,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { workspaces } from './tenancy';
import { payments, creditLedger } from './billing';

/**
 * Give 1, Get 2 referral program.
 *
 * Rewards are ordinary credit-ledger entries in the `referral` bucket, so balances are never kept
 * twice. These tables only record who referred whom, where each case stands and which ledger
 * entry paid each reward. Everything is written by the billing system context
 * (withBillingSystem); people read their own referrals through @st/core, which masks the
 * referred person's identity.
 */

/** A campaign. Launch has one: the standard Give 1, Get 2 program. */
export const referralProgramStatus = pgEnum('referral_program_status', [
  'active',
  'paused',
  'ended',
]);

export const referralPrograms = pgTable(
  'referral_programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable key, for example `standard`. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    status: referralProgramStatus('status').notNull().default('paused'),
    referrerCredits: integer('referrer_credits').notNull().default(2),
    referredCredits: integer('referred_credits').notNull().default(1),
    attributionWindowDays: integer('attribution_window_days').notNull().default(30),
    /** Hours between a qualifying payment and the referrer's reward (a settlement hold). */
    qualificationDelayHours: integer('qualification_delay_hours').notNull().default(0),
    /** Everything else (limits, messages, switches): see ReferralSettings in @st/core. */
    settings: jsonb('settings').notNull().default({}),
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('referral_programs_key_uq').on(t.key),
    check(
      'referral_programs_credits',
      sql`${t.referrerCredits} >= 0 and ${t.referredCredits} >= 0`,
    ),
  ],
);

/**
 * A person's referral link in one workspace. The workspace is the wallet that receives their
 * rewards, so exactly one wallet owner is designated.
 */
export const referralIdentityStatus = pgEnum('referral_identity_status', ['active', 'revoked']);

export const referralIdentities = pgTable(
  'referral_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Random, upper-case, unambiguous characters. Matched case-insensitively. */
    code: text('code').notNull(),
    status: referralIdentityStatus('status').notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('referral_identities_code_uq').on(t.code),
    uniqueIndex('referral_identities_owner_ws_uq').on(t.ownerUserId, t.workspaceId),
    check('referral_identities_code_shape', sql`${t.code} ~ '^[A-Z2-9]{8,12}$'`),
  ],
);

export const referralStatus = pgEnum('referral_status', [
  'verification_pending',
  'verified',
  'awaiting_purchase',
  'under_review',
  'rewarded',
  'rejected',
  'reversed',
]);

/** One new account referred by one link. A person can be referred only once, ever. */
export const referralAttributions = pgTable(
  'referral_attributions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => referralIdentities.id, { onDelete: 'restrict' }),
    programId: uuid('program_id')
      .notNull()
      .references(() => referralPrograms.id, { onDelete: 'restrict' }),
    referredUserId: text('referred_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Where the welcome credit went (the first workspace the new person created). */
    referredWorkspaceId: uuid('referred_workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    /** link: arrived through /r/CODE. code: typed the code on the sign-up form. */
    source: text('source').notNull(),
    status: referralStatus('status').notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
    /** The referrer is rewarded after this time (settlement hold), unless held for review. */
    rewardAfter: timestamp('reward_after', { withTimezone: true }),
    qualificationPaymentId: uuid('qualification_payment_id').references(() => payments.id, {
      onDelete: 'restrict',
    }),
    /** Risk signals found so far, for example ["same_email_owner", "disposable_email"]. */
    riskFlags: jsonb('risk_flags').notNull().default([]),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('referral_attributions_referred_uq').on(t.referredUserId),
    index('referral_attributions_identity_idx').on(t.identityId, t.createdAt),
    index('referral_attributions_status_idx').on(t.status),
    check('referral_attributions_source', sql`${t.source} in ('link', 'code')`),
  ],
);

export const referralRewardKind = pgEnum('referral_reward_kind', ['welcome', 'referrer']);
export const referralRewardStatus = pgEnum('referral_reward_status', ['issued', 'reversed']);

/** Each referral pays each reward at most once (unique on attribution + kind). */
export const referralRewards = pgTable(
  'referral_rewards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attributionId: uuid('attribution_id')
      .notNull()
      .references(() => referralAttributions.id, { onDelete: 'restrict' }),
    kind: referralRewardKind('kind').notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    credits: integer('credits').notNull(),
    status: referralRewardStatus('status').notNull().default('issued'),
    ledgerEntryId: uuid('ledger_entry_id')
      .notNull()
      .references(() => creditLedger.id, { onDelete: 'restrict' }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    /** Credits actually taken back on reversal (never more than were still unused). */
    reversedCredits: integer('reversed_credits'),
    reversalReason: text('reversal_reason'),
  },
  (t) => [
    uniqueIndex('referral_rewards_once_uq').on(t.attributionId, t.kind),
    index('referral_rewards_workspace_idx').on(t.workspaceId, t.issuedAt),
    check('referral_rewards_credits_pos', sql`${t.credits} > 0`),
  ],
);

/** Every status change, decision and adjustment, with who made it and why. Append-only. */
export const referralEvents = pgTable(
  'referral_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attributionId: uuid('attribution_id').references(() => referralAttributions.id, {
      onDelete: 'cascade',
    }),
    identityId: uuid('identity_id').references(() => referralIdentities.id, {
      onDelete: 'cascade',
    }),
    type: text('type').notNull(),
    /** system, user or admin. */
    actorType: text('actor_type').notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    data: jsonb('data').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('referral_events_attribution_idx').on(t.attributionId, t.createdAt),
    index('referral_events_type_idx').on(t.type, t.createdAt),
  ],
);

/** Daily visit counts per link: a funnel number only, never a referral. No visitor data kept. */
export const referralVisits = pgTable(
  'referral_visits',
  {
    identityId: uuid('identity_id')
      .notNull()
      .references(() => referralIdentities.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    visits: integer('visits').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.identityId, t.day] })],
);
