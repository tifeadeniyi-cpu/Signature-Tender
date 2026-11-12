import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { workspaces } from './tenancy';

/**
 * How long a workspace keeps completed records, per document type. A row with no document type is
 * the workspace default. Without any row the platform default in app_config applies.
 */
export const retentionPolicies = pgTable(
  'retention_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** NULL means every document type without its own row. */
    documentType: text('document_type'),
    retainDays: integer('retain_days').notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('retention_ws_type_uq').on(t.workspaceId, sql`coalesce(${t.documentType}, '')`),
    check('retention_days_pos', sql`${t.retainDays} > 0`),
  ],
);

/**
 * A verified-email session for retrieving completed documents without an account (spec 17.3).
 * Only SECURITY DEFINER functions touch this table; the app role has no direct access.
 */
export const retrievalSessions = pgTable(
  'retrieval_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }).notNull(),
    sessionHash: text('session_hash'),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('retrieval_session_hash_uq').on(t.sessionHash),
    index('retrieval_email_idx').on(t.email, t.createdAt),
    index('retrieval_ip_idx').on(t.ipAddress, t.createdAt),
  ],
);
