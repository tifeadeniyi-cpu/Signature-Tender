import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withActor, type Database, type ActorContext, type Tx } from '@st/db';
import { AppError } from './errors';
import { listDocumentNotifications } from './notifications';
import { recordAudit } from './audit';
import { getConfigValue, isFeatureEnabled, type AppEnv } from './config';
import { documentSettingsSchema } from './documents';
import type { ObjectStorage } from './storage';
import { sha256Hex } from './signing-crypto';

/**
 * Document management and retrieval for signed-in members (spec Parts 8, 16 and 17): searching the
 * library, archiving, version history, activity, restoring deleted drafts, retention and legal hold.
 * Everything runs as the actor, so row-level security decides what each person can see.
 */

type Meta = { ipAddress?: string | null; userAgent?: string | null };
const uuid = z.string().uuid();

// ---------------------------------------------------------------------------------------------
// Library list

/** Tabs from spec Part 8. Each document is in exactly one, based on its latest request. */
export const LIBRARY_TABS = [
  'all',
  'in_progress',
  'completed',
  'pending',
  'expired',
  'drafts',
  'declined',
  'cancelled',
  'archived',
] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

const BUCKET_SQL = sql`case
  when d.archived_at is not null then 'archived'
  when lr.status is null then 'drafts'
  when lr.status in ('awaiting_payment','payment_processing','ready_to_dispatch','queued') then 'pending'
  when lr.status in ('sent','in_progress','awaiting_approval','finalization_failed') then 'in_progress'
  else lr.status::text end`;

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal('').transform(() => undefined));

