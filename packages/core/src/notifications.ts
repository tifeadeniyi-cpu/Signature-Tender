import { createHmac } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  schema,
  withActor,
  withNotificationSystem,
  withRetrieval,
  type ActorContext,
  type Database,
  type Tx,
} from '@st/db';
import { AppError } from './errors';
import { getConfigValue } from './config';
import { documentSettingsSchema } from './documents';
import { hashSecret, isPlausibleSecret } from './signing-crypto';

/**
 * Transactional email notifications (outbox + delivery log).
 *
 * Completion emails are enqueued inside the transaction that marks a request completed, after the
 * signed copy and certificate are stored and their hashes recorded, so they exist exactly when the
 * request does and never for a request that is still open, declined, cancelled, expired or failed
 * to finalize. A dispatcher then claims due rows, renders and sends them, and retries failures with
 * backoff. Each address gets at most one email per template and request (unique index), so
 * repeated completion events cannot send duplicates.
 *
 * Access links: a recipient's email carries a token derived (HMAC) from a server secret and the row
 * id and link version. The database keeps only its hash. Following the link never grants access by
 * itself: the recipient must still verify the address with a one-time code, so a forwarded email is
 * not enough to open the agreement.
 */

export const COMPLETED_TEMPLATE = 'document_completed';
export const COMPLETED_TEMPLATE_VERSION = 'document_completed@1';
const MAX_ATTEMPTS = 6;
/** Wait before attempt n+1, after n failed attempts (seconds). */
const BACKOFF_SECONDS = [30, 120, 600, 1800, 7200, 21600];
const LEASE_SECONDS = 120;

export interface CompletedPayload {
  requestId: string;
  documentId: string;
  documentName: string;
  /** Shown as the Document ID; the request id is what the documents list searches by. */
  documentReference: string;
  documentPageCount: number | null;
  completedAt: string;
  completedSignerCount: number;
  requiredSignerCount: number;
  senderName: string;
  senderEmail: string;
  workspaceName: string;
  recipientName: string;
  isTest: boolean;
  /** The sender allowed recipients to download the completed copy. Senders can always download. */
  allowDownload: boolean;
  signedFileId: string;
  certificateFileId: string;
}

export type NotificationRow = typeof schema.notifications.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Enqueue

interface CompletionFacts {
  request: typeof schema.signingRequests.$inferSelect;
  recipients: (typeof schema.requestRecipients.$inferSelect)[];
  pageCount: number | null;
  completedAt: Date;
  signedFileId: string;
  certificateFileId: string;
}

/**
 * Queues the completion email for the sender and each recipient who did not decline. Must run in
 * the finalizing transaction, after the request row is marked completed with both files attached;
 * the insert policy refuses it otherwise. Safe to call twice: existing rows are left alone.
 */
export async function enqueueCompletionNotifications(tx: Tx, f: CompletionFacts): Promise<number> {
  const req = f.request;
  const settings = documentSettingsSchema.parse(req.settings ?? {});
  const signers = f.recipients.filter((r) => r.role === 'signer');
  const base = {
    requestId: req.id,
    documentId: req.documentId,
    documentName: req.title,
    documentReference: req.id,
    documentPageCount: f.pageCount,
    completedAt: f.completedAt.toISOString(),
    completedSignerCount: signers.filter((r) => r.status === 'signed').length,
    requiredSignerCount: signers.length,
    senderName: req.senderName,
    senderEmail: req.senderEmail,
    workspaceName: req.workspaceName,
    isTest: req.isTest,
    allowDownload: settings.allowDownload,
    signedFileId: f.signedFileId,
    certificateFileId: f.certificateFileId,
  } satisfies Omit<CompletedPayload, 'recipientName'>;

  const seen = new Set<string>();
  const rows: (typeof schema.notifications.$inferInsert)[] = [];
  const add = (row: Omit<typeof schema.notifications.$inferInsert, 'payload'>, name: string) => {
    const key = row.toEmail.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ ...row, payload: { ...base, recipientName: name } });
  };
  const common = {
    workspaceId: req.workspaceId,
    requestId: req.id,
    documentId: req.documentId,
    template: COMPLETED_TEMPLATE,
    templateVersion: COMPLETED_TEMPLATE_VERSION,
  };
  add(
    {
      ...common,
      audience: 'sender',
      userId: req.sentBy,
      toEmail: req.senderEmail,
      toName: req.senderName,
    },
    req.senderName,
  );
  for (const r of f.recipients) {
    if (r.status === 'declined') continue;
    add(
      { ...common, audience: 'recipient', recipientId: r.id, toEmail: r.email, toName: r.name },
      r.name,
    );
  }
  if (!rows.length) return 0;
  await tx.insert(schema.notifications).values(rows).onConflictDoNothing();
  return rows.length;
}

