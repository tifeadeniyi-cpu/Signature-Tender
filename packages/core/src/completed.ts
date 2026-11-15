import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  schema,
  withActor,
  withClaimant,
  withRetrieval,
  withSigner,
  type Database,
  type Tx,
} from '@st/db';
import { AppError } from './errors';
import { documentSettingsSchema } from './documents';
import type { ObjectStorage } from './storage';
import { hashSecret, isPlausibleSecret, safeEqualHex, sha256Hex } from './signing-crypto';
import { appendEvidenceEvent } from './signing';
import { maskEmail } from './notifications';
import { retrievalSessionEmail } from './retrieval';

/**
 * The completed-document page (after everyone has signed) and the optional account claim that
 * follows it. Three ways in, all checked by row-level security:
 *  - a recipient's own link token, plus their signing session, a verified-email retrieval session
 *    for the same address, or (for link-only recipients) the token itself;
 *  - a verified-email retrieval session (the completion email's buttons);
 *  - a signed-in account that claimed the document.
 * A document ID alone never grants access.
 */

type Meta = { ipAddress?: string | null; userAgent?: string | null };
type RequestRow = typeof schema.signingRequests.$inferSelect;
type RecipientRow = typeof schema.requestRecipients.$inferSelect;
type FileKind = 'signed' | 'certificate';

const ACTING = ['signer', 'approver', 'reviewer'];
const OPEN = ['sent', 'in_progress', 'awaiting_approval'];

export type CompletedState =
  /** Finalized: signed copy and evidence certificate exist. */
  | 'completed'
  /** Everyone has finished but the final files are still being produced (or are being retried). */
  | 'finalizing'
  /** This recipient finished; others still have to act. */
  | 'you_signed'
  /** This recipient still has to act. */
  | 'awaiting_you'
  /** Others are still acting (for a recipient who does not act, such as a cc). */
  | 'in_progress'
  | 'declined'
  | 'expired'
  | 'cancelled'
  /** Completed, but the files are gone (retention) or failed to load. */
  | 'unavailable';

export interface CompletedView {
  state: CompletedState;
  access: 'signer' | 'retrieval' | 'claimant';
  request: {
    id: string;
    documentId: string;
    title: string;
    senderName: string;
    senderEmail: string;
    workspaceName: string;
    isTest: boolean;
    sentAt: Date | null;
    completedAt: Date | null;
    allowDownload: boolean;
    allowPrint: boolean;
  };
  /** Completed, downloads allowed and both files available. */
  canOpenFiles: boolean;
  files: {
    signed: { sha256: string; pageCount: number | null } | null;
    certificate: { sha256: string; pageCount: number | null } | null;
  };
  signers: {
    name: string;
    role: string;
    status: string;
    signedAt: Date | null;
    isYou: boolean;
  }[];
  /** The recipient this access belongs to. Email is shown only to that recipient. */
  you: { recipientId: string; name: string; email: string; role: string; status: string } | null;
  events: { at: Date; type: string; hash: string }[];
}

/** Returned instead of a view when the visitor must prove they control the recipient's email. */
export interface CompletedVerifyNeeded {
  state: 'verify';
  title: string;
  maskedEmail: string;
  /** Used only by the server action that sends the code. Never rendered. */
  email: string;
}

type SignerRow = {
  recipientId: string | null;
  name: string;
  role: string;
  status: string;
  signingOrder: number;
  signedAt: Date | null;
};

function stateFor(
  req: RequestRow,
  signers: SignerRow[],
  you: { role: string; status: string } | null,
  filesOk: boolean,
): CompletedState {
  if (req.status === 'completed')
    return filesOk || !allowDownload(req) ? 'completed' : 'unavailable';
  if (req.status === 'declined' || req.status === 'expired' || req.status === 'cancelled')
    return req.status;
  if (req.status === 'finalization_failed') return 'finalizing';
  const acting = signers.filter((s) => ACTING.includes(s.role));
  if (OPEN.includes(req.status) && acting.length > 0 && acting.every((s) => s.status === 'signed'))
    return 'finalizing';
  if (you && ACTING.includes(you.role))
    return you.status === 'signed'
      ? 'you_signed'
      : OPEN.includes(req.status)
        ? 'awaiting_you'
        : 'in_progress';
  return 'in_progress';
}

