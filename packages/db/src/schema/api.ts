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
  primaryKey,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { workspaces } from './tenancy';

/**
 * Phase 7 (spec Parts 22, 23 and 25.8): API keys, idempotency, rate limits, webhooks and partner
 * connections. An API key acts as the member who created it, limited further by its scopes, and
 * only inside its own workspace. Key secrets are stored only as SHA-256 hashes.
 */

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** First characters of the key, shown so people can tell keys apart. Not secret. */
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('api_keys_hash_uq').on(t.keyHash),
    index('api_keys_ws_idx').on(t.workspaceId),
    check('api_keys_name_len', sql`char_length(${t.name}) between 1 and 80`),
  ],
);

/** Stored responses for Idempotency-Key retries (kept 24 hours). */
export const apiIdempotency = pgTable(
  'api_idempotency',
  {
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.apiKeyId, t.key] })],
);

/** Fixed one-minute windows per key. */
export const apiRateWindows = pgTable(
  'api_rate_windows',
  {
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.apiKeyId, t.windowStart] })],
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description').notNull().default(''),
    /** Event types to send; empty means all. */
    events: text('events')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Signing secret, encrypted with the server key (AES-256-GCM). Needed in plain form to sign. */
    secretEncrypted: text('secret_encrypted').notNull(),
    /** After rotation the old secret also signs for 24 hours, so receivers can switch over. */
    previousSecretEncrypted: text('previous_secret_encrypted'),
    previousSecretExpiresAt: timestamp('previous_secret_expires_at', { withTimezone: true }),
    /** `signature_tender`: signed JSON. `slack`: a Slack incoming webhook; plain text, no signature. */
    format: text('format').notNull().default('signature_tender'),
    enabled: boolean('enabled').notNull().default(true),
    disabledReason: text('disabled_reason'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhook_endpoints_ws_idx').on(t.workspaceId)],
);

/** Outbox: one row per business event, written by database triggers so no code path can skip it. */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    fannedOutAt: timestamp('fanned_out_at', { withTimezone: true }),
  },
  (t) => [
    index('webhook_events_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.fannedOutAt} is null`),
    index('webhook_events_ws_idx').on(t.workspaceId, t.createdAt),
  ],
);

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'pending',
  'delivering',
  'succeeded',
  'failed',
  'dead',
]);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => webhookEvents.id, { onDelete: 'cascade' }),
    status: webhookDeliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('webhook_deliveries_uq').on(t.endpointId, t.eventId),
    index('webhook_deliveries_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('pending','failed')`),
    index('webhook_deliveries_ws_idx').on(t.workspaceId, t.createdAt),
  ],
);

/**
 * A connection from a workspace to a third-party app. Partner apps (Beam Artist, Jectstack) bundle
 * an API key and a webhook endpoint; OAuth apps (Google Drive) hold encrypted tokens in
 * `integration_credentials`. One connection per provider per workspace.
 */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    status: text('status').notNull().default('active'),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    webhookEndpointId: uuid('webhook_endpoint_id').references(() => webhookEndpoints.id, {
      onDelete: 'set null',
    }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** The account authorized at the provider (OAuth apps), e.g. a Google account email. */
    externalAccountId: text('external_account_id'),
    externalAccountLabel: text('external_account_label'),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Connector settings, e.g. Drive auto-save folder. Never holds secrets. */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    lastError: text('last_error'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('integration_connections_uq').on(t.workspaceId, t.provider),
    check(
      'integration_connections_status',
      sql`${t.status} in ('active','expired','error','disabled')`,
    ),
  ],
);

/** Calls per API key per day, for usage reporting. Written only by `st_api_rate_hit` and `st_api_usage_error`. */
export const apiUsageDaily = pgTable(
  'api_usage_daily',
  {
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    calls: integer('calls').notNull().default(0),
    errors: integer('errors').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.apiKeyId, t.day] }),
    index('api_usage_daily_ws_idx').on(t.workspaceId, t.day),
  ],
);