// ---------------------------------------------------------------------------------------------
// Links

/** Deterministic link token for a notification, so a retried send repeats the exact same email. */
export function notificationLinkToken(secret: string, id: string, version: number): string {
  if (secret.length < 32) throw new Error('The link secret must be at least 32 characters');
  return createHmac('sha256', `st-email-link:${secret}`)
    .update(`${id}:${version}`)
    .digest('base64url');
}

export interface ResolvedLink {
  notificationId: string;
  requestId: string;
  documentId: string;
  audience: 'sender' | 'recipient';
  email: string;
  title: string;
  requestStatus: string;
  expired: boolean;
  revoked: boolean;
}

/** Looks up an emailed link. Returns null for unknown or malformed tokens. */
export async function resolveNotificationLink(
  db: Database,
  token: string,
): Promise<ResolvedLink | null> {
  if (!isPlausibleSecret(token)) return null;
  const rows = (await db.execute(
    sql`select * from st_notification_link(${hashSecret(token)})`,
  )) as unknown as {
    notification_id: string;
    request_id: string;
    document_id: string;
    audience: 'sender' | 'recipient';
    to_email: string;
    title: string;
    request_status: string;
    expired: boolean;
    revoked: boolean;
  }[];
  const r = rows[0];
  if (!r) return null;
  return {
    notificationId: r.notification_id,
    requestId: r.request_id,
    documentId: r.document_id,
    audience: r.audience,
    email: r.to_email.toLowerCase(),
    title: r.title,
    requestStatus: r.request_status,
    expired: r.expired,
    revoked: r.revoked,
  };
}

/** Masks an address for display on the public link page: k•••@example.com. */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

/**
 * Renews an expired (not revoked) link after the recipient verified the address: the link version
 * goes up, older links stop working, and the email is queued again with a fresh link.
 */
export async function renewNotificationLink(
  db: Database,
  retrievalSessionToken: string | undefined,
  linkToken: string,
): Promise<{ email: string }> {
  const link = await resolveNotificationLink(db, linkToken);
  if (!link || link.audience !== 'recipient') throw new AppError('not_found', 'Link not found');
  if (link.revoked)
    throw new AppError('forbidden', 'The sender turned off this link. Contact them for a copy.');
  if (!retrievalSessionToken || !isPlausibleSecret(retrievalSessionToken))
    throw new AppError('unauthenticated', 'Verify your email first.');
  const sessionEmail = await withRetrieval(db, hashSecret(retrievalSessionToken), async (tx) => {
    const [row] = (await tx.execute(sql`select st_retrieval_email() as email`)) as unknown as {
      email: string | null;
    }[];
    return row?.email ?? null;
  });
  if (!sessionEmail || sessionEmail !== link.email)
    throw new AppError('forbidden', 'Verify the address this link was sent to.');
  await withNotificationSystem(db, (tx) =>
    tx
      .update(schema.notifications)
      .set({
        linkVersion: sql`${schema.notifications.linkVersion} + 1`,
        linkHash: null,
        linkExpiresAt: null,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: new Date(),
        leaseUntil: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.notifications.id, link.notificationId)),
  );
  return { email: link.email };
}

/** Sender turns off every emailed link for a request. Verification-based retrieval still works. */
export async function revokeNotificationLinks(
  db: Database,
  actor: ActorContext,
  requestId: string,
): Promise<number> {
  if (!z.string().uuid().safeParse(requestId).success) throw new AppError('not_found', 'Not found');
  return withActor(db, actor, async (tx) => {
    const [row] = (await tx.execute(
      sql`select st_revoke_notification_links(${requestId}::uuid) as n`,
    )) as unknown as { n: number }[];
    return row?.n ?? 0;
  });
}

// ---------------------------------------------------------------------------------------------
// Dispatch

export interface OutgoingNotificationEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string; contentId: string }[];
  tags?: { name: string; value: string }[];
}