function allowDownload(req: RequestRow) {
  return documentSettingsSchema.parse(req.settings).allowDownload;
}

async function buildView(
  tx: Tx,
  access: CompletedView['access'],
  req: RequestRow,
  me: Pick<RecipientRow, 'id' | 'name' | 'email' | 'role' | 'status'> | null,
  signers: SignerRow[],
): Promise<CompletedView> {
  const settings = documentSettingsSchema.parse(req.settings);
  const ids = [req.signedFileId, req.certificateFileId].filter(Boolean) as string[];
  // Policies decide what is visible: the files must be final, allowed and not purged.
  const files = ids.length
    ? await tx
        .select({
          id: schema.documentFiles.id,
          sha256: schema.documentFiles.sha256,
          pageCount: schema.documentFiles.pageCount,
        })
        .from(schema.documentFiles)
        .where(inArray(schema.documentFiles.id, ids))
    : [];
  const signed = files.find((f) => f.id === req.signedFileId) ?? null;
  const certificate = files.find((f) => f.id === req.certificateFileId) ?? null;
  const completed = req.status === 'completed';
  const filesOk = completed && Boolean(signed && certificate);
  // A signer context can see the document's files regardless of settings, so check them here too.
  const canOpenFiles = filesOk && settings.allowDownload;
  const events = await tx
    .select({
      at: schema.signingEvents.createdAt,
      type: schema.signingEvents.type,
      hash: schema.signingEvents.hash,
    })
    .from(schema.signingEvents)
    .where(eq(schema.signingEvents.requestId, req.id))
    .orderBy(asc(schema.signingEvents.seq));
  return {
    state: stateFor(req, signers, me, filesOk),
    access,
    request: {
      id: req.id,
      documentId: req.documentId,
      title: req.title,
      senderName: req.senderName,
      senderEmail: req.senderEmail,
      workspaceName: req.workspaceName,
      isTest: req.isTest,
      sentAt: req.sentAt,
      completedAt: req.completedAt,
      allowDownload: settings.allowDownload,
      allowPrint: settings.allowPrint,
    },
    canOpenFiles,
    files: {
      signed:
        canOpenFiles && signed ? { sha256: signed.sha256, pageCount: signed.pageCount } : null,
      certificate:
        canOpenFiles && certificate
          ? { sha256: certificate.sha256, pageCount: certificate.pageCount }
          : null,
    },
    signers: signers.map((s) => ({
      name: s.name,
      role: s.role,
      status: s.status,
      signedAt: s.signedAt,
      isYou: Boolean(me && s.recipientId === me.id),
    })),
    you: me
      ? { recipientId: me.id, name: me.name, email: me.email, role: me.role, status: me.status }
      : null,
    events,
  };
}

// ---------------------------------------------------------------------------------------------
// Recipient link token

function tokenHash(token: string) {
  if (!isPlausibleSecret(token)) throw new AppError('not_found', 'This link is not valid.');
  return hashSecret(token);
}

async function currentSigner(tx: Tx) {
  const [row] = (await tx.execute(sql`select st_current_signer() as id`)) as unknown as {
    id: string | null;
  }[];
  if (!row?.id) throw new AppError('not_found', 'This link is not valid or has expired.');
  const [recipient] = await tx
    .select()
    .from(schema.requestRecipients)
    .where(eq(schema.requestRecipients.id, row.id));
  const [request] = await tx
    .select()
    .from(schema.signingRequests)
    .where(eq(schema.signingRequests.id, recipient!.requestId));
  return { recipient: recipient!, request: request! };
}

function signerAuthorized(
  r: RecipientRow,
  signSession: string | undefined,
  retrievalEmail: string | null,
) {
  if (
    signSession &&
    r.sessionHash &&
    r.sessionExpiresAt &&
    r.sessionExpiresAt > new Date() &&
    safeEqualHex(hashSecret(signSession), r.sessionHash)
  )
    return true;
  if (retrievalEmail && retrievalEmail === r.email.toLowerCase()) return true;
  // Link-only recipients were let in to sign by the link itself; it stays their credential.
  return r.authMethod === 'email_link';
}

/**
 * The completed-document view for a recipient's own link. Returns a verify-needed result when
 * the browser has neither a signing session nor a verified-email session for that address.
 */
