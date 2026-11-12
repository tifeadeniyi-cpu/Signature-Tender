import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withRetrieval, type Database } from '@st/db';
import { AppError } from './errors';
import { getConfigValue } from './config';
import { documentSettingsSchema } from './documents';
import type { ObjectStorage } from './storage';
import { hashSecret, newOtp, newSecret, sha256Hex, isPlausibleSecret } from './signing-crypto';
import { appendEvidenceEvent, type Invitation } from './signing';

/**
 * Verified-email retrieval for people without an account (spec 17.3 C and D, 17.9 lost links):
 * a recipient proves they control their email with a one-time code, then sees only the requests
 * sent to that address. They can download completed copies the sender allowed, or get a fresh
 * signing link for a request still waiting on them. Knowing a request number is never enough.
 */

type Meta = { ipAddress?: string | null; userAgent?: string | null };
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const OPEN = ['sent', 'in_progress', 'awaiting_approval'];

function codeHash(email: string, code: string) {
  return hashSecret(`retrieval:${email}:${code}`);
}

/**
 * Starts a retrieval. Returns a code only when the address has documents; callers show the same
 * message either way so the page never reveals whether an email is known.
 */
export async function startRetrieval(db: Database, rawEmail: string, meta: Meta = {}) {
  const email = emailSchema.parse(rawEmail);
  const code = newOtp();
  const [row] = (await db.execute(
    sql`select * from st_retrieval_start(${email}, ${codeHash(email, code)}, ${meta.ipAddress ?? null})`,
  )) as unknown as { session_id: string | null; has_documents: boolean; allowed: boolean }[];
  if (!row?.allowed)
    throw new AppError('conflict', 'Too many code requests. Please wait an hour and try again.');
  return { sessionId: row.session_id!, email, code: row.has_documents ? code : null };
}

/** Checks the code. Returns the session token for the browser cookie (only its hash is stored). */
export async function verifyRetrieval(
  db: Database,
  sessionId: string,
  rawEmail: string,
  rawCode: string,
) {
  if (!z.string().uuid().safeParse(sessionId).success)
    throw new AppError('invalid', 'Start again and request a new code.');
  const email = emailSchema.parse(rawEmail);
  const code = z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code.')
    .parse(rawCode);
  const token = newSecret();
  const [row] = (await db.execute(
    sql`select st_retrieval_verify(${sessionId}::uuid, ${codeHash(email, code)}, ${hashSecret(token)}) as r`,
  )) as unknown as { r: string }[];
  switch (row?.r) {
    case 'ok':
      return token;
    case 'expired':
      throw new AppError('invalid', 'That code has expired. Request a new one.');
    case 'locked':
      throw new AppError('invalid', 'Too many incorrect codes. Request a new one.');
    case 'used':
      throw new AppError('invalid', 'That code was already used. Request a new one.');
    default:
      throw new AppError('invalid', 'That code is not correct.');
  }
}

function sessionHash(token: string | undefined) {
  if (!token || !isPlausibleSecret(token))
    throw new AppError(
      'unauthenticated',
      'Your retrieval session has ended. Verify your email again.',
    );
  return hashSecret(token);
}

async function requireEmail(tx: Parameters<Parameters<typeof withRetrieval>[2]>[0]) {
  const [row] = (await tx.execute(sql`select st_retrieval_email() as email`)) as unknown as {
    email: string | null;
  }[];
  if (!row?.email)
    throw new AppError(
      'unauthenticated',
      'Your retrieval session has ended. Verify your email again.',
    );
  return row.email;
}

export interface RetrievableRequest {
  requestId: string;
  recipientId: string;
  title: string;
  senderName: string;
  workspaceName: string;
  status: string;
  isTest: boolean;
  sentAt: Date | null;
  completedAt: Date | null;
  canDownload: boolean;
  /** True when this recipient still has to act and can ask for a fresh link. */
  awaitingYou: boolean;
}