/** Raised by a transport for errors worth retrying (rate limits, timeouts, provider outages). */
export class TransientEmailError extends Error {}

export interface NotificationTransport {
  send(
    msg: OutgoingNotificationEmail,
    opts: { idempotencyKey: string },
  ): Promise<{ providerMessageId: string | null }>;
}

export interface ClaimedNotification {
  row: NotificationRow;
  /** Raw link token for recipient emails (never stored); null for senders, who sign in instead. */
  linkToken: string | null;
  linkExpiresAt: Date | null;
}

export type NotificationRenderer = (
  n: ClaimedNotification,
) => OutgoingNotificationEmail | Promise<OutgoingNotificationEmail>;

export interface NotificationDispatchResult {
  id: string;
  status: 'sent' | 'retrying' | 'failed';
  error?: string;
}

/**
 * Claims due rows (queued, retry due, or a stuck lease) and gives each a link if it needs one.
 * Rows are locked with SKIP LOCKED so parallel dispatchers never take the same email, and each row
 * is written exactly once per claim: a second write of a row in the same transaction would make
 * Postgres re-check its foreign keys and lock the request and recipient rows, which can deadlock
 * with signing traffic on the same request.
 */
export async function claimDueNotifications(
  db: Database,
  opts: { linkSecret: string; limit?: number; requestId?: string },
): Promise<ClaimedNotification[]> {
  const days = await getConfigValue(db, 'notifications.link_valid_days', 30);
  const n = schema.notifications;
  return withNotificationSystem(db, async (tx) => {
    const due = sql`((${n.status} in ('queued', 'retrying') and ${n.nextAttemptAt} <= now())
      or (${n.status} = 'sending' and ${n.leaseUntil} < now()))`;
    const rows = await tx
      .select()
      .from(n)
      .where(opts.requestId ? and(due, eq(n.requestId, opts.requestId)) : due)
      .orderBy(n.nextAttemptAt)
      .limit(opts.limit ?? 25)
      .for('update', { skipLocked: true });
    const out: ClaimedNotification[] = [];
    for (const row of rows) {
      let linkToken: string | null = null;
      let link: { linkHash: string; linkExpiresAt: Date } | null = null;
      if (row.audience === 'recipient') {
        linkToken = notificationLinkToken(opts.linkSecret, row.id, row.linkVersion);
        const linkHash = hashSecret(linkToken);
        // A retry keeps the original expiry so the same email is sent again byte for byte.
        link = {
          linkHash,
          linkExpiresAt:
            row.linkHash === linkHash && row.linkExpiresAt
              ? row.linkExpiresAt
              : new Date(Date.now() + days * 86_400_000),
        };
      }
      const [claimed] = await tx
        .update(n)
        .set({
          status: 'sending',
          attempts: sql`${n.attempts} + 1`,
          leaseUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,
          updatedAt: new Date(),
          ...(link ?? {}),
        })
        .where(eq(n.id, row.id))
        .returning();
      out.push({ row: claimed!, linkToken, linkExpiresAt: link?.linkExpiresAt ?? null });
    }
    return out;
  });
}

async function markSent(db: Database, id: string, providerMessageId: string | null) {
  await withNotificationSystem(db, (tx) =>
    tx
      .update(schema.notifications)
      .set({
        status: 'sent',
        providerMessageId,
        sentAt: new Date(),
        leaseUntil: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.notifications.id, id)),
  );
}

async function markFailure(
  db: Database,
  row: NotificationRow,
  err: unknown,
): Promise<NotificationDispatchResult> {
  const retryable = err instanceof TransientEmailError;
  const message = String(err instanceof Error ? err.message : err).slice(0, 500);
  const giveUp = !retryable || row.attempts >= MAX_ATTEMPTS;
  const wait = BACKOFF_SECONDS[Math.min(row.attempts - 1, BACKOFF_SECONDS.length - 1)] ?? 3600;
  await withNotificationSystem(db, (tx) =>
    tx
      .update(schema.notifications)
      .set(
        giveUp
          ? {
              status: 'failed',
              failedAt: new Date(),
              lastError: message,
              leaseUntil: null,
              updatedAt: new Date(),
            }
          : {
              status: 'retrying',
              nextAttemptAt: new Date(Date.now() + wait * 1000),
              lastError: message,
              leaseUntil: null,
              updatedAt: new Date(),
            },
      )
      .where(eq(schema.notifications.id, row.id)),
  );
  return { id: row.id, status: giveUp ? 'failed' : 'retrying', error: message };
}

