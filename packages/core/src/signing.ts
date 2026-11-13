import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PDFDocument } from 'pdf-lib';
import { schema, withActor, withSigner, type Database, type ActorContext, type Tx } from '@st/db';
import { recordAudit } from './audit';
import { AppError } from './errors';
import { getConfigValue } from './config';
import {
  checkReadiness,
  documentSettingsSchema,
  signatureBlockSettings,
  type DocumentSettings,
  type FieldType,
  type RecipientRole,
} from './documents';
import type { ObjectStorage } from './storage';
import {
  GENESIS_HASH,
  eventHash,
  hashSecret,
  isPlausibleSecret,
  newOtp,
  newSecret,
  safeEqualHex,
  sanitizePng,
  sha256Hex,
  verifyChain,
} from './signing-crypto';
import { buildCertificate, buildSignedPdf } from './finalize-pdf';
import { validTimeZone } from './signature-block/layout';

/** Short public reference to a recipient's completion event: its sequence number and hash prefix. */
export function signingEventRef(
  events: { seq: number; type: string; recipientId: string | null; hash: string }[],
  recipientId: string,
): string | null {
  const e = events.findLast(
    (x) =>
      x.recipientId === recipientId &&
      ['recipient.signed', 'recipient.approved', 'recipient.reviewed'].includes(x.type),
  );
  return e ? `EV-${e.seq}-${e.hash.slice(0, 12).toUpperCase()}` : null;
}
import { consumeHold, reserveCredit, restoreOnCancel } from './billing';
import { enqueueCompletionNotifications } from './notifications';

type Meta = { ipAddress?: string | null; userAgent?: string | null };
type RequestRow = typeof schema.signingRequests.$inferSelect;
type RecipientRow = typeof schema.requestRecipients.$inferSelect;
export type RequestStatus = RequestRow['status'];

export const CLOSED_STATUSES: RequestStatus[] = ['completed', 'declined', 'expired', 'cancelled'];
const SIGNABLE_STATUSES: RequestStatus[] = ['sent', 'in_progress'];
/** Roles whose action is needed before a request completes, in signing order. */
const ACTING_ROLES: RecipientRole[] = ['signer', 'approver', 'reviewer'];
const SESSION_HOURS = 12;
const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS = 5;
const OTP_RESEND_SECONDS = 30;

/** A link to deliver: the raw token exists only here, in memory, on its way into an email. */
export interface Invitation {
  recipientId: string;
  name: string;
  email: string;
  token: string;
  kind: 'sign' | 'completed_copy';
}

// ---------------------------------------------------------------------------------------------
// Evidence log

async function appendEvent(
  tx: Tx,
  e: {
    requestId: string;
    workspaceId: string;
    recipientId?: string | null;
    actorUserId?: string | null;
    type: string;
    data?: Record<string, unknown>;
  } & Meta,
) {
  // Serialize writers per request so the chain has exactly one successor per event.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${e.requestId}, 0))`);
  const [last] = await tx
    .select({ hash: schema.signingEvents.hash })
    .from(schema.signingEvents)
    .where(eq(schema.signingEvents.requestId, e.requestId))
    .orderBy(desc(schema.signingEvents.seq))
    .limit(1);
  const prevHash = last?.hash ?? GENESIS_HASH;
  const ev = {
    requestId: e.requestId,
    recipientId: e.recipientId ?? null,
    actorUserId: e.actorUserId ?? null,
    type: e.type,
    data: e.data ?? {},
    ipAddress: e.ipAddress ?? null,
    userAgent: e.userAgent ?? null,
    createdAt: new Date(),
  };
  await tx
    .insert(schema.signingEvents)
    .values({ ...ev, workspaceId: e.workspaceId, prevHash, hash: eventHash(prevHash, ev) });
}

// ---------------------------------------------------------------------------------------------
// Sending

export interface SendOptions {
  /** Test requests are free and marked as tests. Live requests cost one credit. */
  mode: 'test' | 'live';
  testSigningEnabled: boolean;
  /** True only when both the production_signing and payments flags are on. */
  liveSendingEnabled?: boolean;
  /**
   * The sender confirmed the specialized-documents notice (`legal.specialized_documents`).
   * Required for live requests; recorded with the notice version and how it was given.
   */
  specializedAck?: { source: 'sender' | 'api' };
}

export interface SpecializedNotice {
  version: string;
  intro: string;
  categories: string[];
  confirm: string;
}

export async function getSpecializedNotice(db: Database): Promise<SpecializedNotice | null> {
  return getConfigValue<SpecializedNotice | null>(db, 'legal.specialized_documents', null);
}

export interface SendResult {
  requestId: string;
  invitations: Invitation[];
  /** `awaiting_payment` when a live request had no credit to use; nothing was emailed. */
  status: 'sent' | 'awaiting_payment';
}

const PAYABLE_STATUSES: RequestStatus[] = ['awaiting_payment', 'payment_processing'];

/**
 * Moves a request to sent: logs the send, issues link tokens to the first group and returns the
 * invitations to email. Runs inside the transaction that created the request or spent its credit.
 */
async function dispatch(tx: Tx, req: RequestRow, actorUserId: string, meta: Meta) {
  if (req.expiresAt && req.expiresAt.getTime() < Date.now())
    throw new AppError(
      'conflict',
      'The expiration date for this request has passed. Cancel it and send the document again.',
    );
  const recipients = await tx
    .select()
    .from(schema.requestRecipients)
    .where(eq(schema.requestRecipients.requestId, req.id))
    .orderBy(asc(schema.requestRecipients.signingOrder), asc(schema.requestRecipients.createdAt));
  const [{ n: fieldCount } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.requestFields)
    .where(eq(schema.requestFields.requestId, req.id));
  await tx
    .update(schema.signingRequests)
    .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.signingRequests.id, req.id));
  await appendEvent(tx, {
    requestId: req.id,
    workspaceId: req.workspaceId,
    actorUserId,
    type: 'request.sent',
    data: {
      test: req.isTest,
      sourceSha256: req.sourceSha256,
      recipients: recipients.length,
      fields: fieldCount,
      disclosureVersion: req.disclosureVersion,
    },
    ...meta,
  });
  const settings = documentSettingsSchema.parse(req.settings);
  const group = nextGroup(recipients, req.signingOrderEnabled);
  const invitations = await assignTokens(tx, group, await linkExpiry(tx, settings), 'sign');
  for (const inv of invitations) {
    await appendEvent(tx, {
      requestId: req.id,
      workspaceId: req.workspaceId,
      actorUserId,
      recipientId: inv.recipientId,
      type: 'recipient.notified',
      ...meta,
    });
  }
  return invitations;
}

function endOfDayUtc(date: string) {
  return new Date(`${date}T23:59:59.999Z`);
}

async function assignTokens(
  tx: Tx,
  recipients: RecipientRow[],
  expiresAt: Date,
  kind: Invitation['kind'],
): Promise<Invitation[]> {
  const out: Invitation[] = [];
  for (const r of recipients) {
    const token = newSecret();
    await tx
      .update(schema.requestRecipients)
      .set({
        tokenHash: hashSecret(token),
        tokenExpiresAt: expiresAt,
        sessionHash: null,
        sessionExpiresAt: null,
        ...(kind === 'sign' ? { status: 'notified' as const, notifiedAt: new Date() } : {}),
      })
      .where(eq(schema.requestRecipients.id, r.id));
    out.push({ recipientId: r.id, name: r.name, email: r.email, token, kind });
  }
  return out;
}

/** The next group that must act: everyone acting (any order) or the lowest unfinished order group. */
function nextGroup(recipients: RecipientRow[], orderEnabled: boolean): RecipientRow[] {
  const pending = recipients.filter((r) => ACTING_ROLES.includes(r.role) && r.status !== 'signed');
  if (!orderEnabled) return pending.filter((r) => r.status === 'waiting');
  const minOrder = Math.min(...pending.map((r) => r.signingOrder));
  return pending.filter((r) => r.signingOrder === minOrder && r.status === 'waiting');
}

async function linkExpiry(db: Database | Tx, settings: DocumentSettings) {
  if (settings.expiresAt) return endOfDayUtc(settings.expiresAt);
  const days = await getConfigValue(db as Database, 'signing.link_valid_days', 30);
  return new Date(Date.now() + days * 86_400_000);
}

