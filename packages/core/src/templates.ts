import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withActor, type Database, type ActorContext, type Tx } from '@st/db';
import { AppError } from './errors';
import { recordAudit } from './audit';
import {
  inspectPdf,
  documentSettingsSchema,
  fieldInputSchema,
  checkReadiness,
  DOCUMENT_TYPES,
  type DocumentSettings,
  type RecipientRole,
  type FieldType,
} from './documents';
import type { ObjectStorage } from './storage';
import { sha256Hex } from './signing-crypto';

/**
 * Templates (spec Part 18). A template holds a PDF with placeholder recipients ("Artist",
 * "Venue"), fields and default settings. It never creates a signing request on its own: using it
 * makes an ordinary draft document, which records the exact template version it came from.
 * Published versions are frozen; editing an active template works on a new draft version.
 */

type Meta = { ipAddress?: string | null; userAgent?: string | null };
const uuid = z.string().uuid();
const documentTypeValues = DOCUMENT_TYPES.map((d) => d.value) as [string, ...string[]];

export const DEFAULT_TEMPLATE_CATEGORIES = [
  'Agreements',
  'Contracts',
  'Music & Rights',
  'Booking & Events',
  'Finance',
  'Employment',
  'Human Resources',
  'Legal',
  'Custom',
] as const;

export const templateDetailsSchema = z.object({
  title: z.string().trim().min(1, 'Template name is required').max(200),
  description: z.string().trim().max(500).default(''),
  category: z.string().trim().min(1, 'Choose a category').max(40),
  documentType: z.enum(documentTypeValues, { message: 'Choose a document type' }),
  shared: z.boolean().default(true),
});
export type TemplateDetails = z.input<typeof templateDetailsSchema>;

export const placeholderSchema = z.object({
  id: uuid,
  label: z.string().trim().min(1, 'Name the role, for example "Artist"').max(60),
  role: z.enum(schema.recipientRole.enumValues),
  signingOrder: z.number().int().min(1).max(50),
  authMethod: z.enum(schema.recipientAuth.enumValues).default('email_link'),
});
export type Placeholder = z.output<typeof placeholderSchema> & { colorIndex: number };

export type TemplateField = z.output<typeof fieldInputSchema> & { id: string };

export const TEMPLATE_TABS = ['all', 'active', 'drafts', 'archived', 'shared'] as const;
export type TemplateTab = (typeof TEMPLATE_TABS)[number];

export const templateQuery = z.object({
  tab: z.enum(TEMPLATE_TABS).catch('all'),
  category: z.string().max(40).optional().default(''),
  q: z.string().trim().max(200).optional().default(''),
});

async function can(tx: Tx, ws: string, perm: string) {
  const [r] = (await tx.execute(
    sql`select st_has_permission(${ws}::uuid, ${perm}) as ok`,
  )) as unknown as { ok: boolean }[];
  return Boolean(r?.ok);
}

function parsePlaceholders(v: unknown): Placeholder[] {
  return (Array.isArray(v) ? v : []) as Placeholder[];
}
function parseFields(v: unknown): TemplateField[] {
  return (Array.isArray(v) ? v : []) as TemplateField[];
}

// ---------------------------------------------------------------------------------------------
// Listing