/**
 * Sends every due notification (optionally only one request's). A rendering or provider error
 * never loses the email: it is retried with backoff, then marked failed for operations to review.
 */
export async function dispatchDueNotifications(
  db: Database,
  deps: { transport: NotificationTransport; render: NotificationRenderer; linkSecret: string },
  opts: { limit?: number; requestId?: string } = {},
): Promise<NotificationDispatchResult[]> {
  const claimed = await claimDueNotifications(db, { linkSecret: deps.linkSecret, ...opts });
  const results: NotificationDispatchResult[] = [];
  for (const n of claimed) {
    try {
      const msg = await deps.render(n);
      const { providerMessageId } = await deps.transport.send(msg, {
        idempotencyKey: `notification-${n.row.id}-v${n.row.linkVersion}`,
      });
      await markSent(db, n.row.id, providerMessageId);
      results.push({ id: n.row.id, status: 'sent' });
    } catch (err) {
      results.push(await markFailure(db, n.row, err));
    }
  }
  return results;
}

/** Ids of notifications that are queued or due, for deciding whether to run the dispatcher. */
export async function countDueNotifications(db: Database): Promise<number> {
  return withNotificationSystem(db, async (tx) => {
    const [row] = (await tx.execute(sql`
      select count(*)::int as n from notifications
      where (status in ('queued', 'retrying') and next_attempt_at <= now())
         or (status = 'sending' and lease_until < now())`)) as unknown as { n: number }[];
    return row?.n ?? 0;
  });
}

// ---------------------------------------------------------------------------------------------
// Provider events (webhook)

const providerEvent = z.object({
  type: z.string(),
  messageId: z.string().min(1),
  at: z.date(),
  reason: z.string().nullable().optional(),
});

/**
 * Records a delivery event reported by the email provider. "Delivered" means the receiving server
 * accepted the message; it says nothing about whether anyone opened it.
 */
export async function recordProviderEvent(
  db: Database,
  input: z.input<typeof providerEvent>,
): Promise<boolean> {
  const e = providerEvent.parse(input);
  return withNotificationSystem(db, async (tx) => {
    const where = eq(schema.notifications.providerMessageId, e.messageId);
    let set: Partial<typeof schema.notifications.$inferInsert> | null = null;
    switch (e.type) {
      case 'email.delivered':
        set = { status: 'delivered', deliveredAt: e.at };
        break;
      case 'email.bounced':
        set = { status: 'bounced', failedAt: e.at, lastError: e.reason ?? 'Bounced' };
        break;
      case 'email.failed':
      case 'email.suppressed':
        set = { status: 'failed', failedAt: e.at, lastError: e.reason ?? e.type };
        break;
      case 'email.complained':
        set = { lastError: 'Recipient marked the message as spam' };
        break;
      default:
        set = null;
    }
    const rows = await tx
      .select({ id: schema.notifications.id, status: schema.notifications.status })
      .from(schema.notifications)
      .where(where);
    if (!rows.length) return false;
    if (set) {
      // A late "delivered" never overwrites a bounce or failure already recorded.
      const guard =
        e.type === 'email.delivered'
          ? and(where, sql`${schema.notifications.status} in ('sent', 'delivered')`)
          : where;
      await tx
        .update(schema.notifications)
        .set({ ...set, updatedAt: new Date() })
        .where(guard);
    }
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Reading (Activity)

/** Notifications for a document, visible to members who can view it. */
export async function listDocumentNotifications(tx: Tx, documentId: string) {
  return tx
    .select({
      id: schema.notifications.id,
      requestId: schema.notifications.requestId,
      template: schema.notifications.template,
      templateVersion: schema.notifications.templateVersion,
      audience: schema.notifications.audience,
      toName: schema.notifications.toName,
      toEmail: schema.notifications.toEmail,
      status: schema.notifications.status,
      attempts: schema.notifications.attempts,
      lastError: schema.notifications.lastError,
      providerMessageId: schema.notifications.providerMessageId,
      queuedAt: schema.notifications.queuedAt,
      sentAt: schema.notifications.sentAt,
      deliveredAt: schema.notifications.deliveredAt,
      failedAt: schema.notifications.failedAt,
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.documentId, documentId));
}
