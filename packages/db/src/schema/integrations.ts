import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './tenancy';
import { documents } from './documents';
import { integrationConnections, webhookEvents } from './api';

/**
 * Integrations Marketplace. Signing data stays in the canonical document and request tables; these
 * tables only hold connection secrets, links to external records and a log of what was synced.
 */

/**
 * OAuth tokens for a connection, encrypted with the server key (AES-256-GCM). Kept apart from
 * `integration_connections` so listing connections never reads secrets.
 */
export const integrationCredentials = pgTable('integration_credentials', {
  connectionId: uuid('connection_id')
    .primaryKey()
    .references(() => integrationConnections.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  /** JSON { accessToken, refreshToken } sealed with the server key. */
  secretEncrypted: text('secret_encrypted').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Links a Signature Tender document to records in a connected app (a Drive file, a CRM deal). */
export const integrationMappings = pgTable(
  'integration_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').references(() => integrationConnections.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull(),
    externalObjectType: text('external_object_type').notNull(),
    externalObjectId: text('external_object_id').notNull(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** imported | synced | failed */
    syncStatus: text('sync_status').notNull().default('imported'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('integration_mappings_uq').on(
      t.workspaceId,
      t.provider,
      t.externalObjectType,
      t.externalObjectId,
      t.documentId,
    ),
    index('integration_mappings_doc_idx').on(t.documentId),
  ],
);

/**
 * Work done for a connection: queued sync jobs (save a signed copy to Drive) and immediate actions
 * (import a file). Doubles as the Activity & Sync Log. `details` is sanitized: ids and names only,
 * never tokens or document contents.
 */
export const integrationJobs = pgTable(
  'integration_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').references(() => integrationConnections.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull(),
    operation: text('operation').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    /** The webhook outbox event that caused this job, if any. Unique per connection and operation. */
    eventId: uuid('event_id').references(() => webhookEvents.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    requestId: uuid('request_id'),
    externalReference: text('external_reference'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    uniqueIndex('integration_jobs_event_uq')
      .on(t.connectionId, t.operation, t.eventId)
      .where(sql`${t.eventId} is not null`),
    index('integration_jobs_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('pending','retrying')`),
    index('integration_jobs_ws_idx').on(t.workspaceId, t.createdAt),
    check(
      'integration_jobs_status',
      sql`${t.status} in ('pending','running','retrying','succeeded','failed','cancelled')`,
    ),
  ],
);