export async function sendForSignature(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  documentId: string,
  opts: SendOptions,
  meta: Meta = {},
): Promise<SendResult> {
  const live = opts.mode === 'live';
  if (live && !opts.liveSendingEnabled)
    throw new AppError(
      'forbidden',
      'Sending real signing requests is switched off until security and legal reviews are complete.',
    );
  if (!live && !opts.testSigningEnabled)
    throw new AppError('forbidden', 'Test signing is not available in this environment.');
  if (!z.string().uuid().safeParse(documentId).success)
    throw new AppError('not_found', 'Document not found');

  const disclosure = await getConfigValue<{ version: string; text: string } | null>(
    db,
    'legal.esign_disclosure',
    null,
  );
  if (!disclosure?.text) throw new Error('legal.esign_disclosure is not configured');
  const notice = await getSpecializedNotice(db);
  if (live && notice && !opts.specializedAck)
    throw new AppError(
      'invalid',
      'Confirm that this document is not one that needs extra formalities, such as a will or a notarized deed.',
    );
  const maxSigners = await getConfigValue(db, 'limits.max_signers_per_request', 5);

  return withActor(db, actor, async (tx) => {
    const [doc] = (await tx.execute(
      sql`select * from documents where id = ${documentId}::uuid and deleted_at is null`,
    )) as unknown as {
      id: string;
      workspace_id: string;
      title: string;
      status: string;
      signing_order_enabled: boolean;
      settings: unknown;
      email_message: string | null;
    }[];
    if (!doc) throw new AppError('not_found', 'Document not found');
    const [canSend] = (await tx.execute(
      sql`select st_can_send_document(${documentId}::uuid) as ok`,
    )) as unknown as { ok: boolean }[];
    if (!canSend?.ok)
      throw new AppError('forbidden', 'Your role does not allow sending documents.');
    if (doc.status !== 'ready_to_send')
      throw new AppError('conflict', 'Mark the document ready to send first.');
    const [open] = await tx
      .select({ id: schema.signingRequests.id })
      .from(schema.signingRequests)
      .where(
        and(
          eq(schema.signingRequests.documentId, documentId),
          sql`${schema.signingRequests.status} not in ('completed','declined','expired','cancelled')`,
        ),
      );
    if (open) throw new AppError('conflict', 'This document already has an open signing request.');

    const [file] = await tx
      .select()
      .from(schema.documentFiles)
      .where(
        and(
          eq(schema.documentFiles.documentId, documentId),
          eq(schema.documentFiles.kind, 'original'),
        ),
      )
      .orderBy(desc(schema.documentFiles.version))
      .limit(1);
    const recipients = await tx
      .select()
      .from(schema.documentRecipients)
      .where(eq(schema.documentRecipients.documentId, documentId))
      .orderBy(
        asc(schema.documentRecipients.signingOrder),
        asc(schema.documentRecipients.createdAt),
      );
    const fields = await tx
      .select()
      .from(schema.documentFields)
      .where(eq(schema.documentFields.documentId, documentId));
    const settings = documentSettingsSchema.parse(doc.settings ?? {});
    const issues = checkReadiness({ file: file ?? null, recipients, fields, settings });
    if (issues.length) throw new AppError('invalid', issues[0]!.message);
    if (recipients.filter((r) => r.role === 'signer').length > maxSigners) {
      throw new AppError('invalid', `A signing request includes up to ${maxSigners} signers.`);
    }
    // The version being sent must be exactly the one that was uploaded.
    const bytes = await storage.get(file!.storageKey);
    if (sha256Hex(bytes) !== file!.sha256)
      throw new Error(`Integrity check failed for document ${documentId}`);

    const [sender] = await tx
      .select({ name: schema.user.name, email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, actor.userId));
    const [ws] = await tx
      .select({ name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, doc.workspace_id));
    const expiresAt = settings.expiresAt ? endOfDayUtc(settings.expiresAt) : null;
    // Signing times on the document are shown in this zone. Fixed at send so it cannot change later.
    const [profile] = settings.timeZone
      ? []
      : await tx
          .select({ timezone: schema.userProfiles.timezone })
          .from(schema.userProfiles)
          .where(eq(schema.userProfiles.userId, actor.userId));
    const requestSettings = {
      ...settings,
      timeZone: settings.timeZone ?? validTimeZone(profile?.timezone),
    };

    const [req] = await tx
      .insert(schema.signingRequests)
      .values({
        workspaceId: doc.workspace_id,
        documentId,
        status: 'awaiting_payment',
        isTest: !live,
        title: doc.title,
        sentBy: actor.userId,
        senderName: sender?.name ?? 'Signature Tender user',
        senderEmail: sender?.email ?? '',
        workspaceName: ws?.name ?? '',
        sourceFileId: file!.id,
        sourceSha256: file!.sha256,
        signingOrderEnabled: doc.signing_order_enabled,
        settings: requestSettings,
        emailMessage: doc.email_message,
        disclosureVersion: disclosure.version,
        disclosureText: disclosure.text,
        expiresAt,
      })
      .returning();
    const requestId = req!.id;

    const idMap = new Map<string, string>();
    const inserted: RecipientRow[] = [];
    for (const r of recipients) {
      const [row] = await tx
        .insert(schema.requestRecipients)
        .values({
          workspaceId: doc.workspace_id,
          requestId,
          name: r.name,
          email: r.email,
          role: r.role,
          signingOrder: doc.signing_order_enabled ? r.signingOrder : 1,
          // A document-level "require code" setting upgrades every acting recipient.
          authMethod:
            settings.requireSignerAuth && ACTING_ROLES.includes(r.role)
              ? 'email_code'
              : r.authMethod,
          colorIndex: r.colorIndex,
        })
        .returning();
      idMap.set(r.id, row!.id);
      inserted.push(row!);
    }
    // Mark matching address book entries as recently used (never grants them anything).
    await tx.execute(
      sql`select st_touch_contacts(${doc.workspace_id}::uuid,
        array(select lower(jsonb_array_elements_text(${JSON.stringify(recipients.map((r) => r.email))}::jsonb))))`,
    );
    if (fields.length) {
      await tx.insert(schema.requestFields).values(
        fields.map((f) => ({
          workspaceId: doc.workspace_id,
          requestId,
          recipientId: idMap.get(f.recipientId)!,
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          required: f.required,
          label: f.label,
          options: f.options,
        })),
      );
    }
    if (notice && opts.specializedAck)
      await appendEvent(tx, {
        requestId,
        workspaceId: doc.workspace_id,
        actorUserId: actor.userId,
        type: 'request.specialized_notice_confirmed',
        data: { version: notice.version, source: opts.specializedAck.source },
        ...meta,
      });
    let invitations: Invitation[] = [];
    let status: SendResult['status'] = 'sent';
    if (!live) {
      invitations = await dispatch(tx, req!, actor.userId, meta);
    } else {
      await appendEvent(tx, {
        requestId,
        workspaceId: doc.workspace_id,
        actorUserId: actor.userId,
        type: 'request.created',
        data: { sourceSha256: file!.sha256, recipients: inserted.length, fields: fields.length },
        ...meta,
      });
      const bucket = await reserveCredit(tx, {
        workspaceId: doc.workspace_id,
        requestId,
        userId: actor.userId,
      });
      if (bucket) {
        invitations = await dispatch(tx, req!, actor.userId, meta);
        await consumeHold(tx, requestId);
      } else {
        status = 'awaiting_payment';
        await appendEvent(tx, {
          requestId,
          workspaceId: doc.workspace_id,
          actorUserId: actor.userId,
          type: 'request.awaiting_payment',
          ...meta,
        });
      }
    }
    await recordAudit(tx, {
      workspaceId: doc.workspace_id,
      actorUserId: actor.userId,
      action: status === 'sent' ? 'document.sent' : 'document.awaiting_payment',
      targetType: 'document',
      targetId: documentId,
      metadata: { requestId, test: !live },
      ...meta,
    });
    return { requestId, invitations, status };
  });
}

/**
 * Sends a request that was waiting for payment, spending one credit. Used after Stripe confirms a
 * payment (acting as the request's sender) and by "Use a credit and send". If no credit is
 * available nothing changes and the request keeps waiting.
 */
export async function sendPaidRequest(
  db: Database,
  actor: ActorContext,
  requestId: string,
  opts: { liveSendingEnabled: boolean },
  meta: Meta = {},
): Promise<{
  requestId: string;
  workspaceId: string;
  documentId: string;
  title: string;
  senderName: string;
  workspaceName: string;
  emailMessage: string | null;
  invitations: Invitation[];
}> {
  if (!opts.liveSendingEnabled)
    throw new AppError(
      'forbidden',
      'Sending real signing requests is switched off until security and legal reviews are complete.',
    );
  if (!z.string().uuid().safeParse(requestId).success)
    throw new AppError('not_found', 'Request not found');
  return withActor(db, actor, async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId))
      .for('update');
    if (!req) throw new AppError('not_found', 'Request not found');
    if (!PAYABLE_STATUSES.includes(req.status))
      throw new AppError('conflict', 'This request is not waiting for payment.');
    const [canSend] = (await tx.execute(
      sql`select st_can_send_request(${requestId}::uuid) as ok`,
    )) as unknown as { ok: boolean }[];
    if (!canSend?.ok)
      throw new AppError('forbidden', 'Your role does not allow sending this document.');
    const bucket = await reserveCredit(tx, {
      workspaceId: req.workspaceId,
      requestId,
      userId: actor.userId,
    });
    if (!bucket)
      throw new AppError(
        'conflict',
        'There are no credits available. Buy credits or pay for this request.',
      );
    const invitations = await dispatch(tx, req, actor.userId, meta);
    await consumeHold(tx, requestId);
    await recordAudit(tx, {
      workspaceId: req.workspaceId,
      actorUserId: actor.userId,
      action: 'document.sent',
      targetType: 'document',
      targetId: req.documentId,
      metadata: { requestId, test: false, credit: bucket },
      ...meta,
    });
    return {
      requestId,
      workspaceId: req.workspaceId,
      documentId: req.documentId,
      title: req.title,
      senderName: req.senderName,
      workspaceName: req.workspaceName,
      emailMessage: req.emailMessage,
      invitations,
    };
  });
}

