import { pgTable, text, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';

/**
 * Signature Tender staff who may open the internal administration area (spec Part 27). Separate
 * from workspace roles: being a workspace owner never grants this. Granted only by the database
 * owner (see docs/operations/admin.md); the app role cannot write it.
 */
export const platformAdmins = pgTable(
  'platform_admins',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    note: text('note').notNull().default(''),
    /**
     * What this staff member may do in the admin portal (see st_admin_permissions). Defaults to
     * the read-only analyst role so a grant without a role gives the least access.
     */
    role: text('role').notNull().default('analyst'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'platform_admins_role',
      sql`${t.role} in ('founder','finance','support','security','technical','analyst')`,
    ),
  ],
);

/** Staff roles, most privileged first. Founder has no access to customer documents either. */
export const ADMIN_ROLES = [
  'founder',
  'finance',
  'support',
  'security',
  'technical',
  'analyst',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
