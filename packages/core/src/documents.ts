import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

import { schema, withActor, type Database, type ActorContext, type Tx } from '@st/db';
import { recordAudit } from './audit';
import { AppError } from './errors';
import { getMembership } from './workspaces';
import type { ObjectStorage } from './storage';
import {
  DEFAULT_SIGNATURE_DISPLAY,
  SIGNATURE_DISPLAY_FORMATS,
  validTimeZone,
  type SignatureDisplayFormat,
} from './signature-block/layout';

type Meta = { ipAddress?: string | null; userAgent?: string | null };
export type DocumentStatus = (typeof schema.documentStatus.enumValues)[number];
export type RecipientRole = (typeof schema.recipientRole.enumValues)[number];
export type FieldType = (typeof schema.fieldType.enumValues)[number];

export const DOCUMENT_TYPES = [
  { value: 'agreement', label: 'Agreement' },
  { value: 'contract', label: 'Contract' },
  { value: 'nda', label: 'NDA' },
  { value: 'release', label: 'Release' },
  { value: 'split_sheet', label: 'Split Sheet' },
  { value: 'booking', label: 'Booking' },
  { value: 'employment', label: 'Employment' },
  { value: 'other', label: 'Other' },
] as const;
const documentTypeValues = DOCUMENT_TYPES.map((d) => d.value) as [string, ...string[]];

export const RECIPIENT_ROLES: {
  value: RecipientRole;
  label: string;
  description: string;
  canHaveFields: boolean;
}[] = [
  { value: 'signer', label: 'Sign', description: 'Must sign the document', canHaveFields: true },
  {
    value: 'approver',
    label: 'Approve',
    description: 'Approves before completion',
    canHaveFields: true,
  },
  {
    value: 'reviewer',
    label: 'Review only',
    description: 'Reviews without signing',
    canHaveFields: false,
  },
  {
    value: 'cc',
    label: 'Receive a copy',
    description: 'Gets the completed document',
    canHaveFields: false,
  },
  {
    value: 'viewer',
    label: 'View only',
    description: 'Can view the document',
    canHaveFields: false,
  },
];

/** Allowed preparation-state transitions (spec Part 30). Anything else is rejected. */
const TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  draft: ['uploading', 'processing', 'ready_for_preparation'],
  uploading: ['processing', 'draft'],
  processing: ['ready_for_preparation', 'draft'],
  ready_for_preparation: ['preparing'],
  preparing: ['preparing', 'ready_to_send'],
  ready_to_send: ['preparing'],
};

export function canTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const documentDetailsSchema = z.object({
  title: z.string().trim().min(1, 'Document name is required').max(200),
  documentType: z.enum(documentTypeValues, { message: 'Choose a document type' }),
});

export const documentSettingsSchema = z.object({
  signingMethod: z
    .enum(['electronic_signature', 'initials_only', 'acknowledge'])
    .default('electronic_signature'),
  allowDownload: z.boolean().default(true),
  allowPrint: z.boolean().default(true),
  requireSignerAuth: z.boolean().default(false),
  sendImmediately: z.boolean().default(true),
  reminderEnabled: z.boolean().default(true),
  reminderEveryDays: z.number().int().min(1).max(30).default(3),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
    .nullable()
    .default(null),
  showSigningDate: z.boolean().default(true),
  /** What signature fields show once signed (spec options A-D). D (`full`) is the default. */
  signatureDisplay: z.enum(SIGNATURE_DISPLAY_FORMATS).default(DEFAULT_SIGNATURE_DISPLAY),
  /** IANA time zone for signing times on the document. Filled from the sender's profile at send. */
  timeZone: z
    .string()
    .max(64)
    .nullable()
    .default(null)
    .transform((tz) => (tz && validTimeZone(tz) === tz ? tz : null)),
});
export type DocumentSettings = z.infer<typeof documentSettingsSchema>;

