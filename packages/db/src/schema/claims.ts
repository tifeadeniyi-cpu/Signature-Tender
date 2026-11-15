import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { workspaces } from './tenancy';
import { signingRequests, requestRecipients } from './signing';

/**
 * A recipient who created (or signed in to) an account and chose to keep a completed document in
 * it. A claim gives that user read access to the completed copy and evidence of one request only.
 * It never transfers ownership: the request stays in the sender's workspace, and the claimant gets
 * no access to that workspace or to other requests sent to the same address.
 */
export const documentClaims = pgTable(
  'document_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => signingRequests.id, { onDelete: 'restrict' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => requestRecipients.id, { onDelete: 'restrict' }),
    /** The sender's workspace, kept for reporting. The claimant is not a member of it. */
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('document_claims_user_request_uq').on(t.userId, t.requestId),
    index('document_claims_request_idx').on(t.requestId),
  ],
);