export async function listRetrievable(db: Database, token: string | undefined) {
  return withRetrieval(db, sessionHash(token), async (tx) => {
    const email = await requireEmail(tx);
    const mine = await tx
      .select()
      .from(schema.requestRecipients)
      .where(sql`lower(${schema.requestRecipients.email}) = ${email}`);
    if (!mine.length) return { email, requests: [] as RetrievableRequest[] };
    const reqs = await tx
      .select()
      .from(schema.signingRequests)
      .where(
        inArray(
          schema.signingRequests.id,
          mine.map((m) => m.requestId),
        ),
      )
      .orderBy(desc(schema.signingRequests.createdAt));
    return {
      email,
      requests: reqs.map((r): RetrievableRequest => {
        const me = mine.find((m) => m.requestId === r.id)!;
        const settings = documentSettingsSchema.parse(r.settings);
        return {
          requestId: r.id,
          recipientId: me.id,
          title: r.title,
          senderName: r.senderName,
          workspaceName: r.workspaceName,
          status: r.status,
          isTest: r.isTest,
          sentAt: r.sentAt,
          completedAt: r.completedAt,
          canDownload:
            r.status === 'completed' && settings.allowDownload && Boolean(r.signedFileId),
          awaitingYou:
            OPEN.includes(r.status) &&
            ['notified', 'viewed'].includes(me.status) &&
            me.role !== 'cc',
        };
      }),
    };
  });
}

/** Downloads the signed copy or certificate of a completed request, and records the retrieval. */
export async function readRetrievedFile(
  db: Database,
  storage: ObjectStorage,
  token: string | undefined,
  requestId: string,
  kind: 'signed' | 'certificate',
  meta: Meta = {},
  purpose: 'download' | 'view' = 'download',
) {
  if (!z.string().uuid().safeParse(requestId).success) throw new AppError('not_found', 'Not found');
  const hash = sessionHash(token);
  const { file, req, recipientId } = await withRetrieval(db, hash, async (tx) => {
    const email = await requireEmail(tx);
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    const id = kind === 'signed' ? req?.signedFileId : req?.certificateFileId;
    if (!req || !id || req.status !== 'completed') throw new AppError('not_found', 'Not found');
    // The file policy also checks the sender allowed downloads and the files were not purged.
    const [file] = await tx
      .select()
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.id, id));
    if (!file) throw new AppError('not_found', 'This document is not available for download.');
    const [me] = await tx
      .select({ id: schema.requestRecipients.id })
      .from(schema.requestRecipients)
      .where(
        and(
          eq(schema.requestRecipients.requestId, requestId),
          sql`lower(${schema.requestRecipients.email}) = ${email}`,
        ),
      );
    return { file, req, recipientId: me!.id };
  });
  const bytes = await storage.get(file.storageKey);
  if (sha256Hex(bytes) !== file.sha256)
    throw new Error(`Integrity check failed for file ${file.id}`);
  await withRetrieval(db, hash, (tx) =>
    appendEvidenceEvent(tx, {
      requestId,
      workspaceId: req.workspaceId,
      recipientId,
      type: purpose === 'view' ? 'recipient.viewed_copy' : 'recipient.retrieved',
      data: { kind, via: 'verified_email' },
      ...meta,
    }),
  );
  return { bytes, filename: file.originalFilename };
}

/**
 * Issues a fresh signing link to a verified recipient whose turn it is (lost or expired link).
 * The old link stops working. Returns the invitation to email to that same address.
 */
export async function reissueSigningLink(
  db: Database,
  token: string | undefined,
  requestId: string,
  meta: Meta = {},
): Promise<{
  invitation: Invitation;
  title: string;
  senderName: string;
  workspaceName: string;
  isTest: boolean;
}> {
  if (!z.string().uuid().safeParse(requestId).success) throw new AppError('not_found', 'Not found');
  const days = await getConfigValue(db, 'signing.link_valid_days', 30);
  return withRetrieval(db, sessionHash(token), async (tx) => {
    const email = await requireEmail(tx);
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (!req) throw new AppError('not_found', 'Not found');
    const [me] = await tx
      .select()
      .from(schema.requestRecipients)
      .where(
        and(
          eq(schema.requestRecipients.requestId, requestId),
          sql`lower(${schema.requestRecipients.email}) = ${email}`,
        ),
      );
    if (
      !me ||
      !OPEN.includes(req.status) ||
      !['notified', 'viewed'].includes(me.status) ||
      me.role === 'cc'
    )
      throw new AppError('conflict', 'This request is not waiting for you.');
    const fresh = newSecret();
    const expiresAt = req.expiresAt ?? new Date(Date.now() + days * 86_400_000);
    await tx
      .update(schema.requestRecipients)
      .set({
        tokenHash: hashSecret(fresh),
        tokenExpiresAt: expiresAt,
        sessionHash: null,
        sessionExpiresAt: null,
      })
      .where(eq(schema.requestRecipients.id, me.id));
    await appendEvidenceEvent(tx, {
      requestId,
      workspaceId: req.workspaceId,
      recipientId: me.id,
      type: 'recipient.link_reissued',
      data: { via: 'verified_email' },
      ...meta,
    });
    return {
      invitation: {
        recipientId: me.id,
        name: me.name,
        email: me.email,
        token: fresh,
        kind: 'sign',
      },
      title: req.title,
      senderName: req.senderName,
      workspaceName: req.workspaceName,
      isTest: req.isTest,
    };
  });
}