export const libraryQuery = z.object({
  tab: z.enum(LIBRARY_TABS).catch('all'),
  q: z.string().trim().max(200).optional().default(''),
  type: z.string().max(40).optional().default(''),
  owner: z.enum(['all', 'me']).catch('all'),
  sentFrom: dateStr,
  sentTo: dateStr,
  completedFrom: dateStr,
  completedTo: dateStr,
  sort: z.enum(['activity', 'title', 'sent', 'expires', 'created']).catch('activity'),
  dir: z.enum(['asc', 'desc']).catch('desc'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type LibraryQuery = Partial<z.input<typeof libraryQuery>>;

export const LIBRARY_PAGE_SIZE = 25;

export interface LibraryRow {
  id: string;
  title: string;
  documentType: string;
  status: string;
  pageCount: number | null;
  ownerName: string | null;
  createdBy: string;
  signers: string | null;
  recipientCount: number;
  requestId: string | null;
  requestStatus: string | null;
  isTest: boolean | null;
  sentAt: Date | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  lastActivity: Date;
  bucket: LibraryTab;
  canDownload: boolean;
}

/** Searches the workspace library with tabs, filters, sorting and pagination. */
export async function searchLibrary(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: LibraryQuery,
) {
  if (!uuid.safeParse(workspaceId).success) throw new AppError('not_found', 'Workspace not found');
  const f = libraryQuery.parse(raw);
  return withActor(db, actor, async (tx) => {
    const conds = [sql`d.workspace_id = ${workspaceId}::uuid`, sql`d.deleted_at is null`];
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      // The short reference shown in the documents drawer, e.g. ST-1A2B3C4D or #ST-1A2B3C4D.
      const ref = /^#?ST-([0-9a-f]{8})$/i.exec(f.q)?.[1]?.toLowerCase() ?? null;
      conds.push(sql`(d.title ilike ${like}
        or d.id::text = ${f.q.toLowerCase()}
        or (${ref}::text is not null and d.id::text like ${ref ? `${ref}%` : ''})
        or exists (select 1 from document_recipients r where r.document_id = d.id
                   and (r.name ilike ${like} or r.email ilike ${like})))`);
    }
    if (f.type) conds.push(sql`d.document_type = ${f.type}`);
    if (f.owner === 'me') conds.push(sql`d.created_by = ${actor.userId}`);
    if (f.sentFrom) conds.push(sql`lr.sent_at >= ${f.sentFrom}::date`);
    if (f.sentTo) conds.push(sql`lr.sent_at < (${f.sentTo}::date + 1)`);
    if (f.completedFrom) conds.push(sql`lr.completed_at >= ${f.completedFrom}::date`);
    if (f.completedTo) conds.push(sql`lr.completed_at < (${f.completedTo}::date + 1)`);
    const where = sql.join(conds, sql` and `);
    const from = sql`from documents d
      left join lateral (select * from signing_requests sr where sr.document_id = d.id
                         order by sr.created_at desc limit 1) lr on true`;

    const countRows = (await tx.execute(sql`
      select ${BUCKET_SQL} as bucket, count(*)::int as n ${from} where ${where} group by 1
    `)) as unknown as { bucket: LibraryTab; n: number }[];
    const counts = Object.fromEntries(LIBRARY_TABS.map((t) => [t, 0])) as Record<
      LibraryTab,
      number
    >;
    for (const r of countRows) counts[r.bucket] = r.n;
    counts.all = LIBRARY_TABS.filter((t) => t !== 'all' && t !== 'archived').reduce(
      (s, t) => s + counts[t],
      0,
    );

    const tabCond =
      f.tab === 'all' ? sql`${BUCKET_SQL} <> 'archived'` : sql`${BUCKET_SQL} = ${f.tab}`;
    const dir = f.dir === 'asc' ? sql`asc` : sql`desc`;
    const order = {
      activity: sql`last_activity ${dir}`,
      title: sql`lower(d.title) ${dir}`,
      sent: sql`lr.sent_at ${dir} nulls last`,
      expires: sql`lr.expires_at ${dir} nulls last`,
      created: sql`d.created_at ${dir}`,
    }[f.sort];
    const offset = (f.page - 1) * LIBRARY_PAGE_SIZE;
    const rows = (await tx.execute(sql`
      select d.id, d.title, d.document_type, d.status, d.page_count, d.created_by,
        (select u.name from "user" u where u.id = d.created_by) as owner_name,
        (select string_agg(r.name, ', ' order by r.signing_order, r.created_at)
           from document_recipients r where r.document_id = d.id and r.role = 'signer') as signers,
        (select count(*)::int from document_recipients r where r.document_id = d.id) as recipient_count,
        lr.id as request_id, lr.status::text as request_status, lr.is_test, lr.sent_at, lr.expires_at,
        lr.completed_at, (lr.status = 'completed' and lr.signed_file_id is not null
          and d.purged_at is null) as can_download,
        greatest(d.updated_at, coalesce(lr.updated_at, d.updated_at)) as last_activity,
        ${BUCKET_SQL} as bucket
      ${from}
      where ${where} and ${tabCond}
      order by ${order}, d.id
      limit ${LIBRARY_PAGE_SIZE} offset ${offset}
    `)) as unknown as Record<string, unknown>[];
    const total = f.tab === 'all' ? counts.all : counts[f.tab];
    const date = (v: unknown) => (v ? new Date(v as string) : null);
    return {
      query: f,
      counts,
      total,
      pages: Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE)),
      rows: rows.map((r): LibraryRow => ({
        id: r.id as string,
        title: r.title as string,
        documentType: r.document_type as string,
        status: r.status as string,
        pageCount: (r.page_count as number | null) ?? null,
        ownerName: (r.owner_name as string | null) ?? null,
        createdBy: r.created_by as string,
        signers: (r.signers as string | null) ?? null,
        recipientCount: r.recipient_count as number,
        requestId: (r.request_id as string | null) ?? null,
        requestStatus: (r.request_status as string | null) ?? null,
        isTest: (r.is_test as boolean | null) ?? null,
        sentAt: date(r.sent_at),
        expiresAt: date(r.expires_at),
        completedAt: date(r.completed_at),
        lastActivity: date(r.last_activity)!,
        bucket: r.bucket as LibraryTab,
        canDownload: Boolean(r.can_download),
      })),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Archive and restore

async function latestRequest(tx: Tx, documentId: string) {
  const [r] = await tx
    .select()
    .from(schema.signingRequests)
    .where(eq(schema.signingRequests.documentId, documentId))
    .orderBy(desc(schema.signingRequests.createdAt))
    .limit(1);
  return r ?? null;
}

const OPEN = [
  'awaiting_payment',
  'payment_processing',
  'ready_to_dispatch',
  'queued',
  'sent',
  'in_progress',
  'awaiting_approval',
  'finalization_failed',
];

/** Archives or unarchives a document. Open requests must finish or be cancelled first. */
export async function setArchived(
  db: Database,
  actor: ActorContext,
  documentId: string,
  archived: boolean,
  meta: Meta = {},
) {
  if (!uuid.safeParse(documentId).success) throw new AppError('not_found', 'Document not found');
  await withActor(db, actor, async (tx) => {
    const [doc] = await tx
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.id, documentId), isNull(schema.documents.deletedAt)));
    if (!doc) throw new AppError('not_found', 'Document not found');
    const req = await latestRequest(tx, documentId);
    if (archived && req && OPEN.includes(req.status))
      throw new AppError('conflict', 'Finish or cancel the open signing request before archiving.');
    const res = await tx
      .update(schema.documents)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(schema.documents.id, documentId))
      .returning({ id: schema.documents.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow archiving this document.');
    await recordAudit(tx, {
      workspaceId: doc.workspaceId,
      actorUserId: actor.userId,
      action: archived ? 'document.archived' : 'document.unarchived',
      targetType: 'document',
      targetId: documentId,
      ...meta,
    });
  });
}

/** Deleted drafts that can still be restored. */
export async function listDeletedDrafts(db: Database, actor: ActorContext, workspaceId: string) {
  const days = await getConfigValue(db, 'retention.deleted_draft_days', 30);
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await withActor(db, actor, (tx) =>
    tx
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        deletedAt: schema.documents.deletedAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.workspaceId, workspaceId),
          isNotNull(schema.documents.deletedAt),
          isNull(schema.documents.purgedAt),
          sql`${schema.documents.deletedAt} >= ${since.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(desc(schema.documents.deletedAt)),
  );
  return rows.map((r) => ({
    ...r,
    restorableUntil: new Date(r.deletedAt!.getTime() + days * 86_400_000),
  }));
}

export async function restoreDeletedDraft(
  db: Database,
  actor: ActorContext,
  documentId: string,
  meta: Meta = {},
) {
  if (!uuid.safeParse(documentId).success) throw new AppError('not_found', 'Document not found');
  const days = await getConfigValue(db, 'retention.deleted_draft_days', 30);
  await withActor(db, actor, async (tx) => {
    const [doc] = await tx
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    if (!doc || !doc.deletedAt || doc.purgedAt)
      throw new AppError('not_found', 'Document not found');
    if (doc.deletedAt.getTime() < Date.now() - days * 86_400_000)
      throw new AppError('conflict', 'This draft was deleted too long ago to restore.');
    const res = await tx
      .update(schema.documents)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(schema.documents.id, documentId))
      .returning({ id: schema.documents.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow restoring this draft.');
    await recordAudit(tx, {
      workspaceId: doc.workspaceId,
      actorUserId: actor.userId,
      action: 'document.draft_restored',
      targetType: 'document',
      targetId: documentId,
      ...meta,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Retention and legal hold

async function retentionDaysFor(tx: Tx, workspaceId: string, documentType: string) {
  const rows = await tx
    .select()
    .from(schema.retentionPolicies)
    .where(eq(schema.retentionPolicies.workspaceId, workspaceId));
  const specific = rows.find((r) => r.documentType === documentType);
  const fallback = rows.find((r) => r.documentType === null);
  if (specific) return { days: specific.retainDays, source: 'type' as const };
  if (fallback) return { days: fallback.retainDays, source: 'workspace' as const };
  return {
    days: await getConfigValue(tx as unknown as Database, 'retention.default_days', 2555),
    source: 'platform' as const,
  };
}

export interface RetentionStatus {
  days: number;
  source: 'type' | 'workspace' | 'platform';
  /** When the retention period ends; null until the record is completed or otherwise closed. */
  keepUntil: Date | null;
  legalHold: boolean;
  legalHoldReason: string | null;
  purgedAt: Date | null;
  eligibleForDeletion: boolean;
}

async function retentionFor(
  tx: Tx,
  doc: typeof schema.documents.$inferSelect,
): Promise<RetentionStatus> {
  const policy = await retentionDaysFor(tx, doc.workspaceId, doc.documentType);
  const req = await latestRequest(tx, doc.id);
  const closed = req?.completedAt ?? req?.closedAt ?? null;
  const keepUntil = closed ? new Date(closed.getTime() + policy.days * 86_400_000) : null;
  return {
    ...policy,
    keepUntil,
    legalHold: doc.legalHold,
    legalHoldReason: doc.legalHoldReason,
    purgedAt: doc.purgedAt,
    eligibleForDeletion:
      !doc.legalHold && !doc.purgedAt && Boolean(keepUntil && keepUntil.getTime() < Date.now()),
  };
}

export async function getRetentionPolicies(db: Database, actor: ActorContext, workspaceId: string) {
  const platformDays = await getConfigValue(db, 'retention.default_days', 2555);
  const minDays = await getConfigValue(db, 'retention.min_days', 365);
  const rows = await withActor(db, actor, (tx) =>
    tx
      .select()
      .from(schema.retentionPolicies)
      .where(eq(schema.retentionPolicies.workspaceId, workspaceId))
      .orderBy(asc(schema.retentionPolicies.documentType)),
  );
  return { platformDays, minDays, policies: rows };
}

/** Sets (or with `days: null` removes) the retention period for one document type or the default. */
export async function setRetentionPolicy(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  input: { documentType: string | null; days: number | null },
  meta: Meta = {},
) {
  const minDays = await getConfigValue(db, 'retention.min_days', 365);
  const days =
    input.days === null
      ? null
      : z
          .number()
          .int()
          .min(minDays, `Keep records for at least ${minDays} days.`)
          .max(36_500, 'Choose 100 years or less.')
          .parse(input.days);
  const documentType = input.documentType
    ? z.string().min(1).max(40).parse(input.documentType)
    : null;
  await withActor(db, actor, async (tx) => {
    const [ok] = (await tx.execute(
      sql`select st_has_permission(${workspaceId}::uuid, 'workspace.manage') as ok`,
    )) as unknown as { ok: boolean }[];
    if (!ok?.ok)
      throw new AppError('forbidden', 'Only workspace owners and admins can change retention.');
    const match = documentType
      ? eq(schema.retentionPolicies.documentType, documentType)
      : isNull(schema.retentionPolicies.documentType);
    const where = and(eq(schema.retentionPolicies.workspaceId, workspaceId), match);
    const [existing] = await tx.select().from(schema.retentionPolicies).where(where);
    if (days === null) {
      if (existing) await tx.delete(schema.retentionPolicies).where(where);
    } else if (existing) {
      await tx
        .update(schema.retentionPolicies)
        .set({ retainDays: days, updatedBy: actor.userId, updatedAt: new Date() })
        .where(where);
    } else {
      await tx
        .insert(schema.retentionPolicies)
        .values({ workspaceId, documentType, retainDays: days, updatedBy: actor.userId });
    }
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'workspace.retention_changed',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: { documentType, days },
      ...meta,
    });
  });
}

/** Places or lifts a legal hold. Requires workspace.manage. */
export async function setLegalHold(
  db: Database,
  actor: ActorContext,
  documentId: string,
  input: { hold: boolean; reason?: string },
  meta: Meta = {},
) {
  if (!uuid.safeParse(documentId).success) throw new AppError('not_found', 'Document not found');
  const reason = z
    .string()
    .trim()
    .max(500)
    .parse(input.reason ?? '');
  if (input.hold && !reason) throw new AppError('invalid', 'Give a reason for the legal hold.');
  await withActor(db, actor, async (tx) => {
    const [doc] = await tx
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    if (!doc) throw new AppError('not_found', 'Document not found');
    const [ok] = (await tx.execute(
      sql`select st_has_permission(${doc.workspaceId}::uuid, 'workspace.manage') as ok`,
    )) as unknown as { ok: boolean }[];
    if (!ok?.ok)
      throw new AppError('forbidden', 'Only workspace owners and admins can set a legal hold.');
    await tx
      .update(schema.documents)
      .set({ legalHold: input.hold, legalHoldReason: input.hold ? reason : null })
      .where(eq(schema.documents.id, documentId));
    await recordAudit(tx, {
      workspaceId: doc.workspaceId,
      actorUserId: actor.userId,
      action: input.hold ? 'document.legal_hold_placed' : 'document.legal_hold_lifted',
      targetType: 'document',
      targetId: documentId,
      metadata: input.hold ? { reason } : {},
      ...meta,
    });
  });
}

/**
 * Removes the stored files of a record whose retention period has ended. Metadata, hashes and the
 * evidence log stay, and the deletion itself is audited. Refused under legal hold, before the
 * period ends, and while the `retention_deletion` flag is off.
 */
export async function purgeExpiredRecord(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  documentId: string,
  env: AppEnv,
  meta: Meta = {},
) {
  if (!(await isFeatureEnabled(db, 'retention_deletion', env)))
    throw new AppError(
      'forbidden',
      'Deleting records after their retention period is not switched on yet.',
    );
  if (!uuid.safeParse(documentId).success) throw new AppError('not_found', 'Document not found');
  const keys = await withActor(db, actor, async (tx) => {
    const [doc] = await tx
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .for('update');
    if (!doc) throw new AppError('not_found', 'Document not found');
    const [ok] = (await tx.execute(
      sql`select st_has_permission(${doc.workspaceId}::uuid, 'workspace.manage') as ok`,
    )) as unknown as { ok: boolean }[];
    if (!ok?.ok)
      throw new AppError('forbidden', 'Only workspace owners and admins can delete records.');
    const status = await retentionFor(tx, doc);
    if (doc.legalHold) throw new AppError('conflict', 'This record is under legal hold.');
    if (!status.eligibleForDeletion)
      throw new AppError('conflict', 'This record is still within its retention period.');
    const files = await tx
      .select({
        key: schema.documentFiles.storageKey,
        sha: schema.documentFiles.sha256,
        kind: schema.documentFiles.kind,
      })
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.documentId, documentId));
    await tx
      .update(schema.documents)
      .set({ purgedAt: new Date(), archivedAt: doc.archivedAt ?? new Date() })
      .where(eq(schema.documents.id, documentId));
    await recordAudit(tx, {
      workspaceId: doc.workspaceId,
      actorUserId: actor.userId,
      action: 'document.files_deleted',
      targetType: 'document',
      targetId: documentId,
      metadata: {
        reason: 'retention_expired',
        keepUntil: status.keepUntil?.toISOString(),
        files: files.map((f) => ({ kind: f.kind, sha256: f.sha })),
      },
      ...meta,
    });
    return files.map((f) => f.key);
  });
  // Files go after the record says so; a failed delete leaves an orphan, never a dangling record.
  for (const k of keys) await storage.delete(k).catch(() => undefined);
  return { deletedFiles: keys.length };
}

// ---------------------------------------------------------------------------------------------
// Details: versions, activity and retention for the document page

export interface ActivityItem {
  at: Date;
  source: 'evidence' | 'audit' | 'email';
  type: string;
  actorName: string | null;
  recipientName: string | null;
  ipAddress: string | null;
  requestId: string | null;
  data: Record<string, unknown>;
}

export async function getDocumentRecord(db: Database, actor: ActorContext, documentId: string) {
  if (!uuid.safeParse(documentId).success) throw new AppError('not_found', 'Document not found');
  return withActor(db, actor, async (tx) => {
    const [doc] = await tx
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.id, documentId), isNull(schema.documents.deletedAt)));
    if (!doc) throw new AppError('not_found', 'Document not found');
    const files = await tx
      .select({
        id: schema.documentFiles.id,
        version: schema.documentFiles.version,
        kind: schema.documentFiles.kind,
        originalFilename: schema.documentFiles.originalFilename,
        sizeBytes: schema.documentFiles.sizeBytes,
        sha256: schema.documentFiles.sha256,
        pageCount: schema.documentFiles.pageCount,
        createdAt: schema.documentFiles.createdAt,
      })
      .from(schema.documentFiles)
      .where(eq(schema.documentFiles.documentId, documentId))
      .orderBy(asc(schema.documentFiles.createdAt));
    const requests = await tx
      .select({
        id: schema.signingRequests.id,
        status: schema.signingRequests.status,
        isTest: schema.signingRequests.isTest,
        sourceFileId: schema.signingRequests.sourceFileId,
        sourceSha256: schema.signingRequests.sourceSha256,
        signedFileId: schema.signingRequests.signedFileId,
        certificateFileId: schema.signingRequests.certificateFileId,
        createdAt: schema.signingRequests.createdAt,
        sentAt: schema.signingRequests.sentAt,
        completedAt: schema.signingRequests.completedAt,
        closedAt: schema.signingRequests.closedAt,
      })
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.documentId, documentId))
      .orderBy(asc(schema.signingRequests.createdAt));
    const reqIds = requests.map((r) => r.id);
    const recips = reqIds.length
      ? await tx
          .select({ id: schema.requestRecipients.id, name: schema.requestRecipients.name })
          .from(schema.requestRecipients)
          .where(inArray(schema.requestRecipients.requestId, reqIds))
      : [];
    const events = reqIds.length
      ? await tx
          .select()
          .from(schema.signingEvents)
          .where(inArray(schema.signingEvents.requestId, reqIds))
          .orderBy(asc(schema.signingEvents.seq))
      : [];
    // Audit rows are visible to people with audit.view, plus each person's own actions.
    const audits = await tx
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.targetType, 'document'),
          eq(schema.auditEvents.targetId, documentId),
        ),
      )
      .orderBy(asc(schema.auditEvents.occurredAt))
      .limit(500);
    const userIds = [
      ...new Set(
        [
          doc.createdBy,
          ...events.map((e) => e.actorUserId),
          ...audits.map((a) => a.actorUserId),
        ].filter(Boolean),
      ),
    ] as string[];
    const users = userIds.length
      ? await tx
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, userIds))
      : [];
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const recipName = new Map(recips.map((r) => [r.id, r.name]));
    const activity: ActivityItem[] = [
      ...events.map((e) => ({
        at: e.createdAt,
        source: 'evidence' as const,
        type: e.type,
        actorName: e.actorUserId ? (nameOf.get(e.actorUserId) ?? null) : null,
        recipientName: e.recipientId ? (recipName.get(e.recipientId) ?? null) : null,
        ipAddress: e.ipAddress,
        requestId: e.requestId,
        data: (e.data ?? {}) as Record<string, unknown>,
      })),
      // Sending is already in the evidence log; keep only the audit actions it does not cover.
      ...audits
        .filter(
          (a) =>
            !['document.sent', 'document.awaiting_payment', 'document.request_cancelled'].includes(
              a.action,
            ),
        )
        .map((a) => ({
          at: a.occurredAt,
          source: 'audit' as const,
          type: a.action,
          actorName: a.actorUserId ? (nameOf.get(a.actorUserId) ?? null) : null,
          recipientName: null,
          ipAddress: a.ipAddress,
          requestId:
            (((a.metadata ?? {}) as Record<string, unknown>).requestId as string | null) ?? null,
          data: (a.metadata ?? {}) as Record<string, unknown>,
        })),
      // Transactional email: queued, sent, delivered (accepted by the receiving server), failed.
      ...(await listDocumentNotifications(tx, documentId)).flatMap((n) => {
        const base = {
          source: 'email' as const,
          actorName: null,
          recipientName: n.toName,
          ipAddress: null,
          requestId: n.requestId,
          data: {
            template: n.template,
            templateVersion: n.templateVersion,
            to: n.toEmail,
            attempts: n.attempts,
            ...(n.lastError ? { error: n.lastError } : {}),
          } as Record<string, unknown>,
        };
        const out: ActivityItem[] = [{ ...base, at: n.queuedAt, type: 'email.queued' }];
        if (n.sentAt) out.push({ ...base, at: n.sentAt, type: 'email.sent' });
        if (n.deliveredAt) out.push({ ...base, at: n.deliveredAt, type: 'email.delivered' });
        if (n.failedAt)
          out.push({
            ...base,
            at: n.failedAt,
            type: n.status === 'bounced' ? 'email.bounced' : 'email.failed',
          });
        return out;
      }),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    const canManage = (
      (await tx.execute(
        sql`select st_has_permission(${doc.workspaceId}::uuid, 'workspace.manage') as ok`,
      )) as unknown as { ok: boolean }[]
    )[0]?.ok;
    return {
      document: { ...doc, settings: documentSettingsSchema.parse(doc.settings ?? {}) },
      ownerName: nameOf.get(doc.createdBy) ?? null,
      files,
      requests,
      activity,
      retention: await retentionFor(tx, doc),
      canManage: Boolean(canManage),
    };
  });
}

/** Streams one stored file version of a document after an RLS-checked lookup; logs the access. */
export async function readDocumentVersion(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  documentId: string,
  fileId: string,
  meta: Meta = {},
  purpose: 'view' | 'download' = 'download',
) {
  if (!uuid.safeParse(documentId).success || !uuid.safeParse(fileId).success)
    throw new AppError('not_found', 'File not found');
  const { file, doc } = await withActor(db, actor, async (tx) => {
    const [doc] = await tx
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    if (!doc || doc.deletedAt) throw new AppError('not_found', 'File not found');
    if (doc.purgedAt)
      throw new AppError(
        'not_found',
        'The files for this record were deleted after its retention period.',
      );
    const [file] = await tx
      .select()
      .from(schema.documentFiles)
      .where(
        and(eq(schema.documentFiles.id, fileId), eq(schema.documentFiles.documentId, documentId)),
      );
    if (!file) throw new AppError('not_found', 'File not found');
    if (file.kind !== 'original') {
      const [req] = await tx
        .select({ status: schema.signingRequests.status })
        .from(schema.signingRequests)
        .where(
          sql`${schema.signingRequests.signedFileId} = ${fileId}::uuid or ${schema.signingRequests.certificateFileId} = ${fileId}::uuid`,
        );
      if (req?.status !== 'completed') throw new AppError('not_found', 'File not found');
    }
    return { file, doc };
  });
  const bytes = await storage.get(file.storageKey);
  if (sha256Hex(bytes) !== file.sha256)
    throw new Error(`Integrity check failed for file ${file.id}`);
  await withActor(db, actor, (tx) =>
    recordAudit(tx, {
      workspaceId: doc.workspaceId,
      actorUserId: actor.userId,
      action: purpose === 'view' ? 'document.file_viewed' : 'document.file_downloaded',
      targetType: 'document',
      targetId: documentId,
      metadata: { fileId, kind: file.kind, version: file.version },
      ...meta,
    }),
  );
  const suffix = file.kind === 'original' ? '' : `-${file.kind}`;
  return {
    bytes,
    filename: file.originalFilename.replace(/\.pdf$/i, '') + suffix + '.pdf',
  };
}
