import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Signature Tender staff who may open the internal administration area (spec Part 27). Separate
 * from workspace roles: being a workspace owner never grants this. Granted only by the database
 * owner (see docs/operations/admin.md); the app role cannot write it.
 */
export const platformAdmins = pgTable('platform_admins', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  note: text('note').notNull().default(''),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
});