export async function cancelRequest(
  db: Database,
  actor: ActorContext,
  requestId: string,
  reason: string,
  meta: Meta = {},
) {
  const why = z.string().trim().max(500).parse(reason);
  await withActor(db, actor, async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId))
      .for('update');
    if (!req) throw new AppError('not_found', 'Request not found');
    if (CLOSED_STATUSES.includes(req.status))
      throw new AppError('conflict', 'This request is already closed.');
    const res = await tx
      .update(schema.signingRequests)
      .set({
        status: 'cancelled',
        closedAt: new Date(),
        closedReason: why || null,
        updatedAt: new Date(),
      })
      .where(eq(schema.signingRequests.id, requestId))
      .returning({ id: schema.signingRequests.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow cancelling this request.');
    await tx
      .update(schema.requestRecipients)
      .set({ tokenHash: null, sessionHash: null })
      .where(eq(schema.requestRecipients.requestId, requestId));
    const creditRestored = req.isTest ? false : await restoreOnCancel(tx, requestId, actor.userId);
    await appendEvent(tx, {
      requestId,
      workspaceId: req.workspaceId,
      actorUserId: actor.userId,
      type: 'request.cancelled',
      data: { reason: why || null, creditRestored },
      ...meta,
    });
    await recordAudit(tx, {
      workspaceId: req.workspaceId,
      actorUserId: actor.userId,
      action: 'document.request_cancelled',
      targetType: 'document',
      targetId: req.documentId,
      metadata: { requestId },
      ...meta,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Sender views

export async function getRequestsForDocument(
  db: Database,
  actor: ActorContext,
  documentId: string,
) {
  if (!z.string().uuid().safeParse(documentId).success) return [];
  return withActor(db, actor, async (tx) => {
    const reqs = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.documentId, documentId))
      .orderBy(desc(schema.signingRequests.createdAt));
    if (!reqs.length) return [];
    const ids = reqs.map((r) => r.id);
    const recips = await tx
      .select()
      .from(schema.requestRecipients)
      .where(inArray(schema.requestRecipients.requestId, ids))
      .orderBy(asc(schema.requestRecipients.signingOrder), asc(schema.requestRecipients.createdAt));
    const events = await tx
      .select()
      .from(schema.signingEvents)
      .where(inArray(schema.signingEvents.requestId, ids))
      .orderBy(asc(schema.signingEvents.seq));
    return reqs.map((r) => ({
      request: { ...r, settings: documentSettingsSchema.parse(r.settings) },
      recipients: recips
        .filter((x) => x.requestId === r.id)
        .map(({ tokenHash: _t, sessionHash: _s, otpHash: _o, ...rest }) => rest),
      events: events.filter((e) => e.requestId === r.id),
    }));
  });
}

export async function hasOpenRequest(tx: Tx, documentId: string) {
  const [open] = await tx
    .select({ id: schema.signingRequests.id })
    .from(schema.signingRequests)
    .where(
      and(
        eq(schema.signingRequests.documentId, documentId),
        sql`${schema.signingRequests.status} not in ('completed','declined','expired','cancelled')`,
      ),
    );
  return Boolean(open);
}

/** Re-hashes the stored files and recomputes the evidence chain for a request. */
export async function verifyRequestIntegrity(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  requestId: string,
) {
  const data = await withActor(db, actor, async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (!req) throw new AppError('not_found', 'Request not found');
    const fileIds = [req.sourceFileId, req.signedFileId, req.certificateFileId].filter(
      (x): x is string => Boolean(x),
    );
    const files = await tx
      .select()
      .from(schema.documentFiles)
      .where(inArray(schema.documentFiles.id, fileIds));
    const events = await tx
      .select()
      .from(schema.signingEvents)
      .where(eq(schema.signingEvents.requestId, requestId))
      .orderBy(asc(schema.signingEvents.seq));
    return { req, files, events };
  });
  const check = async (id: string | null) => {
    if (!id) return null;
    const f = data.files.find((x) => x.id === id);
    if (!f) return { ok: false, sha256: null };
    try {
      return { ok: sha256Hex(await storage.get(f.storageKey)) === f.sha256, sha256: f.sha256 };
    } catch {
      return { ok: false, sha256: f.sha256 };
    }
  };
  const brokenAt = verifyChain(data.events);
  return {
    original: await check(data.req.sourceFileId),
    signed: await check(data.req.signedFileId),
    certificate: await check(data.req.certificateFileId),
    chain: {
      ok: brokenAt === -1,
      events: data.events.length,
      brokenAt: brokenAt === -1 ? null : brokenAt,
    },
  };
}

export async function readRequestFile(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  requestId: string,
  kind: 'signed' | 'certificate',
  meta: Meta = {},
) {
  const { file, req } = await withActor(db, actor, async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (!req) throw new AppError('not_found', 'Request not found');
    const id = kind === 'signed' ? req.signedFileId : req.certificateFileId;
    if (!id || req.status !== 'completed')
      throw new AppError('not_found', 'The completed file is not available yet.');
    const [file] = await tx
      .select()
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.id, id));
    if (!file) throw new AppError('not_found', 'File not found');
    return { file, req };
  });
  const bytes = await storage.get(file.storageKey);
  if (sha256Hex(bytes) !== file.sha256)
    throw new Error(`Integrity check failed for file ${file.id}`);
  await withActor(db, actor, (tx) =>
    recordAudit(tx, {
      workspaceId: req.workspaceId,
      actorUserId: actor.userId,
      action: 'document.file_downloaded',
      targetType: 'document',
      targetId: req.documentId,
      metadata: { requestId, kind },
      ...meta,
    }),
  );
  return { bytes, filename: file.originalFilename };
}

// ---------------------------------------------------------------------------------------------
// Recipient (signer) side

function tokenHashOf(token: string) {
  if (!isPlausibleSecret(token)) throw new AppError('not_found', 'This link is not valid.');
  return hashSecret(token);
}

async function loadSigner(tx: Tx) {
  const [me] = (await tx.execute(sql`select st_current_signer() as id`)) as unknown as {
    id: string | null;
  }[];
  if (!me?.id) throw new AppError('not_found', 'This link is not valid or has expired.');
  const [recipient] = await tx
    .select()
    .from(schema.requestRecipients)
    .where(eq(schema.requestRecipients.id, me.id))
    .for('update');
  const [request] = await tx
    .select()
    .from(schema.signingRequests)
    .where(eq(schema.signingRequests.id, recipient!.requestId))
    .for('update');
  return { recipient: recipient!, request: request! };
}

async function expireIfDue(tx: Tx, request: RequestRow) {
  if (
    request.expiresAt &&
    request.expiresAt <= new Date() &&
    !CLOSED_STATUSES.includes(request.status)
  ) {
    await tx
      .update(schema.signingRequests)
      .set({ status: 'expired', closedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.signingRequests.id, request.id));
    await appendEvent(tx, {
      requestId: request.id,
      workspaceId: request.workspaceId,
      type: 'request.expired',
    });
    return { ...request, status: 'expired' as const };
  }
  return request;
}

function sessionValid(r: RecipientRow, session: string | undefined) {
  if (!session || !r.sessionHash || !r.sessionExpiresAt || r.sessionExpiresAt <= new Date())
    return false;
  return safeEqualHex(hashSecret(session), r.sessionHash);
}

export type SignerStage =
  | 'start'
  | 'verify'
  | 'consent'
  | 'sign'
  | 'waiting_turn'
  | 'signed_waiting'
  | 'completed'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'unavailable';

export interface SignerView {
  stage: SignerStage;
  /** Used only to look up public workspace branding. */
  workspaceId: string;
  title: string;
  senderName: string;
  senderEmail: string;
  workspaceName: string;
  sentAt: Date | null;
  /** Pages in the document as sent. */
  pageCount: number | null;
  recipient: { id: string; name: string; email: string; role: RecipientRole; authMethod: string };
  isTest: boolean;
  expiresAt: Date | null;
  emailMessage: string | null;
  allowDownload: boolean;
  allowPrint: boolean;
  disclosure: { version: string; text: string };
  canDownloadSigned: boolean;
  /** When this recipient completed their part, if they have. */
  signedAt: Date | null;
  /** Every acting recipient has completed. The signed copy may still be in preparation. */
  allPartiesDone: boolean;
}

