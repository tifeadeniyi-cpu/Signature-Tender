import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  bigint,
  index,
  uniqueIndex,
  pgEnum,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { workspaces, workspaceMemberships, roles } from './tenancy';

/**
 * Phase 6 (spec Parts 18 to 20 and 24): groups, invitations, contacts and templates.
 * Group membership never grants document access by itself; access always comes from the role.
 */

export const workspaceGroups = pgTable(
  'workspace_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workspace_groups_name_uq').on(t.workspaceId, sql`lower(${t.name})`),
    check('workspace_groups_name_len', sql`char_length(${t.name}) between 1 and 60`),
  ],
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => workspaceGroups.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => workspaceMemberships.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.membershipId] })],
);

/** The invitation token is only ever stored as a hash; the link in the email is the only copy. */
export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    groupId: uuid('group_id').references(() => workspaceGroups.id, { onDelete: 'set null' }),
    memberType: text('member_type').notNull().default('internal'),
    tokenHash: text('token_hash').notNull(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    sentCount: integer('sent_count').notNull().default(1),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: text('accepted_by').references(() => user.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('workspace_invitations_member_type', sql`${t.memberType} in ('internal','external')`),
    uniqueIndex('workspace_invitations_token_uq').on(t.tokenHash),
    // One open invitation per address per workspace.
    uniqueIndex('workspace_invitations_open_uq')
      .on(t.workspaceId, sql`lower(${t.email})`)
      .where(sql`accepted_at is null and revoked_at is null`),
  ],
);

export const contactVisibility = pgEnum('contact_visibility', ['shared', 'private']);

/** Address book entries. Appearing here never gives anyone access to a document. */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    visibility: contactVisibility('visibility').notNull().default('shared'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    company: text('company'),
    jobTitle: text('job_title'),
    contactType: text('contact_type').notNull().default('person'),
    notes: text('notes'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Shared contacts are unique per workspace; private ones per owner.
    uniqueIndex('contacts_email_uq').on(
      t.workspaceId,
      sql`(case when ${t.visibility} = 'private' then ${t.ownerUserId} else '' end)`,
      sql`lower(${t.email})`,
    ),
    index('contacts_ws_idx').on(t.workspaceId),
    check('contacts_name_len', sql`char_length(${t.name}) between 1 and 120`),
  ],
);

export const templateStatus = pgEnum('template_status', ['draft', 'active', 'archived']);

export const templateCategories = pgTable(
  'template_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('template_categories_name_uq').on(t.workspaceId, sql`lower(${t.name})`),
    check('template_categories_name_len', sql`char_length(${t.name}) between 1 and 40`),
  ],
);

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('Agreements'),
    documentType: text('document_type').notNull().default('agreement'),
    status: templateStatus('status').notNull().default('draft'),
    /** Shared templates are visible to everyone with templates.view; others only to the owner. */
    shared: boolean('shared').notNull().default(true),
    /** Latest published version number; 0 until first published. */
    publishedVersion: integer('published_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('templates_ws_idx').on(t.workspaceId),
    check('templates_title_len', sql`char_length(${t.title}) between 1 and 200`),
  ],
);

/**
 * Each version holds the PDF and the placeholder recipients, fields and settings. A published
 * version never changes; editing an active template works on a new draft version.
 */
export const templateVersions = pgTable(
  'template_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    storageKey: text('storage_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    pageCount: integer('page_count').notNull(),
    recipients: jsonb('recipients').$type<unknown[]>().notNull().default([]),
    fields: jsonb('fields').$type<unknown[]>().notNull().default([]),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    signingOrderEnabled: boolean('signing_order_enabled').notNull().default(false),
    emailMessage: text('email_message'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: text('published_by').references(() => user.id, { onDelete: 'restrict' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('template_versions_uq').on(t.templateId, t.version),
    // At most one unpublished draft per template.
    uniqueIndex('template_versions_one_draft_uq')
      .on(t.templateId)
      .where(sql`published_at is null`),
  ],
);
