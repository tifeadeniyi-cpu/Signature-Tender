import {
  pgTable,
  text,
  timestamp,
  integer,
  date,
  uuid,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { workspaces } from './tenancy';

/**
 * Privacy-first measurement (founder admin phase 5). Nothing here stores IP addresses, user
 * agents, raw referrer URLs, campaign values or cookies. The app role cannot read or write these
 * tables directly: writes go through validating definer functions and reads only through the
 * staff report functions, which aggregate and suppress small groups.
 */

/** Website visits as daily counts by page group and coarse source. No row identifies a visitor. */
export const siteVisitsDaily = pgTable(
  'site_visits_daily',
  {
    day: date('day').notNull(),
    page: text('page').notNull(),
    source: text('source').notNull(),
    visits: integer('visits').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.page, t.source] })],
);

/** The coarse category a person arrived from before creating their account (one row each). */
export const userAcquisition = pgTable(
  'user_acquisition',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_acquisition_source_idx').on(t.source)],
);

/** Active (visible, focused, recently used) seconds in the signed-in app, per person per day. */
export const appActivityDaily = pgTable(
  'app_activity_daily',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    activeSeconds: integer('active_seconds').notNull().default(0),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day] }),
    index('app_activity_daily_day_idx').on(t.day),
    check('app_activity_daily_seconds', sql`${t.activeSeconds} BETWEEN 0 AND 57600`),
  ],
);

/** Subscription lifecycle, recorded from Stripe events: starts, renewals, cancellations, ends. */
export const subscriptionEvents = pgTable(
  'subscription_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** The Stripe subscription or invoice id the event came from, so retries record it once. */
    ref: text('ref').notNull(),
    planCode: text('plan_code'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('subscription_events_uq').on(t.kind, t.ref),
    index('subscription_events_at_idx').on(t.occurredAt),
    check(
      'subscription_events_kind',
      sql`${t.kind} IN ('started', 'renewed', 'renewal_failed', 'cancel_requested', 'cancel_withdrawn', 'ended')`,
    ),
  ],
);