export interface RetrievedRequestView {
  email: string;
  request: {
    id: string;
    title: string;
    senderName: string;
    workspaceName: string;
    status: string;
    isTest: boolean;
    sentAt: Date | null;
    completedAt: Date | null;
  };
  /** Completed and the sender allowed downloads: the signed copy and certificate can be opened. */
  canOpenFiles: boolean;
  files: { kind: 'signed' | 'certificate'; sha256: string; pageCount: number | null }[];
  signers: {
    name: string;
    role: string;
    status: string;
    signingOrder: number;
    signedAt: Date | null;
  }[];
  events: { at: Date; type: string; hash: string }[];
}

/**
 * One request as a verified recipient may see it: status, the other participants' progress
 * (names and roles only), fingerprints of the completed files and the evidence event list.
 */
export async function getRetrievedRequest(
  db: Database,
  token: string | undefined,
  requestId: string,
): Promise<RetrievedRequestView> {
  if (!z.string().uuid().safeParse(requestId).success) throw new AppError('not_found', 'Not found');
  return withRetrieval(db, sessionHash(token), async (tx) => {
    const email = await requireEmail(tx);
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (!req) throw new AppError('not_found', 'This document is not available to this address.');
    const fileIds = [req.signedFileId, req.certificateFileId].filter(Boolean) as string[];
    // Visible only when completed, downloads are allowed and the files were not purged.
    const files = fileIds.length
      ? await tx
          .select()
          .from(schema.documentFiles)
          .where(inArray(schema.documentFiles.id, fileIds))
      : [];
    const signers = (await tx.execute(
      sql`select * from st_retrieval_signers(${requestId}::uuid)`,
    )) as unknown as {
      name: string;
      role: string;
      status: string;
      signing_order: number;
      signed_at: string | Date | null;
    }[];
    const events = await tx
      .select({
        at: schema.signingEvents.createdAt,
        type: schema.signingEvents.type,
        hash: schema.signingEvents.hash,
      })
      .from(schema.signingEvents)
      .where(eq(schema.signingEvents.requestId, requestId))
      .orderBy(asc(schema.signingEvents.seq));
    return {
      email,
      request: {
        id: req.id,
        title: req.title,
        senderName: req.senderName,
        workspaceName: req.workspaceName,
        status: req.status,
        isTest: req.isTest,
        sentAt: req.sentAt,
        completedAt: req.completedAt,
      },
      canOpenFiles:
        req.status === 'completed' && files.length === fileIds.length && files.length > 0,
      files: files.map((f) => ({
        kind: f.id === req.certificateFileId ? ('certificate' as const) : ('signed' as const),
        sha256: f.sha256,
        pageCount: f.pageCount,
      })),
      signers: signers.map((s) => ({
        name: s.name,
        role: s.role,
        status: s.status,
        signingOrder: s.signing_order,
        signedAt: s.signed_at ? new Date(s.signed_at) : null,
      })),
      events,
    };
  });
}

/** The verified address of a retrieval session, or null when there is no valid session. */
export async function retrievalSessionEmail(db: Database, token: string | undefined) {
  if (!token || !isPlausibleSecret(token)) return null;
  return withRetrieval(db, hashSecret(token), async (tx) => {
    const [row] = (await tx.execute(sql`select st_retrieval_email() as email`)) as unknown as {
      email: string | null;
    }[];
    return row?.email ?? null;
  });
}