/** Signature block options for a document or request, with defaults applied. */
export function signatureBlockSettings(settings: unknown): {
  format: SignatureDisplayFormat;
  timeZone: string;
} {
  const s = documentSettingsSchema.safeParse(settings ?? {});
  return {
    format: s.success ? s.data.signatureDisplay : DEFAULT_SIGNATURE_DISPLAY,
    timeZone: validTimeZone(s.success ? s.data.timeZone : null),
  };
}

export const recipientInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  role: z.enum(schema.recipientRole.enumValues),
  signingOrder: z.number().int().min(1).max(50),
  authMethod: z.enum(schema.recipientAuth.enumValues).default('email_link'),
});

const fraction = z.number().min(0).max(1);
export const fieldInputSchema = z
  .object({
    recipientId: z.string().uuid(),
    type: z.enum(schema.fieldType.enumValues),
    page: z.number().int().min(1),
    x: fraction,
    y: fraction,
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
    required: z.boolean().default(true),
    label: z.string().trim().max(120).nullable().optional(),
    options: z.array(z.string().trim().min(1).max(80)).max(50).nullable().optional(),
  })
  .refine(
    (f) => f.x + f.width <= 1.0001 && f.y + f.height <= 1.0001,
    'Field must stay inside the page',
  )
  .refine(
    (f) => !['dropdown', 'radio'].includes(f.type) || (f.options?.length ?? 0) >= 2,
    'Add at least two options',
  );

export interface PdfInfo {
  pageCount: number;
  sha256: string;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/** Validates an uploaded file is a readable, unencrypted PDF within limits. Throws AppError('invalid'). */
export async function inspectPdf(
  bytes: Uint8Array,
  limits: { maxBytes: number; maxPages: number },
): Promise<PdfInfo> {
  if (bytes.byteLength === 0) throw new AppError('invalid', 'The file is empty.');
  if (bytes.byteLength > limits.maxBytes) {
    throw new AppError(
      'invalid',
      `The file is larger than ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`,
    );
  }
  // Allow up to 1 KB of leading junk, which the PDF spec tolerates.
  const head = bytes.subarray(0, 1024);
  const start = head.findIndex((_, i) => PDF_MAGIC.every((b, j) => head[i + j] === b));
  if (start < 0) throw new AppError('invalid', 'Only PDF files are supported.');
  let pageCount: number;
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    pageCount = pdf.getPageCount();
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/encrypt/i.test(msg))
      throw new AppError(
        'invalid',
        'This PDF is password-protected. Remove the password and upload it again.',
      );
    throw new AppError('invalid', 'This PDF could not be read. It may be damaged.');
  }
  if (pageCount < 1) throw new AppError('invalid', 'This PDF has no pages.');
  if (pageCount > limits.maxPages)
    throw new AppError('invalid', `This PDF has more than ${limits.maxPages} pages.`);
  return { pageCount, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function requirePermission(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  perm: 'documents.create',
) {
  const m = await getMembership(db, actor, workspaceId);
  if (!m.permissions.includes(perm))
    throw new AppError('forbidden', 'Your role cannot create documents');
  return m;
}

export async function createDocumentFromUpload(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  input: {
    workspaceId: string;
    title: string;
    documentType: string;
    filename: string;
    bytes: Uint8Array;
  },
  limits: { maxBytes: number; maxPages: number },
  meta: Meta = {},
): Promise<{ id: string }> {
  const details = documentDetailsSchema.parse({
    title: input.title,
    documentType: input.documentType,
  });
  await requirePermission(db, actor, input.workspaceId, 'documents.create');
  const info = await inspectPdf(input.bytes, limits);
  const documentId = crypto.randomUUID();
  const key = `ws/${input.workspaceId}/doc/${documentId}/v1/${crypto.randomUUID()}.pdf`;
  await storage.put(key, input.bytes, 'application/pdf');
  try {
    await withActor(db, actor, async (tx) => {
      await tx.insert(schema.documents).values({
        id: documentId,
        workspaceId: input.workspaceId,
        createdBy: actor.userId,
        title: details.title,
        documentType: details.documentType,
        status: 'ready_for_preparation',
        pageCount: info.pageCount,
        settings: documentSettingsSchema.parse({}),
      });
      await tx.insert(schema.documentFiles).values({
        workspaceId: input.workspaceId,
        documentId,
        version: 1,
        storageKey: key,
        originalFilename: input.filename.slice(0, 255) || 'document.pdf',
        contentType: 'application/pdf',
        sizeBytes: input.bytes.byteLength,
        sha256: info.sha256,
        pageCount: info.pageCount,
        createdBy: actor.userId,
      });
      await recordAudit(tx, {
        workspaceId: input.workspaceId,
        actorUserId: actor.userId,
        action: 'document.uploaded',
        targetType: 'document',
        targetId: documentId,
        metadata: { sha256: info.sha256, pages: info.pageCount, bytes: input.bytes.byteLength },
        ...meta,
      });
    });
  } catch (err) {
    await storage.delete(key).catch(() => undefined);
    throw err;
  }
  return { id: documentId };
}

export async function listDocuments(db: Database, actor: ActorContext, workspaceId: string) {
  return withActor(db, actor, (tx) =>
    tx
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        documentType: schema.documents.documentType,
        status: schema.documents.status,
        pageCount: schema.documents.pageCount,
        updatedAt: schema.documents.updatedAt,
        recipientCount: sql<number>`(select count(*)::int from document_recipients r where r.document_id = ${schema.documents.id})`,
        requestStatus: sql<
          string | null
        >`(select sr.status::text from signing_requests sr where sr.document_id = ${schema.documents.id} order by sr.created_at desc limit 1)`,
        requestIsTest: sql<
          boolean | null
        >`(select sr.is_test from signing_requests sr where sr.document_id = ${schema.documents.id} order by sr.created_at desc limit 1)`,
      })
      .from(schema.documents)
      .where(and(eq(schema.documents.workspaceId, workspaceId), isNull(schema.documents.deletedAt)))
      .orderBy(desc(schema.documents.updatedAt))
      .limit(200),
  );
}

