import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
  pgEnum,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';

export const membershipStatus = pgEnum('membership_status', [
  'invited',
  'active',
  'suspended',
  'removed',
]);

/** Per-user profile details that are not part of the auth identity. Owned by the user only. */
export const userProfiles = pgTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  jobTitle: text('job_title'),
  phone: text('phone'),
  timezone: text('timezone').notNull().default('America/Chicago'),
  locale: text('locale').notNull().default('en-US'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    legalName: text('legal_name'),
    contactEmail: text('contact_email'),
    website: text('website'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workspaces_slug_uq').on(t.slug),
    check('workspaces_name_len', sql`char_length(${t.name}) between 1 and 120`),
  ],
);

/** Permission catalogue. Keys look like `documents.send`. */
export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
});

/** System roles have workspace_id NULL. Custom roles (later phase) belong to one workspace. */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('roles_scope_key_uq').on(sql`coalesce(${t.workspaceId}::text, 'system')`, t.key),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const workspaceMemberships = pgTable(
  'workspace_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    status: membershipStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('memberships_ws_user_uq').on(t.workspaceId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);