export async function listTemplates(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: Partial<z.input<typeof templateQuery>> = {},
) {
  if (!uuid.safeParse(workspaceId).success) throw new AppError('not_found', 'Workspace not found');
  const f = templateQuery.parse(raw);
  return withActor(db, actor, async (tx) => {
    if (!(await can(tx, workspaceId, 'templates.view')))
      throw new AppError('forbidden', 'Your role does not allow viewing templates.');
    const canManage = await can(tx, workspaceId, 'templates.manage');
    const rows = (await tx.execute(sql`
      select t.id, t.title, t.description, t.category, t.document_type, t.status::text as status,
             t.shared, t.published_version, t.updated_at, t.created_by, u.name as owner_name,
             exists (select 1 from template_versions v where v.template_id = t.id and v.published_at is null) as has_draft
      from templates t join "user" u on u.id = t.created_by
      where t.workspace_id = ${workspaceId}::uuid and t.deleted_at is null
      order by t.updated_at desc limit 500
    `)) as unknown as {
      id: string;
      title: string;
      description: string;
      category: string;
      document_type: string;
      status: 'draft' | 'active' | 'archived';
      shared: boolean;
      published_version: number;
      updated_at: string;
      created_by: string;
      owner_name: string;
      has_draft: boolean;
    }[];
    const metrics = {
      all: rows.filter((r) => r.status !== 'archived').length,
      active: rows.filter((r) => r.status === 'active').length,
      drafts: rows.filter((r) => r.status === 'draft').length,
      archived: rows.filter((r) => r.status === 'archived').length,
      shared: rows.filter((r) => r.shared && r.status !== 'archived').length,
    };
    const q = f.q.toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (f.tab === 'all'
          ? r.status !== 'archived'
          : f.tab === 'drafts'
            ? r.status === 'draft'
            : f.tab === 'shared'
              ? r.shared && r.status !== 'archived'
              : r.status === f.tab) &&
        (!f.category || r.category === f.category) &&
        (!q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)),
    );
    const custom = await tx
      .select({ name: schema.templateCategories.name })
      .from(schema.templateCategories)
      .where(eq(schema.templateCategories.workspaceId, workspaceId))
      .orderBy(asc(schema.templateCategories.name));
    const categories = [
      ...new Set([
        ...DEFAULT_TEMPLATE_CATEGORIES,
        ...custom.map((c) => c.name),
        ...rows.map((r) => r.category),
      ]),
    ];
    return {
      query: f,
      metrics,
      categories,
      canManage,
      rows: filtered.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category,
        documentType: r.document_type,
        status: r.status,
        shared: r.shared,
        publishedVersion: r.published_version,
        hasDraft: r.has_draft,
        updatedAt: new Date(r.updated_at),
        ownerName: r.created_by === actor.userId ? 'You' : r.owner_name,
        isOwner: r.created_by === actor.userId,
      })),
    };
  });
}