async function loadDocument(tx: Tx, documentId: string) {
  const [doc] = await tx
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, documentId), isNull(schema.documents.deletedAt)));
  if (!doc) throw new AppError('not_found', 'Document not found');
  return doc;
}

export async function getDocument(db: Database, actor: ActorContext, documentId: string) {
  if (!z.string().uuid().safeParse(documentId).success)
    throw new AppError('not_found', 'Document not found');
  return withActor(db, actor, async (tx) => {
    const doc = await loadDocument(tx, documentId);
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
      .where(eq(schema.documentFields.documentId, documentId))
      .orderBy(asc(schema.documentFields.page), asc(schema.documentFields.y));
    const canEdit = (await tx.execute(
      sql`select st_can_edit_document(${documentId}::uuid) as ok`,
    )) as unknown as { ok: boolean }[];
    return {
      document: { ...doc, settings: documentSettingsSchema.parse(doc.settings ?? {}) },
      file: file ?? null,
      recipients,
      fields,
      canEdit: Boolean(canEdit[0]?.ok),
    };
  });
}

/** Documents with an open or completed signing request are frozen; edits would change what was sent. */
async function assertNotSent(tx: Tx, documentId: string) {
  const rows = (await tx.execute(
    sql`select 1 from signing_requests where document_id = ${documentId}::uuid and status not in ('declined','expired','cancelled') limit 1`,
  )) as unknown as unknown[];
  if (rows.length)
    throw new AppError('conflict', 'This document has been sent, so it can no longer be changed.');
}