export async function getCompletedForSigner(
  db: Database,
  token: string,
  signSession: string | undefined,
  retrieveToken: string | undefined,
): Promise<CompletedView | CompletedVerifyNeeded> {
  const hash = tokenHash(token);
  const retrievalEmail = await retrievalSessionEmail(db, retrieveToken);
  return withSigner(db, hash, async (tx) => {
    const { recipient, request } = await currentSigner(tx);
    if (!signerAuthorized(recipient, signSession, retrievalEmail))
      return {
        state: 'verify' as const,
        title: request.title,
        maskedEmail: maskEmail(recipient.email),
        email: recipient.email.toLowerCase(),
      };
    const all = await tx
      .select()
      .from(schema.requestRecipients)
      .where(eq(schema.requestRecipients.requestId, request.id))
      .orderBy(asc(schema.requestRecipients.signingOrder), asc(schema.requestRecipients.createdAt));
    return buildView(
      tx,
      'signer',
      request,
      recipient,
      all.map((r) => ({
        recipientId: r.id,
        name: r.name,
        role: r.role,
        status: r.status,
        signingOrder: r.signingOrder,
        signedAt: r.signedAt,
      })),
    );
  });
}

async function readVerified(
  storage: ObjectStorage,
  file: { storageKey: string; sha256: string; id: string },
) {
  const bytes = await storage.get(file.storageKey);
  if (sha256Hex(bytes) !== file.sha256)
    throw new Error(`Integrity check failed for file ${file.id}`);
  return bytes;
}

function fileIdFor(req: RequestRow, kind: FileKind) {
  return kind === 'signed' ? req.signedFileId : req.certificateFileId;
}

/** Signed copy or certificate through a recipient's link, with the same checks as the page. */
export async function readCompletedFileForSigner(
  db: Database,
  storage: ObjectStorage,
  token: string,
  signSession: string | undefined,
  retrieveToken: string | undefined,
  kind: FileKind,
  purpose: 'view' | 'download',
  meta: Meta = {},
) {
  const hash = tokenHash(token);
  const retrievalEmail = await retrievalSessionEmail(db, retrieveToken);
  const file = await withSigner(db, hash, async (tx) => {
    const { recipient, request } = await currentSigner(tx);
    if (!signerAuthorized(recipient, signSession, retrievalEmail))
      throw new AppError('unauthenticated', 'Verify your email to open this document.');
    const id = fileIdFor(request, kind);
    if (request.status !== 'completed' || !id)
      throw new AppError('not_found', 'The completed document is not available yet.');
    if (!allowDownload(request))
      throw new AppError('forbidden', 'The sender has turned off downloads for this document.');
    const [file] = await tx
      .select()
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.id, id));
    const [doc] = await tx
      .select({ purgedAt: schema.documents.purgedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, request.documentId));
    if (!file || doc?.purgedAt)
      throw new AppError('not_found', 'This document is no longer available.');
    await appendEvidenceEvent(tx, {
      requestId: request.id,
      workspaceId: request.workspaceId,
      recipientId: recipient.id,
      type: purpose === 'view' ? 'recipient.viewed_copy' : 'recipient.downloaded',
      data: { kind, via: 'completed_page' },
      ...meta,
    });
    return file;
  });
  return { bytes: await readVerified(storage, file), filename: file.originalFilename };
}

// ---------------------------------------------------------------------------------------------
// Verified-email retrieval session

function retrievalHash(token: string | undefined) {
  if (!token || !isPlausibleSecret(token))
    throw new AppError(
      'unauthenticated',
      'Your secure session has ended. Verify your email again.',
    );
  return hashSecret(token);
}

