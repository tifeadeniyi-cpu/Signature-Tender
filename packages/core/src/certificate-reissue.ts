import { asc, eq, sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { schema, withCertificateSystem, type Database, type ActorContext } from '@st/db';
import { AppError } from './errors';
import type { ObjectStorage } from './storage';
import { GENESIS_HASH, sha256Hex } from './signing-crypto';
import { signatureBlockSettings } from './documents';
import { appendEvent, signingEventRef } from './signing';
import { isPlatformAdmin } from './admin';
import { documentReferenceOf } from './library';
import { buildCompletionCertificate, buildCompletionPackage, pageSizeFor } from './certificate-pdf';
import {
  certificateEvents,
  certificateSigners,
  newVerificationRef,
  nextCertificateNumber,
} from './certificate';

/**
 * Gives completed requests that still carry an old-design certificate a new Certificate of
 * Completion, built from the evidence recorded up to completion. The signed agreement, its hash,
 * the recipients and the evidence log are never changed; the old certificate file is kept and the
 * request points at the new one. Each re-issue appends a 'request.certificate_reissued' event.
 * Safe to run repeatedly: a request that already has a certificate number is skipped.
 */

export interface ReissueResult {
  reissued: number;
  skippedPurged: number;
  failed: { requestId: string; error: string }[];
  remaining: number;
}

const ACTING = ['signer', 'approver', 'reviewer'];

export async function countLegacyCertificates(db: Database): Promise<number> {
  const [r] = (await withCertificateSystem(db, (tx) =>
    tx.execute(sql`select count(*)::int as n from signing_requests r
      join documents d on d.id = r.document_id
      where r.status = 'completed' and r.certificate_number is null
        and r.certificate_file_id is not null and d.purged_at is null`),
  )) as unknown as { n: number }[];
  return r?.n ?? 0;
}

export async function reissueCertificates(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  opts: { appUrl: string; limit?: number },
): Promise<ReissueResult> {
  if (!(await isPlatformAdmin(db, actor)))
    throw new AppError('forbidden', 'Signature Tender staff only.');
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const appUrl = opts.appUrl.replace(/\/+$/, '');
  // Look past a few failures (for example a file missing from storage) so they cannot block the
  // queue. Requests whose files were deleted after retention cannot get a new certificate.
  const ids = (await withCertificateSystem(db, (tx) =>
    tx.execute(sql`select r.id from signing_requests r
      join documents d on d.id = r.document_id
      where r.status = 'completed' and r.certificate_number is null
        and r.certificate_file_id is not null and d.purged_at is null
      order by r.completed_at desc
      limit ${limit * 4}`),
  )) as unknown as { id: string }[];
  const result: ReissueResult = { reissued: 0, skippedPurged: 0, failed: [], remaining: 0 };
  for (const { id } of ids) {
    if (result.reissued >= limit) break;
    try {
      const r = await reissueOne(db, storage, actor, id, appUrl);
      if (r === 'purged') result.skippedPurged++;
      else if (r === 'done') result.reissued++;
    } catch (err) {
      result.failed.push({
        requestId: id,
        error: String(err instanceof Error ? err.message : err).slice(0, 300),
      });
    }
  }
  result.remaining = await countLegacyCertificates(db);
  return result;
}

async function reissueOne(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  requestId: string,
  appUrl: string,
): Promise<'done' | 'purged' | 'skipped'> {
  const ev = await withCertificateSystem(db, async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (
      !req ||
      req.status !== 'completed' ||
      req.certificateNumber ||
      !req.signedFileId ||
      !req.certificateFileId ||
      !req.completedAt
    )
      return null;
    const [doc] = await tx
      .select({ purgedAt: schema.documents.purgedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, req.documentId));
    const recips = await tx
      .select()
      .from(schema.requestRecipients)
      .where(eq(schema.requestRecipients.requestId, requestId))
      .orderBy(asc(schema.requestRecipients.signingOrder), asc(schema.requestRecipients.createdAt));
    const fields = await tx
      .select({ signatureId: schema.requestFields.signatureId })
      .from(schema.requestFields)
      .where(eq(schema.requestFields.requestId, requestId));
    const sigs = await tx
      .select({
        id: schema.signatures.id,
        recipientId: schema.signatures.recipientId,
        kind: schema.signatures.kind,
        method: schema.signatures.method,
      })
      .from(schema.signatures)
      .where(eq(schema.signatures.requestId, requestId));
    const events = await tx
      .select()
      .from(schema.signingEvents)
      .where(eq(schema.signingEvents.requestId, requestId))
      .orderBy(asc(schema.signingEvents.seq));
    const files = await tx
      .select()
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.documentId, req.documentId));
    return { req, purged: Boolean(doc?.purgedAt), recips, fields, sigs, events, files };
  });
  if (!ev) return 'skipped';
  if (ev.purged) return 'purged';
  const { req, recips, fields, sigs, events, files } = ev;
  const signedFile = files.find((f) => f.id === req.signedFileId)!;
  const oldCert = files.find((f) => f.id === req.certificateFileId)!;
  const source = files.find((f) => f.id === req.sourceFileId) ?? null;
  const signed = await storage.get(signedFile.storageKey);
  if (sha256Hex(signed) !== signedFile.sha256)
    throw new Error(`Integrity check failed for signed file ${signedFile.id}`);

  // Evidence as it stood at completion: later events (downloads, the completion record itself
  // onwards) are not part of the signing record.
  const completedEvent = events.find((e) => e.type === 'request.completed');
  const evidence = completedEvent ? events.filter((e) => e.seq < completedEvent.seq) : events;
  const completedAt = req.completedAt!;
  const issuedAt = new Date();
  const used = new Set(fields.map((f) => f.signatureId).filter(Boolean));
  const signedDoc = await PDFDocument.load(signed);
  const first = signedDoc.getPage(0).getSize();
  const block = signatureBlockSettings(req.settings);
  const certificateNumber = await withCertificateSystem(db, (tx) =>
    nextCertificateNumber(tx, issuedAt),
  );
  const verificationRef = newVerificationRef();
  const cert = await buildCompletionCertificate({
    pageSize: pageSizeFor(first.width, first.height),
    isTest: req.isTest,
    title: req.title,
    documentRef: documentReferenceOf(req.documentId),
    requestId,
    verificationRef,
    certificateNumber,
    senderName: req.senderName,
    organization: req.workspaceName || null,
    createdAt: source?.createdAt ?? req.createdAt,
    sentAt: req.sentAt,
    completedAt,
    issuedAt,
    reissue: { originalIssuedAt: completedAt, originalSha256: oldCert.sha256 },
    agreementPages: signedDoc.getPageCount(),
    timeZone: block.timeZone,
    signingOrder: req.signingOrderEnabled,
    signers: certificateSigners(
      recips,
      sigs.filter((s) => used.has(s.id)),
      (rid) => signingEventRef(evidence, rid),
    ),
    copyRecipients: recips.filter((r) => !ACTING.includes(r.role)).length,
    events: certificateEvents({
      events: evidence,
      recipients: recips,
      senderName: req.senderName,
      uploadedAt: source?.createdAt ?? null,
      completedAt,
    }),
    evidenceEventCount: evidence.length,
    hashes: {
      signed: signedFile.sha256,
      original: req.sourceSha256,
      chainHead: evidence.at(-1)?.hash ?? GENESIS_HASH,
    },
    verifyUrl: `${appUrl}/verify?ref=${verificationRef}`,
  });
  const certSha = sha256Hex(cert);
  const packageSha = sha256Hex(await buildCompletionPackage(signed, cert));
  const key = `ws/${req.workspaceId}/doc/${req.documentId}/req/${requestId}/certificate-${certSha.slice(0, 16)}.pdf`;
  await storage.put(key, cert, 'application/pdf');

  return withCertificateSystem(db, async (tx) => {
    const [locked] = await tx
      .select({ n: schema.signingRequests.certificateNumber })
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId))
      .for('update');
    if (!locked || locked.n) return 'skipped' as const; // another run got there first
    const [{ v }] = (await tx.execute(
      sql`select coalesce(max(version), 0)::int + 1 as v from document_files where document_id = ${req.documentId}::uuid`,
    )) as unknown as [{ v: number }];
    const safeTitle = req.title.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document';
    const [cf] = await tx
      .insert(schema.documentFiles)
      .values({
        workspaceId: req.workspaceId,
        documentId: req.documentId,
        version: v,
        kind: 'certificate',
        storageKey: key,
        originalFilename: `${safeTitle} (certificate of completion).pdf`,
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
        certificateFileId: cf!.id,
        certificateNumber,
        verificationRef,
        certificateIssuedAt: issuedAt,
        packageSha256: packageSha,
      })
      .where(eq(schema.signingRequests.id, requestId));
    await appendEvent(tx, {
      requestId,
      workspaceId: req.workspaceId,
      actorUserId: actor.userId,
      type: 'request.certificate_reissued',
      data: {
        previousCertificateFileId: oldCert.id,
        previousCertificateSha256: oldCert.sha256,
        certificateSha256: certSha,
        packageSha256: packageSha,
        certificateNumber,
        verificationRef,
      },
    });
    return 'done' as const;
  });
}