/** Locks the document row for editing; moves it into `preparing` (or back from ready_to_send). */
async function beginEdit(tx: Tx, documentId: string) {
  await loadDocument(tx, documentId); // not_found if invisible to this user
  const editable = (await tx.execute(
    sql`select st_can_edit_document(${documentId}::uuid) as ok`,
  )) as unknown as { ok: boolean }[];
  if (!editable[0]?.ok) throw new AppError('forbidden', 'You cannot edit this document');
  const [doc] = (await tx.execute(
    sql`select status, workspace_id, page_count from documents where id = ${documentId}::uuid and deleted_at is null for update`,
  )) as unknown as { status: DocumentStatus; workspace_id: string; page_count: number | null }[];
  if (!doc) throw new AppError('not_found', 'Document not found');
  if (!canTransition(doc.status, 'preparing'))
    throw new AppError('conflict', 'This document cannot be edited in its current state');
  await assertNotSent(tx, documentId);
  await tx
    .update(schema.documents)
    .set({ status: 'preparing', updatedAt: new Date() })
    .where(eq(schema.documents.id, documentId));
  return { workspaceId: doc.workspace_id, pageCount: doc.page_count ?? 0 };
}

export async function updateDocumentDetails(
  db: Database,
  actor: ActorContext,
  documentId: string,
  input: z.input<typeof documentDetailsSchema>,
  meta: Meta = {},
) {
  const data = documentDetailsSchema.parse(input);
  await withActor(db, actor, async (tx) => {
    const { workspaceId } = await beginEdit(tx, documentId);
    await tx
      .update(schema.documents)
      .set({ title: data.title, documentType: data.documentType })
      .where(eq(schema.documents.id, documentId));
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'document.details_updated',
      targetType: 'document',
      targetId: documentId,
      ...meta,
    });
  });
}

export async function saveRecipients(
  db: Database,
  actor: ActorContext,
  documentId: string,
  input: { signingOrderEnabled: boolean; recipients: z.input<typeof recipientInputSchema>[] },
  limits: { maxSigners: number },
  meta: Meta = {},
) {
  const recipients = z
    .array(recipientInputSchema)
    .max(50, 'Too many recipients')
    .parse(input.recipients);
  const signers = recipients.filter((r) => r.role === 'signer');
  if (signers.length === 0) throw new AppError('invalid', 'Add at least one signer.');
  if (signers.length > limits.maxSigners)
    throw new AppError('invalid', `A signing request includes up to ${limits.maxSigners} signers.`);
  const seen = new Set<string>();
  for (const r of recipients) {
    if (seen.has(r.email))
      throw new AppError(
        'invalid',
        `${r.email} is listed more than once. Each person can appear once.`,
      );
    seen.add(r.email);
  }
  await withActor(db, actor, async (tx) => {
    const { workspaceId } = await beginEdit(tx, documentId);
    const existing = await tx
      .select({ id: schema.documentRecipients.id })
      .from(schema.documentRecipients)
      .where(eq(schema.documentRecipients.documentId, documentId));
    const keep = new Set(recipients.map((r) => r.id).filter(Boolean));
    const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    for (const id of removed)
      await tx.delete(schema.documentRecipients).where(eq(schema.documentRecipients.id, id));
    // Two passes avoid unique-email clashes when people swap rows.
    for (const r of recipients.filter((r) => r.id)) {
      await tx
        .update(schema.documentRecipients)
        .set({ email: `pending+${r.id}@invalid` })
        .where(
          and(
            eq(schema.documentRecipients.id, r.id!),
            eq(schema.documentRecipients.documentId, documentId),
          ),
        );
    }
    for (const [i, r] of recipients.entries()) {
      const values = {
        name: r.name,
        email: r.email,
        role: r.role,
        signingOrder: input.signingOrderEnabled ? r.signingOrder : 1,
        authMethod: r.authMethod,
        colorIndex: i % 8,
      };
      if (r.id && existing.some((e) => e.id === r.id)) {
        await tx
          .update(schema.documentRecipients)
          .set(values)
          .where(eq(schema.documentRecipients.id, r.id));
      } else {
        await tx.insert(schema.documentRecipients).values({ ...values, workspaceId, documentId });
      }
    }
    // Fields assigned to people who can no longer have fields are removed.
    await tx.execute(
      sql`delete from document_fields f using document_recipients r where f.recipient_id = r.id and f.document_id = ${documentId}::uuid and r.role not in ('signer','approver')`,
    );
    await tx
      .update(schema.documents)
      .set({ signingOrderEnabled: input.signingOrderEnabled })
      .where(eq(schema.documents.id, documentId));
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'document.recipients_updated',
      targetType: 'document',
      targetId: documentId,
      metadata: { count: recipients.length, removed: removed.length },
      ...meta,
    });
  });
}