function stageFor(request: RequestRow, r: RecipientRow, session: string | undefined): SignerStage {
  if (request.status === 'completed') return 'completed';
  if (request.status === 'declined') return 'declined';
  if (request.status === 'expired') return 'expired';
  if (request.status === 'cancelled') return 'cancelled';
  if (!ACTING_ROLES.includes(r.role)) return 'unavailable';
  if (r.status === 'signed') return 'signed_waiting';
  if (!SIGNABLE_STATUSES.includes(request.status)) return 'unavailable';
  // In sequential signing a later recipient is only invited when their group's turn starts.
  if (r.status === 'waiting') return 'waiting_turn';
  if (!sessionValid(r, session))
    return r.authMethod === 'email_code' && r.otpHash ? 'verify' : 'start';
  if (!r.consentedAt) return 'consent';
  return 'sign';
}

function toView(
  request: RequestRow,
  r: RecipientRow,
  stage: SignerStage,
  pageCount: number | null = null,
  allPartiesDone = false,
): SignerView {
  const settings = documentSettingsSchema.parse(request.settings);
  return {
    stage,
    workspaceId: request.workspaceId,
    title: request.title,
    senderName: request.senderName,
    senderEmail: request.senderEmail,
    workspaceName: request.workspaceName,
    sentAt: request.sentAt,
    pageCount,
    recipient: { id: r.id, name: r.name, email: r.email, role: r.role, authMethod: r.authMethod },
    isTest: request.isTest,
    expiresAt: request.expiresAt,
    emailMessage: request.emailMessage,
    allowDownload: settings.allowDownload,
    allowPrint: settings.allowPrint,
    disclosure: { version: request.disclosureVersion, text: request.disclosureText },
    canDownloadSigned:
      request.status === 'completed' && settings.allowDownload && Boolean(request.signedFileId),
    signedAt: r.signedAt,
    allPartiesDone: request.status === 'completed' || allPartiesDone,
  };
}

/** Resolves a link token to what the recipient may see now. Records the first view. */
export async function getSignerView(
  db: Database,
  token: string,
  session: string | undefined,
  meta: Meta = {},
): Promise<SignerView> {
  return withSigner(db, tokenHashOf(token), async (tx) => {
    const { recipient, request: loaded } = await loadSigner(tx);
    const request = await expireIfDue(tx, loaded);
    if (!recipient.viewedAt && SIGNABLE_STATUSES.includes(request.status)) {
      await tx
        .update(schema.requestRecipients)
        .set({
          viewedAt: new Date(),
          status: recipient.status === 'notified' ? 'viewed' : recipient.status,
        })
        .where(eq(schema.requestRecipients.id, recipient.id));
      await appendEvent(tx, {
        requestId: request.id,
        workspaceId: request.workspaceId,
        recipientId: recipient.id,
        type: 'recipient.viewed',
        ...meta,
      });
      if (request.status === 'sent')
        await tx
          .update(schema.signingRequests)
          .set({ status: 'in_progress', updatedAt: new Date() })
          .where(eq(schema.signingRequests.id, request.id));
    }
    const [file] = await tx
      .select({ pageCount: schema.documentFiles.pageCount })
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.id, request.sourceFileId));
    const stage = stageFor(request, recipient, session);
    let allDone = false;
    if (stage === 'signed_waiting') {
      const all = await tx
        .select({ role: schema.requestRecipients.role, status: schema.requestRecipients.status })
        .from(schema.requestRecipients)
        .where(eq(schema.requestRecipients.requestId, request.id));
      allDone = all
        .filter((x) => ACTING_ROLES.includes(x.role))
        .every((x) => x.status === 'signed');
    }
    return toView(request, recipient, stage, file?.pageCount, allDone);
  });
}

/**
 * Starts a browser session for a recipient. Without code verification it is issued at once; with it,
 * a one-time code is generated and must be emailed by the caller. Returns the session secret or code.
 */
export async function startSigning(
  db: Database,
  token: string,
  meta: Meta = {},
): Promise<{ session: string } | { code: string; email: string; name: string }> {
  return withSigner(db, tokenHashOf(token), async (tx) => {
    const { recipient, request: loaded } = await loadSigner(tx);
    const request = await expireIfDue(tx, loaded);
    if (
      !SIGNABLE_STATUSES.includes(request.status) ||
      !ACTING_ROLES.includes(recipient.role) ||
      recipient.status === 'signed' ||
      recipient.status === 'waiting'
    ) {
      throw new AppError('conflict', 'This request is no longer waiting for you.');
    }
    if (recipient.authMethod === 'email_code') {
      const now = Date.now();
      if (recipient.otpSentCount >= OTP_MAX_SENDS)
        throw new AppError(
          'forbidden',
          'Too many codes were requested. Contact the sender for a new link.',
        );
      if (
        recipient.otpLastSentAt &&
        now - recipient.otpLastSentAt.getTime() < OTP_RESEND_SECONDS * 1000
      ) {
        throw new AppError(
          'conflict',
          `Please wait ${OTP_RESEND_SECONDS} seconds before requesting another code.`,
        );
      }
      const code = newOtp();
      await tx
        .update(schema.requestRecipients)
        .set({
          otpHash: hashSecret(`${recipient.id}:${code}`),
          otpExpiresAt: new Date(now + OTP_MINUTES * 60_000),
          otpAttempts: 0,
          otpSentCount: recipient.otpSentCount + 1,
          otpLastSentAt: new Date(now),
        })
        .where(eq(schema.requestRecipients.id, recipient.id));
      await appendEvent(tx, {
        requestId: request.id,
        workspaceId: request.workspaceId,
        recipientId: recipient.id,
        type: 'recipient.code_sent',
        ...meta,
      });
      return { code, email: recipient.email, name: recipient.name };
    }
    const session = newSecret();
    await tx
      .update(schema.requestRecipients)
      .set({
        sessionHash: hashSecret(session),
        sessionExpiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000),
      })
      .where(eq(schema.requestRecipients.id, recipient.id));
    await appendEvent(tx, {
      requestId: request.id,
      workspaceId: request.workspaceId,
      recipientId: recipient.id,
      type: 'recipient.session_started',
      data: { method: 'email_link' },
      ...meta,
    });
    return { session };
  });
}

export async function verifySigningCode(
  db: Database,
  token: string,
  code: string,
  meta: Meta = {},
): Promise<{ session: string }> {
  const clean = code.replace(/\s+/g, '');
  return withSigner(db, tokenHashOf(token), async (tx) => {
    const { recipient, request } = await loadSigner(tx);
    if (!SIGNABLE_STATUSES.includes(request.status))
      throw new AppError('conflict', 'This request is no longer waiting for you.');
    if (!recipient.otpHash || !recipient.otpExpiresAt)
      throw new AppError('invalid', 'Request a new code to continue.');
    if (recipient.otpExpiresAt <= new Date())
      throw new AppError('invalid', 'This code has expired. Request a new one.');
    if (recipient.otpAttempts >= OTP_MAX_ATTEMPTS)
      throw new AppError('forbidden', 'Too many incorrect attempts. Request a new code.');
    const ok =
      /^\d{6}$/.test(clean) &&
      safeEqualHex(hashSecret(`${recipient.id}:${clean}`), recipient.otpHash);
    if (!ok) {
      const attempts = recipient.otpAttempts + 1;
      await tx
        .update(schema.requestRecipients)
        .set({ otpAttempts: attempts, ...(attempts >= OTP_MAX_ATTEMPTS ? { otpHash: null } : {}) })
        .where(eq(schema.requestRecipients.id, recipient.id));
      await appendEvent(tx, {
        requestId: request.id,
        workspaceId: request.workspaceId,
        recipientId: recipient.id,
        type: 'recipient.code_failed',
        data: { attempt: attempts },
        ...meta,
      });
      return { failed: true as const, left: OTP_MAX_ATTEMPTS - attempts };
    }
    const session = newSecret();
    await tx
      .update(schema.requestRecipients)
      .set({
        otpHash: null, // single use
        otpExpiresAt: null,
        authenticatedAt: new Date(),
        sessionHash: hashSecret(session),
        sessionExpiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000),
      })
      .where(eq(schema.requestRecipients.id, recipient.id));
    await appendEvent(tx, {
      requestId: request.id,
      workspaceId: request.workspaceId,
      recipientId: recipient.id,
      type: 'recipient.code_verified',
      ...meta,
    });
    return { session };
  }).then((r) => {
    // The failed attempt must be committed, so the error is raised after the transaction.
    if ('failed' in r && r.left !== undefined)
      throw new AppError(
        'invalid',
        r.left > 0
          ? `That code is not correct. ${r.left} ${r.left === 1 ? 'attempt' : 'attempts'} left.`
          : 'Too many incorrect attempts. Request a new code.',
      );
    return r;
  });
}

