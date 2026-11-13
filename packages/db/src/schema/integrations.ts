import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { workspaces } from './tenancy';
import { documents } from './documents';
import { signingRequests } from './signing';
import { integrationConnections } from './api';

/**
 * Integrations marketplace framework. Connectors never create their own documents, requests or
 * charges: they link external records to the canonical documents and signing requests, and do their
 * work through the same services as the website and the public API.
 */

/**
 * OAuth tokens for one connection, sealed with AES-256-GCM under a server-held key. The app decrypts
 * them only on the server, only to call the provider. They are never sent to the browser or logged.
 */
export const integrationCredentials = pgTable('integration_credentials', {
  connectionId: uuid('connection_id')
    .primaryKey()
    .references(() => integrationConnections.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sealedAccessToken: text('sealed_access_token').notNull(),
  sealedRefreshToken: text('sealed_refresh_token'),
  tokenType: text('token_type').notNull().default('Bearer'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Links an external record (a Drive file, a HubSpot deal) to a document and, once sent, its signing
 * request. One envelope can have several external records; the same link cannot be made twice.
 */
export const integrationMappings = pgTable(
  'integration_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalObjectType: text('external_object_type').notNull(),
    externalObjectId: text('external_object_id').notNull(),
    externalLabel: text('external_label'),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id').references(() => signingRequests.id, { onDelete: 'restrict' }),
    syncStatus: text('sync_status').notNull().default('linked'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('integration_mappings_uq').on(
      t.connectionId,
      t.externalObjectType,
      t.externalObjectId,
      t.documentId,
    ),
    index('integration_mappings_doc_idx').on(t.documentId),
    index('integration_mappings_request_idx').on(t.requestId),
    index('integration_mappings_external_idx').on(
      t.workspaceId,
      t.provider,
      t.externalObjectType,
      t.externalObjectId,
    ),
    check(
      'integration_mappings_sync_status',
      sql`${t.syncStatus} in ('linked','pending','synced','failed')`,
    ),
  ],
);

/**
 * An automation rule: when a Signature Tender event happens, run a connector action, such as "when
 * a request completes, save the signed PDF to this Drive folder". Matching events create sync jobs.
 * Actions run with the permissions of the member who created the rule.
 */
export const integrationEventSubscriptions = pgTable(
  'integration_event_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    eventType: text('event_type').notNull(),
    action: text('action').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    configuration: jsonb('configuration').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    runCount: integer('run_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('integration_subscriptions_match_idx')
      .on(t.workspaceId, t.eventType)
      .where(sql`${t.enabled}`),
    index('integration_subscriptions_conn_idx').on(t.connectionId),
  ],
);

/**
 * One unit of connector work (an import, a save-back, a CRM update). The idempotency key makes a
 * second attempt to queue the same work a no-op, so retries never duplicate an envelope, an
 * invitation or a charge.
 */
export const integrationSyncJobs = pgTable(
  'integration_sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => integrationEventSubscriptions.id, {
      onDelete: 'set null',
    }),
    operation: text('operation').notNull(),
    status: text('status').notNull().default('pending'),
    idempotencyKey: text('idempotency_key').notNull(),
    /** The member whose permissions the job runs with. */
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(6),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    /** The webhook_events id that caused the job, when an automation did. */
    correlationId: text('correlation_id'),
    externalReference: text('external_reference'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    requestId: uuid('request_id').references(() => signingRequests.id, { onDelete: 'set null' }),
    /** Non-secret inputs (ids, folder choice). Never tokens or document contents. */
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb('output').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('integration_sync_jobs_idem_uq').on(t.workspaceId, t.idempotencyKey),
    index('integration_sync_jobs_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('pending','retrying')`),
    index('integration_sync_jobs_conn_idx').on(t.connectionId, t.createdAt),
    check(
      'integration_sync_jobs_status',
      sql`${t.status} in ('pending','running','retrying','succeeded','failed','cancelled')`,
    ),
  ],
);

/**
 * What connectors did, for the Activity & Sync Logs page. Metadata is sanitised before it is
 * written: no tokens, secrets, document contents or recipient personal details.
 */
export const integrationActivity = pgTable(
  'integration_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').references(() => integrationConnections.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull(),
    action: text('action').notNull(),
    status: text('status').notNull(),
    jobId: uuid('job_id').references(() => integrationSyncJobs.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    requestId: uuid('request_id').references(() => signingRequests.id, { onDelete: 'set null' }),
    externalReference: text('external_reference'),
    correlationId: text('correlation_id'),
    durationMs: integer('duration_ms'),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    errorCode: text('error_code'),
    message: text('message'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('integration_activity_ws_idx').on(t.workspaceId, t.occurredAt),
    index('integration_activity_conn_idx').on(t.connectionId, t.occurredAt),
    check(
      'integration_activity_status',
      sql`${t.status} in ('success','pending','retrying','failed','cancelled')`,
    ),
  ],
);