export async function saveFields(
  db: Database,
  actor: ActorContext,
  documentId: string,
  input: z.input<typeof fieldInputSchema>[],
  meta: Meta = {},
) {
  const fields = z.array(fieldInputSchema).max(500, 'Too many fields').parse(input);
  await withActor(db, actor, async (tx) => {
    const { workspaceId, pageCount } = await beginEdit(tx, documentId);
    const recips = await tx
      .select()
      .from(schema.documentRecipients)
      .where(eq(schema.documentRecipients.documentId, documentId));
    const byId = new Map(recips.map((r) => [r.id, r]));
    for (const f of fields) {
      const r = byId.get(f.recipientId);
      if (!r)
        throw new AppError(
          'invalid',
          'A field is assigned to someone who is not on this document.',
        );
      if (!['signer', 'approver'].includes(r.role))
        throw new AppError(
          'invalid',
          `${r.name} cannot have fields because they only ${r.role === 'cc' ? 'receive a copy' : 'review or view'}.`,
        );
      if (f.page > pageCount)
        throw new AppError('invalid', 'A field is placed on a page that does not exist.');
    }
    await tx.delete(schema.documentFields).where(eq(schema.documentFields.documentId, documentId));
    if (fields.length) {
      await tx.insert(schema.documentFields).values(
        fields.map((f) => ({
          ...f,
          label: f.label ?? null,
          options: f.options ?? null,
          workspaceId,
          documentId,
        })),
      );
    }
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'document.fields_updated',
      targetType: 'document',
      targetId: documentId,
      metadata: { count: fields.length },
      ...meta,
    });
  });
}

export async function saveSettings(
  db: Database,
  actor: ActorContext,
  documentId: string,
  input: { settings: z.input<typeof documentSettingsSchema>; emailMessage?: string },
  meta: Meta = {},
  now = new Date(),
) {
  const settings = documentSettingsSchema.parse(input.settings);
  if (settings.expiresAt && new Date(`${settings.expiresAt}T23:59:59Z`) <= now) {
    throw new AppError('invalid', 'The expiration date must be in the future.');
  }
  const emailMessage = z
    .string()
    .trim()
    .max(2000, 'Message is too long')
    .optional()
    .parse(input.emailMessage);
  await withActor(db, actor, async (tx) => {
    const { workspaceId } = await beginEdit(tx, documentId);
    await tx
      .update(schema.documents)
      .set({ settings, emailMessage: emailMessage || null })
      .where(eq(schema.documents.id, documentId));
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'document.settings_updated',
      targetType: 'document',
      targetId: documentId,
      ...meta,
    });
  });
}

export interface ReadinessIssue {
  step: 'document' | 'signers' | 'fields' | 'settings';
  message: string;
}

