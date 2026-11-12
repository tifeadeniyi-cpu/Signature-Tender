import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  doublePrecision,
  bigint,
  index,
  uniqueIndex,
  pgEnum,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { workspaces } from './tenancy';

/**
 * Preparation states from spec Part 30. Request states (awaiting payment, sent, completed...) are
 * added to `signing_requests` in Phase 3/4; a document never jumps to them directly.
 */
export const documentStatus = pgEnum('document_status', [
  'draft',
  'uploading',
  'processing',
  'ready_for_preparation',
  'preparing',
  'ready_to_send',
]);

export const recipientRole = pgEnum('recipient_role', [
  'signer',
  'reviewer',
  'approver',
  'cc',
  'viewer',
]);
export const recipientAuth = pgEnum('recipient_auth', ['email_link', 'email_code']);
export const fieldType = pgEnum('field_type', [
  'signature',
  'initials',
  'date_signed',
  'name',
  'email',
  'text',
  'checkbox',
  'dropdown',
  'radio',
  'number',
]);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    documentType: text('document_type').notNull().default('agreement'),
    status: documentStatus('status').notNull().default('draft'),
    signingOrderEnabled: boolean('signing_order_enabled').notNull().default(false),
    /** Validated by `documentSettingsSchema` in @st/core. */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    emailMessage: text('email_message'),
    pageCount: integer('page_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Hidden from the main list but kept intact. Completed records are archived, never edited. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** A legal hold blocks deletion and purging regardless of the retention period. */
    legalHold: boolean('legal_hold').notNull().default(false),
    legalHoldReason: text('legal_hold_reason'),
    /** Set when retention ran out and the stored files were removed. Metadata and evidence remain. */
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (t) => [
    index('documents_ws_updated_idx').on(t.workspaceId, t.updatedAt),
    index('documents_creator_idx').on(t.createdBy),
    check('documents_title_len', sql`char_length(${t.title}) between 1 and 200`),
  ],
);

/** Uploaded PDF bytes live in private object storage; this row holds the key and integrity hash. */
export const documentFiles = pgTable(
  'document_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    kind: text('kind').notNull().default('original'),
    storageKey: text('storage_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    pageCount: integer('page_count').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('document_files_key_uq').on(t.storageKey),
    uniqueIndex('document_files_doc_version_kind_uq').on(t.documentId, t.version, t.kind),
    check('document_files_sha_len', sql`char_length(${t.sha256}) = 64`),
    check('document_files_size_pos', sql`${t.sizeBytes} > 0`),
  ],
);

export const documentRecipients = pgTable(
  'document_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    role: recipientRole('role').notNull().default('signer'),
    signingOrder: integer('signing_order').notNull().default(1),
    authMethod: recipientAuth('auth_method').notNull().default('email_link'),
    /** Display colour index for field placement (spec Part 11 recipient colour coding). */
    colorIndex: integer('color_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('document_recipients_email_uq').on(t.documentId, sql`lower(${t.email})`),
    check('document_recipients_order_pos', sql`${t.signingOrder} >= 1`),
  ],
);

/** Field coordinates are fractions of the page (0..1) so they survive any render scale. */
export const documentFields = pgTable(
  'document_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => documentRecipients.id, { onDelete: 'cascade' }),
    type: fieldType('type').notNull(),
    page: integer('page').notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    width: doublePrecision('width').notNull(),
    height: doublePrecision('height').notNull(),
    required: boolean('required').notNull().default(true),
    label: text('label'),
    options: jsonb('options').$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_fields_doc_idx').on(t.documentId),
    check('document_fields_page_pos', sql`${t.page} >= 1`),
    check(
      'document_fields_bounds',
      sql`${t.x} >= 0 and ${t.y} >= 0 and ${t.width} > 0 and ${t.height} > 0 and ${t.x} + ${t.width} <= 1.0001 and ${t.y} + ${t.height} <= 1.0001`,
    ),
  ],
);
