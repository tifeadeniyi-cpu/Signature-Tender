import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './tenancy';
import { documents } from './documents';
import { signingRequests, requestRecipients } from './signing';

/**
 * Delivery state of one transactional email. "delivered" means the receiving mail server accepted
 * it (reported by the email provider); it never means the recipient opened or read it.
 */
export const notificationStatus = pgEnum('notification_status', [
  'queued',
  'sending',
  'sent',
  'delivered',
  'retrying',
  'failed',
  'bounced',
  'cancelled',
]);

/**
 * Transactional email outbox and delivery log. Rows are written in the same transaction as the
 * event that causes them (for example a request completing), then sent by a background dispatcher
 * that retries with backoff. The payload holds only display metadata (names, title, counts): never
 * link tokens or document contents. Links in the email carry a token derived from a server secret;
 * only its hash is stored here.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => signingRequests.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    /** Template key, for example document_completed. */
    template: text('template').notNull(),
    templateVersion: text('template_version').notNull(),
    /** sender: the workspace user who sent the request (links go to the signed-in app). */
    audience: text('audience').notNull(),
    recipientId: uuid('recipient_id').references(() => requestRecipients.id, {
      onDelete: 'restrict',
    }),
    userId: text('user_id'),
    toEmail: text('to_email').notNull(),
    toName: text('to_name').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: notificationStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    /** SHA-256 of the current access-link token. Bumping link_version invalidates older links. */
    linkHash: text('link_hash'),
    linkVersion: integer('link_version').notNull().default(1),
    linkExpiresAt: timestamp('link_expires_at', { withTimezone: true }),
    linkRevokedAt: timestamp('link_revoked_at', { withTimezone: true }),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One notification per template, request and address: repeated completion events are no-ops.
    uniqueIndex('notifications_once_uq').on(t.requestId, t.template, sql`lower(${t.toEmail})`),
    uniqueIndex('notifications_link_uq').on(t.linkHash),
    index('notifications_due_idx').on(t.status, t.nextAttemptAt),
    index('notifications_provider_idx').on(t.providerMessageId),
    index('notifications_doc_idx').on(t.documentId, t.createdAt),
    check('notifications_audience', sql`${t.audience} in ('sender', 'recipient')`),
  ],
);