export async function addTemplateCategory(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  name: string,
  meta: Meta = {},
) {
  const n = z.string().trim().min(1, 'Name the category').max(40).parse(name);
  await withActor(db, actor, async (tx) => {
    if (!(await can(tx, workspaceId, 'templates.manage')))
      throw new AppError('forbidden', 'Your role does not allow managing templates.');
    if (DEFAULT_TEMPLATE_CATEGORIES.some((c) => c.toLowerCase() === n.toLowerCase()))
      throw new AppError('conflict', 'That category already exists.');
    const [dup] = await tx
      .select({ id: schema.templateCategories.id })
      .from(schema.templateCategories)
      .where(
        and(
          eq(schema.templateCategories.workspaceId, workspaceId),
          sql`lower(${schema.templateCategories.name}) = lower(${n})`,
        ),
      );
    if (dup) throw new AppError('conflict', 'That category already exists.');
    await tx.insert(schema.templateCategories).values({ workspaceId, name: n });
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'template.category_created',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: { name: n },
      ...meta,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Create and read

export async function createTemplateFromUpload(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  input: TemplateDetails & { workspaceId: string; filename: string; bytes: Uint8Array },
  limits: { maxBytes: number; maxPages: number },
  meta: Meta = {},
): Promise<{ id: string }> {
  if (!uuid.safeParse(input.workspaceId).success)
    throw new AppError('not_found', 'Workspace not found');
  const details = templateDetailsSchema.parse(input);
  const allowed = await withActor(db, actor, (tx) =>
    can(tx, input.workspaceId, 'templates.manage'),
  );
  if (!allowed) throw new AppError('forbidden', 'Your role does not allow creating templates.');
  const info = await inspectPdf(input.bytes, limits);
  const templateId = crypto.randomUUID();
  const key = `ws/${input.workspaceId}/tpl/${templateId}/${crypto.randomUUID()}.pdf`;
  await storage.put(key, input.bytes, 'application/pdf');
  try {
    await withActor(db, actor, async (tx) => {
      await tx.insert(schema.templates).values({
        id: templateId,
        workspaceId: input.workspaceId,
        createdBy: actor.userId,
        ...details,
      });
      await tx.insert(schema.templateVersions).values({
        workspaceId: input.workspaceId,
        templateId,
        version: 1,
        storageKey: key,
        originalFilename: input.filename.slice(0, 255) || 'template.pdf',
        sizeBytes: input.bytes.byteLength,
        sha256: info.sha256,
        pageCount: info.pageCount,
        settings: documentSettingsSchema.parse({}),
        createdBy: actor.userId,
      });
      await recordAudit(tx, {
        workspaceId: input.workspaceId,
        actorUserId: actor.userId,
        action: 'template.created',
        targetType: 'template',
        targetId: templateId,
        metadata: { sha256: info.sha256, pages: info.pageCount },
        ...meta,
      });
    });
  } catch (err) {
    await storage.delete(key).catch(() => undefined);
    throw err;
  }
  return { id: templateId };
}

async function loadTemplate(tx: Tx, templateId: string) {
  if (!uuid.safeParse(templateId).success) throw new AppError('not_found', 'Template not found');
  const [t] = await tx
    .select()
    .from(schema.templates)
    .where(and(eq(schema.templates.id, templateId), isNull(schema.templates.deletedAt)));
  if (!t) throw new AppError('not_found', 'Template not found');
  return t;
}

async function versions(tx: Tx, templateId: string) {
  return tx
    .select()
    .from(schema.templateVersions)
    .where(eq(schema.templateVersions.templateId, templateId))
    .orderBy(desc(schema.templateVersions.version));
}

export async function getTemplate(db: Database, actor: ActorContext, templateId: string) {
  return withActor(db, actor, async (tx) => {
    const t = await loadTemplate(tx, templateId);
    const all = await versions(tx, templateId);
    const draft = all.find((v) => !v.publishedAt) ?? null;
    const published = all.find((v) => v.publishedAt) ?? null;
    const [edit] = (await tx.execute(
      sql`select st_can_edit_template(${templateId}::uuid) as ok`,
    )) as unknown as { ok: boolean }[];
    const canUse = await can(tx, t.workspaceId, 'documents.create');
    const [owner] = await tx
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, t.createdBy));
    const usage = (await tx.execute(sql`
      select v.version, count(d.id)::int as n from documents d
      join template_versions v on v.id = d.template_version_id
      where d.template_id = ${templateId}::uuid and d.deleted_at is null group by v.version
    `)) as unknown as { version: number; n: number }[];
    const shape = (v: typeof schema.templateVersions.$inferSelect) => ({
      ...v,
      recipients: parsePlaceholders(v.recipients),
      fields: parseFields(v.fields),
      settings: documentSettingsSchema.parse(v.settings ?? {}),
    });
    return {
      template: t,
      ownerName: owner?.name ?? null,
      draft: draft ? shape(draft) : null,
      published: published ? shape(published) : null,
      history: all
        .filter((v) => v.publishedAt)
        .map((v) => ({
          id: v.id,
          version: v.version,
          publishedAt: v.publishedAt!,
          sha256: v.sha256,
          uses: usage.find((u) => u.version === v.version)?.n ?? 0,
        })),
      canEdit: Boolean(edit?.ok),
      canUse: canUse && t.status === 'active' && Boolean(published),
    };
  });
}

/** The version the editor works on, creating a new draft from the published one if needed. */
async function editableVersion(tx: Tx, templateId: string, actor: ActorContext) {
  const t = await loadTemplate(tx, templateId);
  const [edit] = (await tx.execute(
    sql`select st_can_edit_template(${templateId}::uuid) as ok`,
  )) as unknown as { ok: boolean }[];
  if (!edit?.ok) throw new AppError('forbidden', 'Your role does not allow editing this template.');
  if (t.status === 'archived')
    throw new AppError('conflict', 'Unarchive the template before editing it.');
  const all = await versions(tx, templateId);
  const draft = all.find((v) => !v.publishedAt);
  if (draft) return { template: t, version: draft };
  const latest = all[0]!;
  const [copy] = await tx
    .insert(schema.templateVersions)
    .values({
      workspaceId: t.workspaceId,
      templateId,
      version: latest.version + 1,
      storageKey: latest.storageKey,
      originalFilename: latest.originalFilename,
      sizeBytes: latest.sizeBytes,
      sha256: latest.sha256,
      pageCount: latest.pageCount,
      recipients: latest.recipients,
      fields: latest.fields,
      settings: latest.settings,
      signingOrderEnabled: latest.signingOrderEnabled,
      emailMessage: latest.emailMessage,
      createdBy: actor.userId,
    })
    .returning();
  return { template: t, version: copy! };
}

/** Opens (or creates) the draft version for editing. Returns its id. */
export async function startTemplateEdit(db: Database, actor: ActorContext, templateId: string) {
  return withActor(
    db,
    actor,
    async (tx) => (await editableVersion(tx, templateId, actor)).version.id,
  );
}

async function touch(tx: Tx, templateId: string) {
  await tx
    .update(schema.templates)
    .set({ updatedAt: new Date() })
    .where(eq(schema.templates.id, templateId));
}

export async function saveTemplateDetails(
  db: Database,
  actor: ActorContext,
  templateId: string,
  raw: TemplateDetails,
  meta: Meta = {},
) {
  const d = templateDetailsSchema.parse(raw);
  await withActor(db, actor, async (tx) => {
    const t = await loadTemplate(tx, templateId);
    if (!d.shared && t.createdBy !== actor.userId)
      throw new AppError(
        'forbidden',
        'Only the person who created a template can make it private.',
      );
    const res = await tx
      .update(schema.templates)
      .set({ ...d, updatedAt: new Date() })
      .where(eq(schema.templates.id, templateId))
      .returning({ id: schema.templates.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow editing this template.');
    await recordAudit(tx, {
      workspaceId: t.workspaceId,
      actorUserId: actor.userId,
      action: 'template.details_updated',
      targetType: 'template',
      targetId: templateId,
      metadata: { shared: d.shared },
      ...meta,
    });
  });
}

export async function saveTemplateRecipients(
  db: Database,
  actor: ActorContext,
  templateId: string,
  input: { signingOrderEnabled: boolean; recipients: z.input<typeof placeholderSchema>[] },
  limits: { maxSigners: number },
  meta: Meta = {},
) {
  const list = z
    .array(placeholderSchema)
    .min(1, 'Add at least one recipient role.')
    .max(50)
    .parse(input.recipients);
  const signers = list.filter((r) => r.role === 'signer');
  if (!signers.length) throw new AppError('invalid', 'Add at least one signer role.');
  if (signers.length > limits.maxSigners)
    throw new AppError('invalid', `A signing request includes up to ${limits.maxSigners} signers.`);
  const labels = new Set<string>();
  for (const r of list) {
    const k = r.label.toLowerCase();
    if (labels.has(k))
      throw new AppError('invalid', `"${r.label}" is used twice. Give each role a different name.`);
    labels.add(k);
  }
  await withActor(db, actor, async (tx) => {
    const { template, version } = await editableVersion(tx, templateId, actor);
    const placeholders: Placeholder[] = list.map((r, i) => ({
      ...r,
      signingOrder: input.signingOrderEnabled ? r.signingOrder : 1,
      colorIndex: i % 8,
    }));
    const fillable = new Set(
      placeholders.filter((p) => p.role === 'signer' || p.role === 'approver').map((p) => p.id),
    );
    const fields = parseFields(version.fields).filter((f) => fillable.has(f.recipientId));
    await tx
      .update(schema.templateVersions)
      .set({
        recipients: placeholders,
        fields,
        signingOrderEnabled: input.signingOrderEnabled,
        updatedAt: new Date(),
      })
      .where(eq(schema.templateVersions.id, version.id));
    await touch(tx, templateId);
    await recordAudit(tx, {
      workspaceId: template.workspaceId,
      actorUserId: actor.userId,
      action: 'template.recipients_updated',
      targetType: 'template',
      targetId: templateId,
      metadata: { version: version.version, count: placeholders.length },
      ...meta,
    });
  });
}

export async function saveTemplateFields(
  db: Database,
  actor: ActorContext,
  templateId: string,
  input: z.input<typeof fieldInputSchema>[],
  meta: Meta = {},
) {
  const parsed = z.array(fieldInputSchema).max(500, 'Too many fields').parse(input);
  await withActor(db, actor, async (tx) => {
    const { template, version } = await editableVersion(tx, templateId, actor);
    const fillable = new Set(
      parsePlaceholders(version.recipients)
        .filter((p) => p.role === 'signer' || p.role === 'approver')
        .map((p) => p.id),
    );
    if (parsed.some((f) => !fillable.has(f.recipientId)))
      throw new AppError('invalid', 'A field is assigned to a role that cannot fill fields.');
    if (parsed.some((f) => f.page > version.pageCount))
      throw new AppError('invalid', 'A field is on a page that does not exist.');
    const fields: TemplateField[] = parsed.map((f) => ({ ...f, id: crypto.randomUUID() }));
    await tx
      .update(schema.templateVersions)
      .set({ fields, updatedAt: new Date() })
      .where(eq(schema.templateVersions.id, version.id));
    await touch(tx, templateId);
    await recordAudit(tx, {
      workspaceId: template.workspaceId,
      actorUserId: actor.userId,
      action: 'template.fields_updated',
      targetType: 'template',
      targetId: templateId,
      metadata: { version: version.version, count: fields.length },
      ...meta,
    });
  });
}

export async function saveTemplateSettings(
  db: Database,
  actor: ActorContext,
  templateId: string,
  input: { settings: z.input<typeof documentSettingsSchema>; emailMessage?: string | null },
  meta: Meta = {},
) {
  // A template cannot carry a fixed expiry date: each use sets its own.
  const settings = documentSettingsSchema.parse({ ...input.settings, expiresAt: null });
  const emailMessage =
    z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional()
      .parse(input.emailMessage ?? null) || null;
  await withActor(db, actor, async (tx) => {
    const { template, version } = await editableVersion(tx, templateId, actor);
    await tx
      .update(schema.templateVersions)
      .set({ settings, emailMessage, updatedAt: new Date() })
      .where(eq(schema.templateVersions.id, version.id));
    await touch(tx, templateId);
    await recordAudit(tx, {
      workspaceId: template.workspaceId,
      actorUserId: actor.userId,
      action: 'template.settings_updated',
      targetType: 'template',
      targetId: templateId,
      metadata: { version: version.version },
      ...meta,
    });
  });
}

export interface TemplateIssue {
  step: 'recipients' | 'fields' | 'settings';
  message: string;
}

export function checkTemplate(v: {
  pageCount: number;
  recipients: Placeholder[];
  fields: TemplateField[];
  settings: DocumentSettings;
}): TemplateIssue[] {
  return checkReadiness({
    file: { pageCount: v.pageCount },
    recipients: v.recipients.map((r) => ({
      id: r.id,
      name: r.label,
      role: r.role as RecipientRole,
    })),
    fields: v.fields.map((f) => ({
      recipientId: f.recipientId,
      type: f.type as FieldType,
      page: f.page,
    })),
    settings: v.settings,
  }).map((i) => ({
    step: i.step === 'signers' ? 'recipients' : i.step === 'document' ? 'settings' : i.step,
    message: i.message,
  }));
}

/** Publishes the draft. Later edits create a new version; documents keep the one they used. */
export async function publishTemplate(
  db: Database,
  actor: ActorContext,
  templateId: string,
  meta: Meta = {},
) {
  return withActor(db, actor, async (tx) => {
    const t = await loadTemplate(tx, templateId);
    const draft = (await versions(tx, templateId)).find((v) => !v.publishedAt);
    if (!draft) throw new AppError('conflict', 'There are no unpublished changes.');
    const issues = checkTemplate({
      pageCount: draft.pageCount,
      recipients: parsePlaceholders(draft.recipients),
      fields: parseFields(draft.fields),
      settings: documentSettingsSchema.parse(draft.settings ?? {}),
    });
    if (issues.length) return { ok: false as const, issues };
    const res = await tx
      .update(schema.templateVersions)
      .set({ publishedAt: new Date(), publishedBy: actor.userId })
      .where(eq(schema.templateVersions.id, draft.id))
      .returning({ id: schema.templateVersions.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow publishing this template.');
    await tx
      .update(schema.templates)
      .set({ status: 'active', publishedVersion: draft.version, updatedAt: new Date() })
      .where(eq(schema.templates.id, templateId));
    await recordAudit(tx, {
      workspaceId: t.workspaceId,
      actorUserId: actor.userId,
      action: 'template.published',
      targetType: 'template',
      targetId: templateId,
      metadata: { version: draft.version, sha256: draft.sha256 },
      ...meta,
    });
    return { ok: true as const, version: draft.version };
  });
}

/** Throws away unpublished changes to an already published template. */
export async function discardTemplateDraft(
  db: Database,
  actor: ActorContext,
  templateId: string,
  meta: Meta = {},
) {
  await withActor(db, actor, async (tx) => {
    const t = await loadTemplate(tx, templateId);
    if (!t.publishedVersion)
      throw new AppError(
        'conflict',
        'A template that was never published has no earlier version to go back to.',
      );
    const draft = (await versions(tx, templateId)).find((v) => !v.publishedAt);
    if (!draft) return;
    // Drafts cannot be deleted by the app role; the draft is reset to the published content instead.
    const published = (await versions(tx, templateId)).find((v) => v.publishedAt)!;
    const res = await tx
      .update(schema.templateVersions)
      .set({
        recipients: published.recipients,
        fields: published.fields,
        settings: published.settings,
        signingOrderEnabled: published.signingOrderEnabled,
        emailMessage: published.emailMessage,
        updatedAt: new Date(),
      })
      .where(eq(schema.templateVersions.id, draft.id))
      .returning({ id: schema.templateVersions.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow editing this template.');
    await recordAudit(tx, {
      workspaceId: t.workspaceId,
      actorUserId: actor.userId,
      action: 'template.draft_discarded',
      targetType: 'template',
      targetId: templateId,
      ...meta,
    });
  });
}

export async function setTemplateStatus(
  db: Database,
  actor: ActorContext,
  templateId: string,
  action: 'archive' | 'unarchive' | 'delete',
  meta: Meta = {},
) {
  await withActor(db, actor, async (tx) => {
    const t = await loadTemplate(tx, templateId);
    const set =
      action === 'delete'
        ? { deletedAt: new Date() }
        : {
            status: (action === 'archive'
              ? 'archived'
              : t.publishedVersion
                ? 'active'
                : 'draft') as 'archived' | 'active' | 'draft',
          };
    const res = await tx
      .update(schema.templates)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(schema.templates.id, templateId))
      .returning({ id: schema.templates.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow changing this template.');
    await recordAudit(tx, {
      workspaceId: t.workspaceId,
      actorUserId: actor.userId,
      action: `template.${action === 'delete' ? 'deleted' : action === 'archive' ? 'archived' : 'unarchived'}`,
      targetType: 'template',
      targetId: templateId,
      ...meta,
    });
  });
}

/** Copies the latest content into a new draft template owned by the actor. */
export async function duplicateTemplate(
  db: Database,
  actor: ActorContext,
  templateId: string,
  meta: Meta = {},
) {
  return withActor(db, actor, async (tx) => {
    const t = await loadTemplate(tx, templateId);
    if (!(await can(tx, t.workspaceId, 'templates.manage')))
      throw new AppError('forbidden', 'Your role does not allow creating templates.');
    const latest = (await versions(tx, templateId))[0]!;
    const id = crypto.randomUUID();
    await tx.insert(schema.templates).values({
      id,
      workspaceId: t.workspaceId,
      createdBy: actor.userId,
      title: `Copy of ${t.title}`.slice(0, 200),
      description: t.description,
      category: t.category,
      documentType: t.documentType,
      shared: t.shared,
    });
    await tx.insert(schema.templateVersions).values({
      workspaceId: t.workspaceId,
      templateId: id,
      version: 1,
      storageKey: latest.storageKey,
      originalFilename: latest.originalFilename,
      sizeBytes: latest.sizeBytes,
      sha256: latest.sha256,
      pageCount: latest.pageCount,
      recipients: latest.recipients,
      fields: latest.fields,
      settings: latest.settings,
      signingOrderEnabled: latest.signingOrderEnabled,
      emailMessage: latest.emailMessage,
      createdBy: actor.userId,
    });
    await recordAudit(tx, {
      workspaceId: t.workspaceId,
      actorUserId: actor.userId,
      action: 'template.duplicated',
      targetType: 'template',
      targetId: id,
      metadata: { from: templateId },
      ...meta,
    });
    return { id };
  });
}

/** PDF bytes of a template version (the draft by default), integrity-checked. */
export async function readTemplateFile(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  templateId: string,
  versionId?: string,
) {
  const v = await withActor(db, actor, async (tx) => {
    await loadTemplate(tx, templateId);
    const all = await versions(tx, templateId);
    const chosen = versionId
      ? all.find((x) => x.id === versionId)
      : (all.find((x) => !x.publishedAt) ?? all[0]);
    if (!chosen) throw new AppError('not_found', 'File not found');
    return chosen;
  });
  const bytes = await storage.get(v.storageKey);
  if (sha256Hex(bytes) !== v.sha256)
    throw new Error(`Integrity check failed for template version ${v.id}`);
  return { bytes, filename: v.originalFilename };
}

// ---------------------------------------------------------------------------------------------
// Use

export const templateUseSchema = z.object({
  title: z.string().trim().min(1, 'Document name is required').max(200),
  recipients: z
    .array(
      z.object({
        placeholderId: uuid,
        name: z.string().trim().min(1, 'Name is required').max(120),
        email: z.string().trim().toLowerCase().email('Enter a valid email'),
      }),
    )
    .min(1),
});
export type UseTemplateInput = z.input<typeof templateUseSchema>;

/**
 * Creates a draft document from the latest published version. Nothing is sent: the sender still
 * reviews and sends it like any other document.
 */
export async function createDocumentFromTemplate(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  templateId: string,
  raw: UseTemplateInput,
  meta: Meta = {},
): Promise<{ documentId: string }> {
  const input = templateUseSchema.parse(raw);
  const emails = new Set<string>();
  for (const r of input.recipients) {
    if (emails.has(r.email))
      throw new AppError(
        'invalid',
        `${r.email} is listed more than once. Each person can appear once.`,
      );
    emails.add(r.email);
  }
  const { t, v } = await withActor(db, actor, async (tx) => {
    const t = await loadTemplate(tx, templateId);
    if (t.status !== 'active' || !t.publishedVersion)
      throw new AppError('conflict', 'Publish the template before using it.');
    if (!(await can(tx, t.workspaceId, 'documents.create')))
      throw new AppError('forbidden', 'Your role does not allow creating documents.');
    const [v] = await tx
      .select()
      .from(schema.templateVersions)
      .where(
        and(
          eq(schema.templateVersions.templateId, templateId),
          eq(schema.templateVersions.version, t.publishedVersion),
        ),
      );
    if (!v) throw new AppError('not_found', 'Template not found');
    return { t, v };
  });
  const placeholders = parsePlaceholders(v.recipients);
  const byId = new Map(input.recipients.map((r) => [r.placeholderId, r]));
  for (const p of placeholders)
    if (!byId.has(p.id)) throw new AppError('invalid', `Add a person for ${p.label}.`);

  // The document gets its own copy of the PDF so retention and deletion never touch the template.
  const bytes = await storage.get(v.storageKey);
  if (sha256Hex(bytes) !== v.sha256)
    throw new Error(`Integrity check failed for template version ${v.id}`);
  const documentId = crypto.randomUUID();
  const key = `ws/${t.workspaceId}/doc/${documentId}/v1/${crypto.randomUUID()}.pdf`;
  await storage.put(key, bytes, 'application/pdf');
  try {
    await withActor(db, actor, async (tx) => {
      await tx.insert(schema.documents).values({
        id: documentId,
        workspaceId: t.workspaceId,
        createdBy: actor.userId,
        title: input.title,
        documentType: t.documentType,
        status: 'preparing',
        pageCount: v.pageCount,
        signingOrderEnabled: v.signingOrderEnabled,
        settings: documentSettingsSchema.parse(v.settings ?? {}),
        emailMessage: v.emailMessage,
        templateId: t.id,
        templateVersionId: v.id,
      });
      await tx.insert(schema.documentFiles).values({
        workspaceId: t.workspaceId,
        documentId,
        version: 1,
        storageKey: key,
        originalFilename: v.originalFilename,
        contentType: 'application/pdf',
        sizeBytes: v.sizeBytes,
        sha256: v.sha256,
        pageCount: v.pageCount,
        createdBy: actor.userId,
      });
      const idMap = new Map<string, string>();
      for (const p of placeholders) {
        const person = byId.get(p.id)!;
        const [row] = await tx
          .insert(schema.documentRecipients)
          .values({
            workspaceId: t.workspaceId,
            documentId,
            name: person.name,
            email: person.email,
            role: p.role,
            signingOrder: p.signingOrder,
            authMethod: p.authMethod,
            colorIndex: p.colorIndex,
          })
          .returning({ id: schema.documentRecipients.id });
        idMap.set(p.id, row!.id);
      }
      const fields = parseFields(v.fields).filter((f) => idMap.has(f.recipientId));
      if (fields.length)
        await tx.insert(schema.documentFields).values(
          fields.map((f) => ({
            workspaceId: t.workspaceId,
            documentId,
            recipientId: idMap.get(f.recipientId)!,
            type: f.type,
            page: f.page,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            required: f.required,
            label: f.label ?? null,
            options: f.options ?? null,
          })),
        );
      await recordAudit(tx, {
        workspaceId: t.workspaceId,
        actorUserId: actor.userId,
        action: 'document.created_from_template',
        targetType: 'document',
        targetId: documentId,
        metadata: { templateId: t.id, templateVersion: v.version, sha256: v.sha256 },
        ...meta,
      });
    });
  } catch (err) {
    await storage.delete(key).catch(() => undefined);
    throw err;
  }
  return { documentId };
}
