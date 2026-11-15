import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  doublePrecision,
  bigserial,
  customType,
  index,
  uniqueIndex,
  pgEnum,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { workspaces } from './tenancy';
import { documents, documentFiles, recipientRole, recipientAuth, fieldType } from './documents';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** Request states from spec Part 30. Email delivery state is tracked per recipient, separately. */
export const requestStatus = pgEnum('request_status', [
  'awaiting_payment',
  'payment_processing',
  'ready_to_dispatch',
  'queued',
  'sent',
  'in_progress',
  'awaiting_approval',
  'completed',
  'declined',
  'expired',
  'cancelled',
  'finalization_failed',
]);

export const recipientStatus = pgEnum('recipient_status', [
  'waiting',
  'notified',
  'viewed',
  'signed',
  'declined',
]);

export const signatureMethod = pgEnum('signature_method', ['typed', 'drawn', 'uploaded']);
export const signatureKind = pgEnum('signature_kind', ['signature', 'initials']);

/**
 * One send of a prepared document. Recipients and fields are snapshotted here so later edits to the
 * draft can never change what a signer saw or signed.
 */
export const signingRequests = pgTable(
  'signing_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    status: requestStatus('status').notNull(),
    /** Test requests are free, clearly marked, and only possible where the test_signing flag allows. */
    isTest: boolean('is_test').notNull(),
    title: text('title').notNull(),
    sentBy: text('sent_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    senderName: text('sender_name').notNull(),
    senderEmail: text('sender_email').notNull(),
    workspaceName: text('workspace_name').notNull(),
    sourceFileId: uuid('source_file_id')
      .notNull()
      .references(() => documentFiles.id, { onDelete: 'restrict' }),
    sourceSha256: text('source_sha256').notNull(),
    signingOrderEnabled: boolean('signing_order_enabled').notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
    emailMessage: text('email_message'),
    disclosureVersion: text('disclosure_version').notNull(),
    disclosureText: text('disclosure_text').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedReason: text('closed_reason'),
    signedFileId: uuid('signed_file_id').references(() => documentFiles.id),
    certificateFileId: uuid('certificate_file_id').references(() => documentFiles.id),
    /** CERT-YYYY-NNNNNN, assigned when a certificate is issued. */
    certificateNumber: text('certificate_number'),
    /** Public, non-secret reference printed on the certificate and used on /verify. */
    verificationRef: text('verification_ref'),
    certificateIssuedAt: timestamp('certificate_issued_at', { withTimezone: true }),
    /** SHA-256 of the combined package (signed agreement + certificate). */
    packageSha256: text('package_sha256'),
    finalizationError: text('finalization_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('signing_requests_doc_idx').on(t.documentId),
    index('signing_requests_ws_idx').on(t.workspaceId, t.createdAt),
    // At most one open request per document.
    uniqueIndex('signing_requests_one_open_uq')
      .on(t.documentId)
      .where(sql`status not in ('completed','declined','expired','cancelled')`),
    check('signing_requests_sha_len', sql`char_length(${t.sourceSha256}) = 64`),
  ],
);

export const requestRecipients = pgTable(
  'request_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => signingRequests.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    role: recipientRole('role').notNull(),
    signingOrder: integer('signing_order').notNull(),
    authMethod: recipientAuth('auth_method').notNull(),
    colorIndex: integer('color_index').notNull().default(0),
    status: recipientStatus('status').notNull().default('waiting'),
    /** SHA-256 of the access token in the recipient's link. The token itself is never stored. */
    tokenHash: text('token_hash'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    /** SHA-256 of the browser session secret issued after the recipient starts (and, if required, verifies). */
    sessionHash: text('session_hash'),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }),
    otpHash: text('otp_hash'),
    otpExpiresAt: timestamp('otp_expires_at', { withTimezone: true }),
    otpAttempts: integer('otp_attempts').notNull().default(0),
    otpSentCount: integer('otp_sent_count').notNull().default(0),
    otpLastSentAt: timestamp('otp_last_sent_at', { withTimezone: true }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }),
    consentedAt: timestamp('consented_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    /** The signer's time zone when they signed (device setting, else IP); stamps use it. */
    timeZone: text('time_zone'),
    timeZoneSource: text('time_zone_source').$type<'device' | 'ip'>(),
    declineReason: text('decline_reason'),
    signedIp: text('signed_ip'),
    signedUserAgent: text('signed_user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('request_recipients_req_idx').on(t.requestId),
    uniqueIndex('request_recipients_token_uq').on(t.tokenHash),
    uniqueIndex('request_recipients_email_uq').on(t.requestId, sql`lower(${t.email})`),
  ],
);

export const requestFields = pgTable(
  'request_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => signingRequests.id, { onDelete: 'restrict' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => requestRecipients.id, { onDelete: 'restrict' }),
    type: fieldType('type').notNull(),
    page: integer('page').notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    width: doublePrecision('width').notNull(),
    height: doublePrecision('height').notNull(),
    required: boolean('required').notNull(),
    label: text('label'),
    options: jsonb('options').$type<string[]>(),
    value: text('value'),
    signatureId: uuid('signature_id'),
    filledAt: timestamp('filled_at', { withTimezone: true }),
  },
  (t) => [
    index('request_fields_req_idx').on(t.requestId),
    index('request_fields_recipient_idx').on(t.recipientId),
  ],
);

/** An adopted signature or initials mark. Stored as a sanitized PNG plus how it was created. */
export const signatures = pgTable(
  'signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => signingRequests.id, { onDelete: 'restrict' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => requestRecipients.id, { onDelete: 'restrict' }),
    kind: signatureKind('kind').notNull(),
    method: signatureMethod('method').notNull(),
    typedText: text('typed_text'),
    font: text('font'),
    imagePng: bytea('image_png').notNull(),
    imageSha256: text('image_sha256').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    adoptedAt: timestamp('adopted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('signatures_recipient_idx').on(t.recipientId)],
);

/**
 * Append-only evidence log for a signing request. Each row's hash covers the previous row's hash,
 * so removing or editing an earlier event breaks the chain.
 */
export const signingEvents = pgTable(
  'signing_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => signingRequests.id, { onDelete: 'restrict' }),
    recipientId: uuid('recipient_id').references(() => requestRecipients.id),
    actorUserId: text('actor_user_id'),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [
    index('signing_events_req_idx').on(t.requestId, t.seq),
    uniqueIndex('signing_events_hash_uq').on(t.hash),
  ],
);
