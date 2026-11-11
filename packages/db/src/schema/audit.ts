import { pgTable, uuid, text, timestamp, jsonb, index, bigserial } from 'drizzle-orm/pg-core';
import { workspaces } from './tenancy';

/**
 * Append-only audit log. The application role has INSERT and SELECT only (see the RLS migration);
 * UPDATE and DELETE are revoked so history cannot be rewritten from the app.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'restrict' }),
    actorUserId: text('actor_user_id'),
    actorType: text('actor_type').notNull().default('user'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_ws_time_idx').on(t.workspaceId, t.occurredAt),
    index('audit_actor_idx').on(t.actorUserId),
  ],
);