/** Pure check of whether a prepared document is complete enough to send (spec Part 15 field validation). */
export function checkReadiness(data: {
  file: { pageCount: number } | null;
  recipients: { id: string; name: string; role: RecipientRole }[];
  fields: { recipientId: string; type: FieldType; page: number }[];
  settings: DocumentSettings;
  now?: Date;
}): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  if (!data.file) issues.push({ step: 'document', message: 'Upload a PDF.' });
  const signers = data.recipients.filter((r) => r.role === 'signer');
  if (signers.length === 0) issues.push({ step: 'signers', message: 'Add at least one signer.' });
  for (const s of data.recipients.filter((r) => r.role === 'signer' || r.role === 'approver')) {
    const mine = data.fields.filter((f) => f.recipientId === s.id);
    const needs = data.settings.signingMethod === 'initials_only' ? 'initials' : 'signature';
    if (
      data.settings.signingMethod !== 'acknowledge' &&
      s.role === 'signer' &&
      !mine.some((f) => f.type === needs)
    ) {
      issues.push({ step: 'fields', message: `Place at least one ${needs} field for ${s.name}.` });
    }
  }
  if (data.file && data.fields.some((f) => f.page > data.file!.pageCount))
    issues.push({ step: 'fields', message: 'A field is on a page that no longer exists.' });
  const now = data.now ?? new Date();
  if (data.settings.expiresAt && new Date(`${data.settings.expiresAt}T23:59:59Z`) <= now)
    issues.push({ step: 'settings', message: 'The expiration date has passed.' });
  return issues;
}

export async function markReadyToSend(
  db: Database,
  actor: ActorContext,
  documentId: string,
  meta: Meta = {},
): Promise<ReadinessIssue[]> {
  const data = await getDocument(db, actor, documentId);
  if (!data.canEdit) throw new AppError('forbidden', 'You cannot edit this document');
  const issues = checkReadiness({
    file: data.file,
    recipients: data.recipients,
    fields: data.fields,
    settings: data.document.settings,
  });
  if (issues.length) return issues;
  await withActor(db, actor, async (tx) => {
    const [doc] = (await tx.execute(
      sql`select status, workspace_id from documents where id = ${documentId}::uuid for update`,
    )) as unknown as { status: DocumentStatus; workspace_id: string }[];
    if (!doc) throw new AppError('not_found', 'Document not found');
    if (doc.status === 'ready_to_send') return;
    if (!canTransition(doc.status, 'ready_to_send'))
      throw new AppError('conflict', 'This document is not being prepared');
    await tx
      .update(schema.documents)
      .set({ status: 'ready_to_send', updatedAt: new Date() })
      .where(eq(schema.documents.id, documentId));
    await recordAudit(tx, {
      workspaceId: doc.workspace_id,
      actorUserId: actor.userId,
      action: 'document.ready_to_send',
      targetType: 'document',
      targetId: documentId,
      ...meta,
    });
  });
  return [];
}

export async function deleteDraft(
  db: Database,
  actor: ActorContext,
  documentId: string,
  meta: Meta = {},
) {
  await withActor(db, actor, async (tx) => {
    const doc = await loadDocument(tx, documentId);
    await assertNotSent(tx, documentId);
    const res = await tx
      .update(schema.documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.documents.id, documentId))
      .returning({ id: schema.documents.id });
    if (!res.length) throw new AppError('forbidden', 'You cannot delete this document');
    await recordAudit(tx, {
      workspaceId: doc.workspaceId,
      actorUserId: actor.userId,
      action: 'document.draft_deleted',
      targetType: 'document',
      targetId: documentId,
      ...meta,
    });
  });
}

/** Returns the original PDF bytes after an RLS-checked lookup, and logs the access. */
export async function readDocumentFile(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  documentId: string,
  meta: Meta = {},
) {
  const data = await getDocument(db, actor, documentId);
  if (!data.file) throw new AppError('not_found', 'File not found');
  const bytes = await storage.get(data.file.storageKey);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== data.file.sha256)
    throw new Error(`Integrity check failed for document ${documentId}`);
  await withActor(db, actor, (tx) =>
    recordAudit(tx, {
      workspaceId: data.document.workspaceId,
      actorUserId: actor.userId,
      action: 'document.file_viewed',
      targetType: 'document',
      targetId: documentId,
      ...meta,
    }),
  );
  return { bytes, filename: data.file.originalFilename };
}