/** The completed-document view for a verified-email session (completion email buttons). */
export async function getCompletedForRetrieval(
  db: Database,
  retrieveToken: string | undefined,
  requestId: string,
): Promise<CompletedView> {
  if (!z.string().uuid().safeParse(requestId).success) throw new AppError('not_found', 'Not found');
  return withRetrieval(db, retrievalHash(retrieveToken), async (tx) => {
    const [row] = (await tx.execute(sql`select st_retrieval_email() as email`)) as unknown as {
      email: string | null;
    }[];
    if (!row?.email)
      throw new AppError(
        'unauthenticated',
        'Your secure session has ended. Verify your email again.',
      );
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (!req) throw new AppError('not_found', 'This document is not available to this address.');
    const [me] = await tx
      .select()
      .from(schema.requestRecipients)
      .where(
        and(
          eq(schema.requestRecipients.requestId, requestId),
          sql`lower(${schema.requestRecipients.email}) = ${row.email}`,
        ),
      );
    if (!me) throw new AppError('not_found', 'This document is not available to this address.');
    const rows = (await tx.execute(
      sql`select * from st_retrieval_signers(${requestId}::uuid)`,
    )) as unknown as SignerSql[];
    return buildView(
      tx,
      'retrieval',
      req,
      me,
      rows.map((s) => ({
        // This function does not return ids; match the visitor's own row by order, role and name.
        recipientId:
          s.signing_order === me.signingOrder && s.role === me.role && s.name === me.name
            ? me.id
            : null,
        ...signerFromSql(s),
      })),
    );
  });
}

type SignerSql = {
  recipient_id?: string;
  name: string;
  role: string;
  status: string;
  signing_order: number;
  signed_at: string | Date | null;
};

function signerFromSql(s: SignerSql) {
  return {
    name: s.name,
    role: s.role,
    status: s.status,
    signingOrder: s.signing_order,
    signedAt: s.signed_at ? new Date(s.signed_at) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Account claim

/** A reference to one recipient's completed request, signed so it cannot be altered or forged. */
export interface ClaimTicket {
  requestId: string;
  recipientId: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

const ticketSchema = z.object({
  requestId: z.string().uuid(),
  recipientId: z.string().uuid(),
  exp: z.number().int(),
});

const TICKET_DAYS = 7;

function ticketMac(payload: string, secret: string) {
  return createHmac('sha256', `st-claim-ticket:${secret}`).update(payload).digest('base64url');
}

/**
 * Creates the reference carried through sign-up and email verification. It only names the
 * request; the claim itself still requires a signed-in account whose verified email is that
 * recipient's address.
 */
export function createClaimTicket(
  input: { requestId: string; recipientId: string },
  secret: string,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ ...input, exp: Math.floor(now / 1000) + TICKET_DAYS * 86_400 }),
  ).toString('base64url');
  return `${payload}.${ticketMac(payload, secret)}`;
}