async function requireSession(tx: Tx, session: string | undefined) {
  const ctx = await loadSigner(tx);
  const request = await expireIfDue(tx, ctx.request);
  if (!SIGNABLE_STATUSES.includes(request.status))
    throw new AppError('conflict', 'This request is no longer open for signing.');
  if (!ACTING_ROLES.includes(ctx.recipient.role) || ctx.recipient.status === 'signed')
    throw new AppError('conflict', 'This request is no longer waiting for you.');
  if (ctx.recipient.status === 'waiting')
    throw new AppError('conflict', "It's not your turn to sign yet.");
  if (!sessionValid(ctx.recipient, session))
    throw new AppError(
      'unauthenticated',
      'Your signing session has ended. Open the link again to continue.',
    );
  return { recipient: ctx.recipient, request };
}

export async function giveConsent(
  db: Database,
  token: string,
  session: string | undefined,
  input: { disclosureVersion: string; agree: boolean },
  meta: Meta = {},
) {
  if (!input.agree)
    throw new AppError(
      'invalid',
      'You need to agree to continue electronically, or decline to sign.',
    );
  await withSigner(db, tokenHashOf(token), async (tx) => {
    const { recipient, request } = await requireSession(tx, session);
    if (input.disclosureVersion !== request.disclosureVersion)
      throw new AppError('conflict', 'The disclosure was updated. Please review it again.');
    if (recipient.consentedAt) return;
    await tx
      .update(schema.requestRecipients)
      .set({ consentedAt: new Date() })
      .where(eq(schema.requestRecipients.id, recipient.id));
    await appendEvent(tx, {
      requestId: request.id,
      workspaceId: request.workspaceId,
      recipientId: recipient.id,
      type: 'recipient.consented',
      data: {
        disclosureVersion: request.disclosureVersion,
        disclosureSha256: sha256Hex(request.disclosureText),
      },
      ...meta,
    });
  });
}

const PNG_DATA_URL = (png: Uint8Array) =>
  `data:image/png;base64,${Buffer.from(png).toString('base64')}`;

/** Recipient-side progress events, newest first. */
async function progressEvents(tx: Tx, requestId: string, recipientId: string) {
  return tx
    .select({ type: schema.signingEvents.type, data: schema.signingEvents.data })
    .from(schema.signingEvents)
    .where(
      and(
        eq(schema.signingEvents.requestId, requestId),
        eq(schema.signingEvents.recipientId, recipientId),
        inArray(schema.signingEvents.type, ['recipient.progress_saved', 'recipient.resumed']),
      ),
    )
    .orderBy(desc(schema.signingEvents.seq))
    .limit(5);
}

/**
 * Everything the signing workspace needs: this recipient's fields with any saved progress, the
 * marks they adopted, other recipients' completed fields (read-only), and the frozen version.
 * Opening it after a Save & Exit records that signing resumed.
 */
export async function getSigningWorkspace(
  db: Database,
  token: string,
  session: string | undefined,
  meta: Meta = {},
) {
  return withSigner(db, tokenHashOf(token), async (tx) => {
    const { recipient, request } = await requireSession(tx, session);
    if (!recipient.consentedAt)
      throw new AppError('conflict', 'Agree to sign electronically first.');
    const all = await tx
      .select()
      .from(schema.requestFields)
      .where(eq(schema.requestFields.requestId, request.id))
      .orderBy(
        asc(schema.requestFields.page),
        asc(schema.requestFields.y),
        asc(schema.requestFields.x),
      );
    const fields = all.filter((f) => f.recipientId === recipient.id);
    const people = await tx
      .select({
        id: schema.requestRecipients.id,
        name: schema.requestRecipients.name,
        role: schema.requestRecipients.role,
        status: schema.requestRecipients.status,
        signedAt: schema.requestRecipients.signedAt,
      })
      .from(schema.requestRecipients)
      .where(eq(schema.requestRecipients.requestId, request.id));
    const finished = new Set(people.filter((p) => p.status === 'signed').map((p) => p.id));
    // Other recipients' fields are shown only once that recipient has completed their part.
    const others = all.filter((f) => f.recipientId !== recipient.id && finished.has(f.recipientId));
    const sigs = await tx
      .select({
        id: schema.signatures.id,
        recipientId: schema.signatures.recipientId,
        kind: schema.signatures.kind,
        method: schema.signatures.method,
        imagePng: schema.signatures.imagePng,
      })
      .from(schema.signatures)
      .where(eq(schema.signatures.requestId, request.id))
      .orderBy(desc(schema.signatures.adoptedAt));
    const sigById = new Map(sigs.map((x) => [x.id, x]));
    const [file] = await tx
      .select({ pageCount: schema.documentFiles.pageCount })
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.id, request.sourceFileId));

    const events = await progressEvents(tx, request.id, recipient.id);
    const lastSave = events.find((e) => e.type === 'recipient.progress_saved');
    const resumePage = Number((lastSave?.data as { page?: unknown } | undefined)?.page) || 1;
    const latest = events[0];
    if (latest?.type === 'recipient.progress_saved' && (latest.data as { exit?: boolean }).exit) {
      await appendEvent(tx, {
        requestId: request.id,
        workspaceId: request.workspaceId,
        recipientId: recipient.id,
        type: 'recipient.resumed',
        data: { sourceSha256: request.sourceSha256 },
        ...meta,
      });
    }
    const settings = documentSettingsSchema.parse(request.settings);
    const mine = sigs.filter((x) => x.recipientId === recipient.id);
    return {
      requestId: request.id,
      documentId: request.documentId,
      /** The frozen version: the SHA-256 of the exact PDF that was sent. */
      documentVersion: request.sourceSha256,
      sentAt: request.sentAt ?? request.createdAt,
      pageCount: file?.pageCount ?? 0,
      allowDownload: settings.allowDownload,
      /** How signature fields are drawn (the sender's signature block choice) and in which zone. */
      signatureBlock: signatureBlockSettings(request.settings),
      role: recipient.role,
      name: recipient.name,
      email: recipient.email,
      resumePage: Math.min(Math.max(1, resumePage), Math.max(1, file?.pageCount ?? 1)),
      fields: fields.map((f) => ({
        id: f.id,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        required: f.required,
        label: f.label,
        options: f.options,
        savedValue: f.value,
        savedSignatureId:
          f.signatureId && sigById.get(f.signatureId)?.recipientId === recipient.id
            ? f.signatureId
            : null,
      })),
      completedByOthers: others.map((f) => {
        const sig = f.signatureId ? sigById.get(f.signatureId) : undefined;
        return {
          id: f.id,
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          label: f.label,
          value: f.value,
          dataUrl: sig ? PNG_DATA_URL(sig.imagePng) : null,
          recipientName: people.find((p) => p.id === f.recipientId)?.name ?? '',
          recipientRole: people.find((p) => p.id === f.recipientId)?.role ?? null,
          signedAt: people.find((p) => p.id === f.recipientId)?.signedAt?.toISOString() ?? null,
        };
      }),
      signatures: mine.map((x) => ({
        id: x.id,
        kind: x.kind,
        method: x.method,
        dataUrl: PNG_DATA_URL(x.imagePng),
      })),
    };
  });
}

const draftSchema = z.object({
  values: z
    .array(
      z.object({
        fieldId: z.string().uuid(),
        value: z.string().max(500).nullable().optional(),
        signatureId: z.string().uuid().nullable().optional(),
      }),
    )
    .max(500),
  page: z.number().int().min(1).max(10_000).optional(),
  /** Save & Exit: also ends this browser session, so resuming needs the link (and code) again. */
  exit: z.boolean().optional(),
});

/**
 * Saves work in progress without signing: field values and applied marks are stored as drafts
 * (filled_at stays empty) and checked again in full at completion. Only this recipient's fields
 * and marks are accepted.
 */
export async function saveSigningProgress(
  db: Database,
  token: string,
  session: string | undefined,
  input: z.input<typeof draftSchema>,
  meta: Meta = {},
) {
  const data = draftSchema.parse(input);
  return withSigner(db, tokenHashOf(token), async (tx) => {
    const { recipient, request } = await requireSession(tx, session);
    if (!recipient.consentedAt)
      throw new AppError('conflict', 'Agree to sign electronically first.');
    const fields = await tx
      .select()
      .from(schema.requestFields)
      .where(eq(schema.requestFields.recipientId, recipient.id));
    const sigs = await tx
      .select({ id: schema.signatures.id, kind: schema.signatures.kind })
      .from(schema.signatures)
      .where(eq(schema.signatures.recipientId, recipient.id));
    let saved = 0;
    for (const v of data.values) {
      const f = fields.find((x) => x.id === v.fieldId);
      if (!f) throw new AppError('forbidden', 'A value was sent for a field that is not yours.');
      if (f.type === 'date_signed') continue; // always set by the server at completion
      let value: string | null = null;
      let signatureId: string | null = null;
      if (f.type === 'signature' || f.type === 'initials') {
        if (v.signatureId) {
          if (!sigs.some((x) => x.id === v.signatureId && x.kind === f.type))
            throw new AppError('invalid', `Adopt your ${f.type} before applying it.`);
          signatureId = v.signatureId;
        }
      } else {
        value = (v.value ?? '').trim() || null;
      }
      if (value === f.value && signatureId === f.signatureId) continue;
      await tx
        .update(schema.requestFields)
        .set({ value, signatureId, filledAt: null })
        .where(eq(schema.requestFields.id, f.id));
      saved++;
    }
    const now = new Date();
    if (data.exit) {
      await tx
        .update(schema.requestRecipients)
        .set({ sessionHash: null, sessionExpiresAt: null })
        .where(eq(schema.requestRecipients.id, recipient.id));
    }
    if (data.exit || saved > 0) {
      await appendEvent(tx, {
        requestId: request.id,
        workspaceId: request.workspaceId,
        recipientId: recipient.id,
        type: 'recipient.progress_saved',
        data: {
          page: data.page ?? null,
          exit: Boolean(data.exit),
          changedFields: saved,
          sourceSha256: request.sourceSha256,
        },
        ...meta,
      });
    }
    return { savedAt: now, changed: saved };
  });
}

/** Returns the exact source PDF the request was sent with, after checking its hash. */
export async function readSignerSourceFile(
  db: Database,
  storage: ObjectStorage,
  token: string,
  session: string | undefined,
  opts: { download?: boolean; meta?: Meta } = {},
) {
  const { key, sha, filename } = await withSigner(db, tokenHashOf(token), async (tx) => {
    const { recipient, request } = await loadSigner(tx);
    if (!SIGNABLE_STATUSES.includes(request.status))
      throw new AppError('not_found', 'This document is no longer available here.');
    if (!sessionValid(recipient, session))
      throw new AppError('unauthenticated', 'Open the link again to continue.');
    if (opts.download) {
      if (!documentSettingsSchema.parse(request.settings).allowDownload)
        throw new AppError('forbidden', 'The sender has turned off downloads for this document.');
      await appendEvent(tx, {
        requestId: request.id,
        workspaceId: request.workspaceId,
        recipientId: recipient.id,
        type: 'recipient.source_downloaded',
        data: { sourceSha256: request.sourceSha256 },
        ...opts.meta,
      });
    }
    const [file] = await tx
      .select()
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.id, request.sourceFileId));
    if (!file) throw new AppError('not_found', 'File not found');
    return { key: file.storageKey, sha: request.sourceSha256, filename: file.originalFilename };
  });
  const bytes = await storage.get(key);
  if (sha256Hex(bytes) !== sha) throw new Error('Integrity check failed for request source file');
  return { bytes, filename };
}

/** The signed copy, for recipients once the request is complete and the sender allows downloads. */
export async function readSignerSignedFile(
  db: Database,
  storage: ObjectStorage,
  token: string,
  meta: Meta = {},
) {
  const { key, sha, filename } = await withSigner(db, tokenHashOf(token), async (tx) => {
    const { recipient, request } = await loadSigner(tx);
    const settings = documentSettingsSchema.parse(request.settings);
    if (request.status !== 'completed' || !request.signedFileId)
      throw new AppError('not_found', 'The signed document is not available yet.');
    if (!settings.allowDownload)
      throw new AppError('forbidden', 'The sender has turned off downloads for this document.');
    const [file] = await tx
      .select()
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.id, request.signedFileId));
    await appendEvent(tx, {
      requestId: request.id,
      workspaceId: request.workspaceId,
      recipientId: recipient.id,
      type: 'recipient.downloaded',
      ...meta,
    });
    return { key: file!.storageKey, sha: file!.sha256, filename: file!.originalFilename };
  });
  const bytes = await storage.get(key);
  if (sha256Hex(bytes) !== sha) throw new Error('Integrity check failed for signed file');
  return { bytes, filename };
}

const adoptSchema = z.object({
  kind: z.enum(['signature', 'initials']),
  method: z.enum(['typed', 'drawn', 'uploaded']),
  typedText: z.string().trim().min(1).max(120).optional(),
  font: z.string().trim().max(60).optional(),
  pngBase64: z.string().min(10).max(1_500_000),
  /** The typed-signature design the signer chose (family, variation, adjustments), as evidence. */
  style: z
    .object({
      family: z.string().trim().max(40),
      variation: z.number().int().min(0).max(10_000),
      params: z.record(z.string().max(30), z.union([z.number(), z.string().max(30)])).optional(),
    })
    .optional(),
  /** Fields to apply the newly adopted mark to (this recipient's fields of the same kind only). */
  applyTo: z.array(z.string().uuid()).max(200).optional(),
});

/** Stores an explicitly adopted signature or initials mark for this recipient. */
export async function adoptSignature(
  db: Database,
  token: string,
  session: string | undefined,
  input: z.input<typeof adoptSchema>,
  meta: Meta = {},
) {
  const data = adoptSchema.parse(input);
  if (data.method === 'typed' && !data.typedText)
    throw new AppError('invalid', 'Type your name to create a signature.');
  let png: Buffer;
  try {
    png = sanitizePng(Buffer.from(data.pngBase64, 'base64'));
    await (await PDFDocument.create()).embedPng(png); // proves it decodes
  } catch (err) {
    throw new AppError(
      'invalid',
      err instanceof Error && err.message.startsWith('Signature')
        ? err.message
        : 'The signature image could not be read.',
    );
  }
  return withSigner(db, tokenHashOf(token), async (tx) => {
    const { recipient, request } = await requireSession(tx, session);
    if (!recipient.consentedAt)
      throw new AppError('conflict', 'Agree to sign electronically first.');
    const sha = sha256Hex(png);
    const [row] = await tx
      .insert(schema.signatures)
      .values({
        workspaceId: request.workspaceId,
        requestId: request.id,
        recipientId: recipient.id,
        kind: data.kind,
        method: data.method,
        typedText: data.method === 'typed' ? data.typedText! : null,
        font: data.method === 'typed' ? (data.font ?? null) : null,
        imagePng: png,
        imageSha256: sha,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      })
      .returning({ id: schema.signatures.id });
    await appendEvent(tx, {
      requestId: request.id,
      workspaceId: request.workspaceId,
      recipientId: recipient.id,
      type: 'recipient.signature_adopted',
      data: {
        kind: data.kind,
        method: data.method,
        imageSha256: sha,
        font: data.font ?? null,
        style: data.method === 'typed' ? (data.style ?? null) : null,
        sourceSha256: request.sourceSha256,
      },
      ...meta,
    });
    let applied: string[] = [];
    if (data.applyTo?.length) {
      const mine = await tx
        .select({ id: schema.requestFields.id, type: schema.requestFields.type })
        .from(schema.requestFields)
        .where(eq(schema.requestFields.recipientId, recipient.id));
      for (const id of data.applyTo)
        if (!mine.some((f) => f.id === id && f.type === data.kind))
          throw new AppError('forbidden', `That field is not one of your ${data.kind} fields.`);
      applied = [...new Set(data.applyTo)];
      await tx
        .update(schema.requestFields)
        .set({ signatureId: row!.id, value: null, filledAt: null })
        .where(inArray(schema.requestFields.id, applied));
      await appendEvent(tx, {
        requestId: request.id,
        workspaceId: request.workspaceId,
        recipientId: recipient.id,
        type: 'recipient.mark_applied',
        data: { kind: data.kind, signatureId: row!.id, fieldIds: applied },
        ...meta,
      });
    }
    return {
      id: row!.id,
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      applied,
    };
  });
}

const completeSchema = z.object({
  intent: z.literal(true, { message: 'Confirm that you intend to sign.' }),
  /** The version the signer reviewed; a mismatch means the document changed under them. */
  documentVersion: z.string().length(64).optional(),
  values: z
    .array(
      z.object({
        fieldId: z.string().uuid(),
        value: z.string().max(500).nullable().optional(),
        signatureId: z.string().uuid().nullable().optional(),
      }),
    )
    .max(500),
});

function validateValue(
  type: FieldType,
  value: string,
  options: string[] | null,
  label: string,
): string {
  switch (type) {
    case 'email':
      if (!z.string().email().safeParse(value).success)
        throw new AppError('invalid', `Enter a valid email in "${label}".`);
      return value.toLowerCase();
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(value))
        throw new AppError('invalid', `Enter a number in "${label}".`);
      return value;
    case 'checkbox':
      if (value !== 'true' && value !== 'false')
        throw new AppError('invalid', 'Invalid checkbox value.');
      return value;
    case 'dropdown':
    case 'radio':
      if (!options?.includes(value))
        throw new AppError('invalid', `Choose one of the options in "${label}".`);
      return value;
    default:
      return value;
  }
}

/**
 * Completes this recipient's part atomically: validates every field, records intent and evidence,
 * and notifies whoever is next. Returns follow-up invitations and whether the request is ready to
 * finalize. Calling it twice is refused, so a double click cannot sign twice.
 */