export function readClaimTicket(
  ticket: string,
  secret: string,
  now = Date.now(),
): ClaimTicket | null {
  const [payload, mac, extra] = ticket.split('.');
  if (!payload || !mac || extra !== undefined || payload.length > 400) return null;
  const want = Buffer.from(ticketMac(payload, secret));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const parsed = ticketSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (!parsed.success || parsed.data.exp * 1000 < now) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export type ClaimOutcome =
  | 'ok'
  | 'exists'
  | 'unauthenticated'
  | 'unverified'
  | 'not_found'
  | 'email_mismatch'
  | 'not_completed';

export interface ClaimPreview {
  outcome: ClaimOutcome;
  title: string | null;
  senderName: string | null;
  completedAt: Date | null;
  alreadyClaimed: boolean;
}

/** What the signed-in user is about to add. The title is shown only when their email matches. */
export async function previewClaim(
  db: Database,
  userId: string,
  ticket: ClaimTicket,
): Promise<ClaimPreview> {
  return withActor(db, { userId }, async (tx) => {
    const [row] = (await tx.execute(
      sql`select * from st_claim_preview(${ticket.requestId}::uuid, ${ticket.recipientId}::uuid)`,
    )) as unknown as {
      outcome: ClaimOutcome;
      title: string | null;
      sender_name: string | null;
      completed_at: string | Date | null;
      already_claimed: boolean;
    }[];
    return {
      outcome: row?.outcome ?? 'not_found',
      title: row?.title ?? null,
      senderName: row?.sender_name ?? null,
      completedAt: row?.completed_at ? new Date(row.completed_at) : null,
      alreadyClaimed: Boolean(row?.already_claimed),
    };
  });
}

/**
 * Adds the completed document to the signed-in user's account. It does not change the signed
 * PDF, the request, its owner or its evidence chain; it only records the claim.
 */
export async function claimDocument(db: Database, userId: string, ticket: ClaimTicket) {
  return withActor(db, { userId }, async (tx) => {
    const [row] = (await tx.execute(
      sql`select st_claim_request(${ticket.requestId}::uuid, ${ticket.recipientId}::uuid) as r`,
    )) as unknown as { r: ClaimOutcome }[];
    return row?.r ?? 'not_found';
  });
}

/** Whether an account already uses this address (shown only to that verified recipient). */
export async function accountExistsForEmail(db: Database, email: string) {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return Boolean(row);
}

export interface ClaimedDocument {
  requestId: string;
  documentId: string;
  title: string;
  senderName: string;
  workspaceName: string;
  completedAt: Date | null;
  claimedAt: Date;
  canDownload: boolean;
}

/** Documents the user claimed after signing ("Documents signed by me"). */
export async function listClaimedDocuments(
  db: Database,
  userId: string,
): Promise<ClaimedDocument[]> {
  return withClaimant(db, { userId }, async (tx) => {
    const claims = await tx
      .select()
      .from(schema.documentClaims)
      .where(eq(schema.documentClaims.userId, userId))
      .orderBy(desc(schema.documentClaims.createdAt));
    if (!claims.length) return [];
    const reqs = await tx
      .select()
      .from(schema.signingRequests)
      .where(
        inArray(
          schema.signingRequests.id,
          claims.map((c) => c.requestId),
        ),
      );
    return claims.flatMap((c) => {
      const r = reqs.find((x) => x.id === c.requestId);
      if (!r) return [];
      return [
        {
          requestId: r.id,
          documentId: r.documentId,
          title: r.title,
          senderName: r.senderName,
          workspaceName: r.workspaceName,
          completedAt: r.completedAt,
          claimedAt: c.createdAt,
          canDownload: allowDownload(r) && Boolean(r.signedFileId),
        },
      ];
    });
  });
}

async function loadClaim(tx: Tx, userId: string, requestId: string) {
  if (!z.string().uuid().safeParse(requestId).success) throw new AppError('not_found', 'Not found');
  const [claim] = await tx
    .select()
    .from(schema.documentClaims)
    .where(
      and(eq(schema.documentClaims.userId, userId), eq(schema.documentClaims.requestId, requestId)),
    );
  const [req] = claim
    ? await tx.select().from(schema.signingRequests).where(eq(schema.signingRequests.id, requestId))
    : [];
  if (!claim || !req) throw new AppError('not_found', 'This document is not in your account.');
  return { claim, req };
}

/** A claimed document as its claimant sees it. */
export async function getCompletedForClaimant(
  db: Database,
  userId: string,
  requestId: string,
): Promise<CompletedView> {
  return withClaimant(db, { userId }, async (tx) => {
    const { claim, req } = await loadClaim(tx, userId, requestId);
    const rows = (await tx.execute(
      sql`select * from st_claimed_signers(${requestId}::uuid)`,
    )) as unknown as SignerSql[];
    const signers = rows.map((s) => ({ recipientId: s.recipient_id ?? null, ...signerFromSql(s) }));
    const mine = signers.find((s) => s.recipientId === claim.recipientId);
    return buildView(
      tx,
      'claimant',
      req,
      mine
        ? {
            id: claim.recipientId,
            name: mine.name,
            email: '',
            role: mine.role as RecipientRow['role'],
            status: mine.status as RecipientRow['status'],
          }
        : null,
      signers,
    );
  });
}

/** Signed copy or certificate of a claimed document, recorded in the evidence chain. */
export async function readClaimedFile(
  db: Database,
  storage: ObjectStorage,
  userId: string,
  requestId: string,
  kind: FileKind,
  purpose: 'view' | 'download',
  meta: Meta = {},
) {
  const file = await withClaimant(db, { userId }, async (tx) => {
    const { claim, req } = await loadClaim(tx, userId, requestId);
    const id = fileIdFor(req, kind);
    if (!id) throw new AppError('not_found', 'This document is not available.');
    // The file policy checks the request is complete, downloads are allowed and nothing was purged.
    const [file] = await tx
      .select()
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.id, id));
    if (!file) throw new AppError('not_found', 'This document is not available for download.');
    await appendEvidenceEvent(tx, {
      requestId,
      workspaceId: req.workspaceId,
      recipientId: claim.recipientId,
      actorUserId: userId,
      type: purpose === 'view' ? 'recipient.viewed_copy' : 'recipient.retrieved',
      data: { kind, via: 'account_claim' },
      ...meta,
    });
    return file;
  });
  return { bytes: await readVerified(storage, file), filename: file.originalFilename };
}