export async function completeSigning(
  db: Database,
  storage: ObjectStorage,
  token: string,
  session: string | undefined,
  input: z.input<typeof completeSchema>,
  meta: Meta = {},
): Promise<{ invitations: Invitation[]; readyToFinalize: boolean; requestId: string }> {
  const data = completeSchema.parse(input);
  const tokenHash = tokenHashOf(token);
  const result = await withSigner(db, tokenHash, async (tx) => {
    const { recipient, request } = await requireSession(tx, session);
    if (!recipient.consentedAt)
      throw new AppError('conflict', 'Agree to sign electronically first.');
    if (data.documentVersion && data.documentVersion !== request.sourceSha256)
      throw new AppError(
        'conflict',
        'This document was changed after you opened it. Reload to review the current version.',
      );

    // The version on file must still be the one that was sent.
    const [file] = await tx
      .select()
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.id, request.sourceFileId));
    if (!file || file.sha256 !== request.sourceSha256)
      throw new AppError('conflict', 'The document changed after it was sent. Contact the sender.');
    const bytes = await storage.get(file.storageKey);
    if (sha256Hex(bytes) !== request.sourceSha256)
      throw new Error(`Integrity check failed for request ${request.id}`);

    const fields = await tx
      .select()
      .from(schema.requestFields)
      .where(eq(schema.requestFields.recipientId, recipient.id));
    const sigs = await tx
      .select({ id: schema.signatures.id, kind: schema.signatures.kind })
      .from(schema.signatures)
      .where(eq(schema.signatures.recipientId, recipient.id));
    const byField = new Map(data.values.map((v) => [v.fieldId, v]));
    for (const v of data.values)
      if (!fields.some((f) => f.id === v.fieldId))
        throw new AppError('invalid', 'A value was sent for a field that is not yours.');
    const now = new Date();
    const signedDate = now.toISOString().slice(0, 10);
    const settings = documentSettingsSchema.parse(request.settings);

    for (const f of fields) {
      // Values sent now win; otherwise a value saved earlier in the session is used and re-checked.
      const v = byField.get(f.id) ?? { value: f.value, signatureId: f.signatureId };
      const label = f.label || f.type.replace('_', ' ');
      let value: string | null = null;
      let signatureId: string | null = null;
      if (f.type === 'signature' || f.type === 'initials') {
        if (v?.signatureId) {
          if (!sigs.some((s) => s.id === v.signatureId && s.kind === f.type))
            throw new AppError('invalid', `Adopt your ${f.type} before applying it.`);
          signatureId = v.signatureId;
        }
        if (f.required && !signatureId)
          throw new AppError(
            'invalid',
            `Add your ${f.type === 'initials' ? 'initials' : 'signature'} to every required field.`,
          );
      } else if (f.type === 'date_signed') {
        value = settings.showSigningDate || f.required ? signedDate : null;
      } else {
        const raw = (v?.value ?? '').trim();
        if (raw) value = validateValue(f.type, raw, f.options, label);
        if (f.required && (!value || (f.type === 'checkbox' && value !== 'true')))
          throw new AppError('invalid', `Complete the required field "${label}".`);
      }
      await tx
        .update(schema.requestFields)
        .set({ value, signatureId, filledAt: now })
        .where(eq(schema.requestFields.id, f.id));
    }

    await tx
      .update(schema.requestRecipients)
      .set({
        status: 'signed',
        signedAt: now,
        signedIp: meta.ipAddress ?? null,
        signedUserAgent: meta.userAgent ?? null,
        sessionHash: null,
      })
      .where(eq(schema.requestRecipients.id, recipient.id));
    const verb =
      recipient.role === 'reviewer'
        ? 'reviewed'
        : recipient.role === 'approver'
          ? 'approved'
          : 'signed';
    await appendEvent(tx, {
      requestId: request.id,
      workspaceId: request.workspaceId,
      recipientId: recipient.id,
      type: `recipient.${verb}`,
      data: {
        intent: true,
        fields: fields.length,
        fieldTypes: fields.reduce<Record<string, number>>(
          (acc, f) => ({ ...acc, [f.type]: (acc[f.type] ?? 0) + 1 }),
          {},
        ),
        consentedAt: recipient.consentedAt.toISOString(),
        sourceSha256: request.sourceSha256,
      },
      ...meta,
    });

    const all = await tx
      .select()
      .from(schema.requestRecipients)
      .where(eq(schema.requestRecipients.requestId, request.id));
    const acting = all.filter((r) => ACTING_ROLES.includes(r.role));
    const done = acting.every((r) => r.status === 'signed');
    let invitations: Invitation[] = [];
    if (!done) {
      const group = nextGroup(all, request.signingOrderEnabled);
      invitations = await assignTokens(tx, group, await linkExpiry(tx, settings), 'sign');
      for (const inv of invitations) {
        await appendEvent(tx, {
          requestId: request.id,
          workspaceId: request.workspaceId,
          recipientId: inv.recipientId,
          type: 'recipient.notified',
        });
      }
    }
    await tx
      .update(schema.signingRequests)
      .set({ status: 'in_progress', updatedAt: now })
      .where(eq(schema.signingRequests.id, request.id));
    return { invitations, readyToFinalize: done, requestId: request.id };
  });
  return result;
}

export async function declineSigning(
  db: Database,
  token: string,
  session: string | undefined,
  reason: string,
  meta: Meta = {},
) {
  const why = z.string().trim().max(1000, 'Keep the reason under 1000 characters.').parse(reason);
  return withSigner(db, tokenHashOf(token), async (tx) => {
    const { recipient, request } = await requireSession(tx, session);
    const now = new Date();
    await tx
      .update(schema.requestRecipients)
      .set({ status: 'declined', declinedAt: now, declineReason: why || null, sessionHash: null })
      .where(eq(schema.requestRecipients.id, recipient.id));
    await tx
      .update(schema.signingRequests)
      .set({ status: 'declined', closedAt: now, closedReason: 'declined', updatedAt: now })
      .where(eq(schema.signingRequests.id, request.id));
    await appendEvent(tx, {
      requestId: request.id,
      workspaceId: request.workspaceId,
      recipientId: recipient.id,
      type: 'recipient.declined',
      data: { reason: why || null },
      ...meta,
    });
    return {
      senderEmail: request.senderEmail,
      senderName: request.senderName,
      title: request.title,
      recipientName: recipient.name,
      documentId: request.documentId,
      reason: why,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Finalization

/**
 * Builds the signed PDF and completion certificate, stores them, and marks the request complete.
 * Runs in the context of the recipient who finished last (or a sender retrying). On failure the
 * request is marked finalization_failed and never shown as completed.
 */
export async function finalizeRequest(
  db: Database,
  storage: ObjectStorage,
  ctx: { token: string } | { actor: ActorContext },
  requestId: string,
): Promise<{
  invitations: Invitation[];
  senderEmail: string;
  title: string;
  isTest: boolean;
  documentId: string;
}> {
  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    'token' in ctx ? withSigner(db, tokenHashOf(ctx.token), fn) : withActor(db, ctx.actor, fn);

  const snapshot = await run(async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (!req) throw new AppError('not_found', 'Request not found');
    const recips = await tx
      .select()
      .from(schema.requestRecipients)
      .where(eq(schema.requestRecipients.requestId, requestId))
      .orderBy(asc(schema.requestRecipients.signingOrder), asc(schema.requestRecipients.createdAt));
    const fields = await tx
      .select()
      .from(schema.requestFields)
      .where(eq(schema.requestFields.requestId, requestId));
    const sigs = await tx
      .select()
      .from(schema.signatures)
      .where(eq(schema.signatures.requestId, requestId));
    const [file] = await tx
      .select()
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.id, req.sourceFileId));
    return { req, recips, fields, sigs, file: file! };
  });
  const { req, recips, fields, sigs, file } = snapshot;
  if (req.status === 'completed')
    return {
      invitations: [],
      senderEmail: req.senderEmail,
      title: req.title,
      isTest: req.isTest,
      documentId: req.documentId,
    };
  if (CLOSED_STATUSES.includes(req.status))
    throw new AppError('conflict', 'This request is closed.');
  if (!recips.filter((r) => ACTING_ROLES.includes(r.role)).every((r) => r.status === 'signed'))
    throw new AppError('conflict', 'Not everyone has finished yet.');

  const failed = async (err: unknown) => {
    await run(async (tx) => {
      await tx
        .update(schema.signingRequests)
        .set({
          status: 'finalization_failed',
          finalizationError: String(err instanceof Error ? err.message : err).slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(schema.signingRequests.id, requestId));
      await appendEvent(tx, {
        requestId,
        workspaceId: req.workspaceId,
        actorUserId: 'actor' in ctx ? ctx.actor.userId : null,
        type: 'request.finalization_failed',
      });
    });
  };

  let signedKey: string | null = null;
  let certKey: string | null = null;
  try {
    const source = await storage.get(file.storageKey);
    if (sha256Hex(source) !== req.sourceSha256)
      throw new Error('Source file failed its integrity check');
    const sigById = new Map(sigs.map((s) => [s.id, s]));
    const recipById = new Map(recips.map((r) => [r.id, r]));
    const block = signatureBlockSettings(req.settings);
    const signed = await buildSignedPdf(
      source,
      fields.map((f) => {
        const r = recipById.get(f.recipientId);
        const hasMark = Boolean(f.signatureId);
        // The block's time is the server's recorded completion time for that recipient. A mark
        // without one would mean evidence is missing, so finalization stops rather than invent it.
        if (hasMark && !r?.signedAt)
          throw new Error(`Signature field ${f.id} has no recorded signing time`);
        return {
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          value: f.value,
          imagePng: f.signatureId ? (sigById.get(f.signatureId)?.imagePng ?? null) : null,
          signer:
            hasMark && r?.signedAt
              ? {
                  name: r.name,
                  role: r.role,
                  signedAt: r.signedAt,
                  timeZone: block.timeZone,
                  format: block.format,
                }
              : null,
        };
      }),
      { isTest: req.isTest, requestId },
    );
    const signedSha = sha256Hex(signed);

    // The certificate covers the event chain as it stands right before completion.
    const events = await run((tx) =>
      tx
        .select()
        .from(schema.signingEvents)
        .where(eq(schema.signingEvents.requestId, requestId))
        .orderBy(asc(schema.signingEvents.seq)),
    );
    const nameOf = new Map(recips.map((r) => [r.id, `${r.name} <${r.email}>`]));
    const usedSigIds = new Set(fields.map((f) => f.signatureId).filter(Boolean));
    const completedAt = new Date();
    const cert = await buildCertificate({
      requestId,
      isTest: req.isTest,
      title: req.title,
      workspaceName: req.workspaceName,
      senderName: req.senderName,
      senderEmail: req.senderEmail,
      sentAt: req.sentAt ?? req.createdAt,
      completedAt,
      sourceSha256: req.sourceSha256,
      signedSha256: signedSha,
      pageCount: file.pageCount,
      signingOrderEnabled: req.signingOrderEnabled,
      disclosureVersion: req.disclosureVersion,
      timeZone: block.timeZone,
      recipients: recips.map((r) => ({
        name: r.name,
        email: r.email,
        role: r.role,
        signingOrder: r.signingOrder,
        authMethod: r.authMethod,
        authenticatedAt: r.authenticatedAt,
        consentedAt: r.consentedAt,
        signedAt: r.signedAt,
        ip: r.signedIp,
        userAgent: r.signedUserAgent,
        signatures: sigs
          .filter((s) => s.recipientId === r.id && usedSigIds.has(s.id))
          .map((s) => ({ kind: s.kind, method: s.method, imagePng: s.imagePng })),
        signingEventRef: signingEventRef(events, r.id),
      })),
      events: events.map((e) => ({
        at: e.createdAt,
        type: e.type,
        who: e.recipientId
          ? (nameOf.get(e.recipientId) ?? '')
          : e.actorUserId
            ? `${req.senderName} (sender)`
            : 'system',
        detail: e.ipAddress ? `IP ${e.ipAddress}` : '',
      })),
      chainHead: events.at(-1)?.hash ?? GENESIS_HASH,
    });
    const certSha = sha256Hex(cert);
    const base = `ws/${req.workspaceId}/doc/${req.documentId}/req/${requestId}`;
    signedKey = `${base}/signed-${signedSha.slice(0, 16)}.pdf`;
    certKey = `${base}/certificate-${certSha.slice(0, 16)}.pdf`;
    await storage.put(signedKey, signed, 'application/pdf');
    await storage.put(certKey, cert, 'application/pdf');

    const safeTitle = req.title.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document';
    return await run(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.signingRequests)
        .where(eq(schema.signingRequests.id, requestId))
        .for('update');
      if (locked!.status === 'completed') throw new AppError('conflict', 'already_completed');
      const [{ v }] = (await tx.execute(
        sql`select coalesce(max(version), 0)::int + 1 as v from document_files where document_id = ${req.documentId}::uuid`,
      )) as unknown as [{ v: number }];
      const [sf] = await tx
        .insert(schema.documentFiles)
        .values({
          workspaceId: req.workspaceId,
          documentId: req.documentId,
          version: v,
          kind: 'signed',
          storageKey: signedKey!,
          originalFilename: `${safeTitle} (signed).pdf`,
          contentType: 'application/pdf',
          sizeBytes: signed.byteLength,
          sha256: signedSha,
          pageCount: file.pageCount,
          createdBy: req.sentBy,
        })
        .returning({ id: schema.documentFiles.id });
      const [cf] = await tx
        .insert(schema.documentFiles)
        .values({
          workspaceId: req.workspaceId,
          documentId: req.documentId,
          version: v,
          kind: 'certificate',
          storageKey: certKey!,
          originalFilename: `${safeTitle} (certificate).pdf`,
          contentType: 'application/pdf',
          sizeBytes: cert.byteLength,
          sha256: certSha,
          pageCount: (await PDFDocument.load(cert)).getPageCount(),
          createdBy: req.sentBy,
        })
        .returning({ id: schema.documentFiles.id });
      await tx
        .update(schema.signingRequests)
        .set({
          status: 'completed',
          completedAt,
          signedFileId: sf!.id,
          certificateFileId: cf!.id,
          finalizationError: null,
          updatedAt: completedAt,
        })
        .where(eq(schema.signingRequests.id, requestId));
      await appendEvent(tx, {
        requestId,
        workspaceId: req.workspaceId,
        actorUserId: 'actor' in ctx ? ctx.actor.userId : null,
        type: 'request.completed',
        data: { signedSha256: signedSha, certificateSha256: certSha },
      });
      // Completion emails are queued only now: files stored, hashes recorded, evidence closed.
      await enqueueCompletionNotifications(tx, {
        request: req,
        recipients: recips,
        pageCount: file.pageCount,
        completedAt,
        signedFileId: sf!.id,
        certificateFileId: cf!.id,
      });

      // Recipients get a link to the completed request. The person who just finished keeps the link
      // they are using; everyone else gets a fresh one, and copy-only recipients get theirs now.
      const fresh = await tx
        .select()
        .from(schema.requestRecipients)
        .where(eq(schema.requestRecipients.requestId, requestId));
      const days = await getConfigValue(tx as unknown as Database, 'signing.link_valid_days', 30);
      const expires = new Date(Date.now() + days * 86_400_000);
      const currentHash = 'token' in ctx ? tokenHashOf(ctx.token) : null;
      const others = fresh.filter((r) => r.status !== 'declined' && r.tokenHash !== currentHash);
      const invitations = await assignTokens(tx, others, expires, 'completed_copy');
      const me = fresh.find((r) => currentHash && r.tokenHash === currentHash);
      if (me && 'token' in ctx) {
        await tx
          .update(schema.requestRecipients)
          .set({ tokenExpiresAt: expires })
          .where(eq(schema.requestRecipients.id, me.id));
        invitations.push({
          recipientId: me.id,
          name: me.name,
          email: me.email,
          token: ctx.token,
          kind: 'completed_copy',
        });
      }
      return {
        invitations,
        senderEmail: req.senderEmail,
        title: req.title,
        isTest: req.isTest,
        documentId: req.documentId,
      };
    });
  } catch (err) {
    if (err instanceof AppError && err.message === 'already_completed')
      return {
        invitations: [],
        senderEmail: req.senderEmail,
        title: req.title,
        isTest: req.isTest,
        documentId: req.documentId,
      };
    for (const k of [signedKey, certKey]) if (k) await storage.delete(k).catch(() => {});
    await failed(err);
    throw err;
  }
}

/** Shared with the retrieval service, which writes to the same evidence chain. */
export { appendEvent as appendEvidenceEvent };

export interface FinalizationRetry {
  requestId: string;
  ok: boolean;
  error?: string;
  result?: Awaited<ReturnType<typeof finalizeRequest>> & {
    senderName: string;
    workspaceName: string;
  };
}

/**
 * Scheduled retry for requests that failed to finish (for example a storage outage). Each retry
 * runs under RLS as the member who sent the request, at most `maxAttempts` failures per request,
 * at least 10 minutes apart. A request whose sender can no longer act is left for a person.
 */
export async function retryFailedFinalizations(
  db: Database,
  storage: ObjectStorage,
  opts: { limit?: number; maxAttempts?: number } = {},
): Promise<FinalizationRetry[]> {
  const queue = (await db.execute(
    sql`select * from st_finalization_retry_queue(${opts.limit ?? 10}, ${opts.maxAttempts ?? 3})`,
  )) as unknown as {
    request_id: string;
    sent_by: string;
    sender_name: string;
    workspace_name: string;
  }[];
  const out: FinalizationRetry[] = [];
  for (const q of queue) {
    try {
      const res = await finalizeRequest(
        db,
        storage,
        { actor: { userId: q.sent_by } },
        q.request_id,
      );
      out.push({
        requestId: q.request_id,
        ok: true,
        result: { ...res, senderName: q.sender_name, workspaceName: q.workspace_name },
      });
    } catch (err) {
      out.push({
        requestId: q.request_id,
        ok: false,
        error: String(err instanceof Error ? err.message : err).slice(0, 200),
      });
    }
  }
  return out;
}
