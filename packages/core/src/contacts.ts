import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withActor, type Database, type ActorContext, type Tx } from '@st/db';
import { AppError } from './errors';
import { recordAudit } from './audit';

/**
 * Contacts (spec Part 19). An address book entry never gives anyone access to a document.
 * Shared contacts are visible to the workspace; private ones only to the person who added them.
 */

type Meta = { ipAddress?: string | null; userAgent?: string | null };
const uuid = z.string().uuid();
const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const CONTACT_TYPES = [
  'person',
  'company',
  'artist',
  'venue',
  'agent',
  'vendor',
  'other',
] as const;

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: opt(40),
  company: opt(120),
  jobTitle: opt(120),
  contactType: z
    .enum(CONTACT_TYPES)
    .optional()
    .catch('person')
    .transform((v) => v ?? 'person'),
  notes: opt(2000),
  tags: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((v) =>
      [
        ...new Set(
          (Array.isArray(v) ? v : (v ?? '').split(','))
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
            .map((t) => t.slice(0, 30)),
        ),
      ].slice(0, 20),
    ),
  visibility: z
    .enum(['shared', 'private'])
    .optional()
    .catch('shared')
    .transform((v) => v ?? 'shared'),
});
export type ContactInput = z.input<typeof contactSchema>;

export const contactQuery = z.object({
  q: z.string().trim().max(200).optional().default(''),
  type: z.string().max(20).optional().default(''),
  tag: z.string().max(30).optional().default(''),
  view: z.enum(['active', 'archived']).catch('active'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export const CONTACTS_PAGE_SIZE = 50;

export async function listContacts(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: Partial<z.input<typeof contactQuery>> = {},
) {
  if (!uuid.safeParse(workspaceId).success) throw new AppError('not_found', 'Workspace not found');
  const f = contactQuery.parse(raw);
  return withActor(db, actor, async (tx) => {
    const conds = [
      eq(schema.contacts.workspaceId, workspaceId),
      f.view === 'archived'
        ? isNotNull(schema.contacts.archivedAt)
        : isNull(schema.contacts.archivedAt),
    ];
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push(
        sql`(${schema.contacts.name} ilike ${like} or ${schema.contacts.email} ilike ${like} or coalesce(${schema.contacts.company}, '') ilike ${like})`,
      );
    }
    if (f.type) conds.push(eq(schema.contacts.contactType, f.type));
    if (f.tag) conds.push(sql`${f.tag.toLowerCase()} = any(${schema.contacts.tags})`);
    const where = and(...conds);
    const [{ n }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.contacts)
      .where(where)) as [{ n: number }];
    const rows = await tx
      .select()
      .from(schema.contacts)
      .where(where)
      .orderBy(asc(sql`lower(${schema.contacts.name})`), asc(schema.contacts.id))
      .limit(CONTACTS_PAGE_SIZE)
      .offset((f.page - 1) * CONTACTS_PAGE_SIZE);
    const [counts] = (await tx.execute(sql`
      select count(*) filter (where archived_at is null)::int as active,
             count(*) filter (where archived_at is not null)::int as archived,
             count(*) filter (where archived_at is null and visibility = 'private')::int as private
      from contacts where workspace_id = ${workspaceId}::uuid
    `)) as unknown as { active: number; archived: number; private: number }[];
    const tagRows = (await tx.execute(sql`
      select distinct unnest(tags) as tag from contacts where workspace_id = ${workspaceId}::uuid order by 1 limit 100
    `)) as unknown as { tag: string }[];
    return {
      query: f,
      total: n,
      pages: Math.max(1, Math.ceil(n / CONTACTS_PAGE_SIZE)),
      rows,
      counts: counts ?? { active: 0, archived: 0, private: 0 },
      tags: tagRows.map((t) => t.tag),
    };
  });
}

async function findDuplicate(
  tx: Tx,
  workspaceId: string,
  email: string,
  visibility: string,
  userId: string,
  exceptId?: string,
) {
  const [dup] = await tx
    .select({ id: schema.contacts.id, name: schema.contacts.name })
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.workspaceId, workspaceId),
        sql`lower(${schema.contacts.email}) = ${email}`,
        visibility === 'private'
          ? and(eq(schema.contacts.visibility, 'private'), eq(schema.contacts.ownerUserId, userId))
          : eq(schema.contacts.visibility, 'shared'),
        exceptId ? sql`${schema.contacts.id} <> ${exceptId}::uuid` : sql`true`,
      ),
    );
  return dup ?? null;
}

async function permission(tx: Tx, ws: string) {
  const [r] = (await tx.execute(
    sql`select st_has_permission(${ws}::uuid, 'contacts.manage') as ok`,
  )) as unknown as { ok: boolean }[];
  if (!r?.ok) throw new AppError('forbidden', 'Your role does not allow editing contacts.');
}

export async function createContact(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: ContactInput,
  meta: Meta = {},
) {
  if (!uuid.safeParse(workspaceId).success) throw new AppError('not_found', 'Workspace not found');
  const input = contactSchema.parse(raw);
  return withActor(db, actor, async (tx) => {
    await permission(tx, workspaceId);
    const dup = await findDuplicate(tx, workspaceId, input.email, input.visibility, actor.userId);
    if (dup)
      throw new AppError(
        'conflict',
        `${dup.name} already uses this email. Edit that contact instead.`,
      );
    const [c] = await tx
      .insert(schema.contacts)
      .values({ ...input, workspaceId, ownerUserId: actor.userId })
      .returning();
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'contact.created',
      targetType: 'contact',
      targetId: c!.id,
      ...meta,
    });
    return c!;
  });
}

async function loadContact(tx: Tx, id: string) {
  if (!uuid.safeParse(id).success) throw new AppError('not_found', 'Contact not found');
  const [c] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, id));
  if (!c) throw new AppError('not_found', 'Contact not found');
  return c;
}

export async function updateContact(
  db: Database,
  actor: ActorContext,
  contactId: string,
  raw: ContactInput,
  meta: Meta = {},
) {
  const input = contactSchema.parse(raw);
  return withActor(db, actor, async (tx) => {
    const c = await loadContact(tx, contactId);
    await permission(tx, c.workspaceId);
    if (
      input.visibility === 'private' &&
      c.visibility === 'shared' &&
      c.ownerUserId !== actor.userId
    )
      throw new AppError(
        'forbidden',
        'Only the person who added a shared contact can make it private.',
      );
    const dup = await findDuplicate(
      tx,
      c.workspaceId,
      input.email,
      input.visibility,
      c.ownerUserId,
      c.id,
    );
    if (dup)
      throw new AppError('conflict', `${dup.name} already uses this email. Merge them instead.`);
    const res = await tx
      .update(schema.contacts)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.contacts.id, contactId))
      .returning();
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow editing this contact.');
    await recordAudit(tx, {
      workspaceId: c.workspaceId,
      actorUserId: actor.userId,
      action: 'contact.updated',
      targetType: 'contact',
      targetId: contactId,
      ...meta,
    });
    return res[0]!;
  });
}

export async function setContactArchived(
  db: Database,
  actor: ActorContext,
  contactId: string,
  archived: boolean,
  meta: Meta = {},
) {
  await withActor(db, actor, async (tx) => {
    const c = await loadContact(tx, contactId);
    await permission(tx, c.workspaceId);
    await tx
      .update(schema.contacts)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.contacts.id, contactId));
    await recordAudit(tx, {
      workspaceId: c.workspaceId,
      actorUserId: actor.userId,
      action: archived ? 'contact.archived' : 'contact.unarchived',
      targetType: 'contact',
      targetId: contactId,
      ...meta,
    });
  });
}

/** Deletes an address book entry. Documents sent to that address are not affected. */
export async function deleteContact(
  db: Database,
  actor: ActorContext,
  contactId: string,
  meta: Meta = {},
) {
  await withActor(db, actor, async (tx) => {
    const c = await loadContact(tx, contactId);
    await permission(tx, c.workspaceId);
    const res = await tx
      .delete(schema.contacts)
      .where(eq(schema.contacts.id, contactId))
      .returning({ id: schema.contacts.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow deleting this contact.');
    await recordAudit(tx, {
      workspaceId: c.workspaceId,
      actorUserId: actor.userId,
      action: 'contact.deleted',
      targetType: 'contact',
      targetId: contactId,
      ...meta,
    });
  });
}

/**
 * Merges `otherId` into `keepId`: empty fields are filled from the other contact, tags and notes
 * are combined, the most recent use is kept, and the other contact is deleted.
 */
export async function mergeContacts(
  db: Database,
  actor: ActorContext,
  keepId: string,
  otherId: string,
  meta: Meta = {},
) {
  if (keepId === otherId) throw new AppError('invalid', 'Choose two different contacts.');
  return withActor(db, actor, async (tx) => {
    const keep = await loadContact(tx, keepId);
    const other = await loadContact(tx, otherId);
    if (keep.workspaceId !== other.workspaceId)
      throw new AppError('not_found', 'Contact not found');
    await permission(tx, keep.workspaceId);
    const notes = [keep.notes, other.notes].filter(Boolean).join('\n\n') || null;
    const lastUsed =
      [keep.lastUsedAt, other.lastUsedAt]
        .filter(Boolean)
        .sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
    const del = await tx
      .delete(schema.contacts)
      .where(eq(schema.contacts.id, otherId))
      .returning({ id: schema.contacts.id });
    if (!del.length)
      throw new AppError('forbidden', 'Your role does not allow merging these contacts.');
    const [merged] = await tx
      .update(schema.contacts)
      .set({
        phone: keep.phone ?? other.phone,
        company: keep.company ?? other.company,
        jobTitle: keep.jobTitle ?? other.jobTitle,
        notes: notes ? notes.slice(0, 2000) : null,
        tags: [...new Set([...keep.tags, ...other.tags])].slice(0, 20),
        lastUsedAt: lastUsed,
        updatedAt: new Date(),
      })
      .where(eq(schema.contacts.id, keepId))
      .returning();
    await recordAudit(tx, {
      workspaceId: keep.workspaceId,
      actorUserId: actor.userId,
      action: 'contact.merged',
      targetType: 'contact',
      targetId: keepId,
      metadata: { mergedFrom: otherId, mergedEmail: other.email },
      ...meta,
    });
    return merged!;
  });
}

/** One contact with the document history the viewer may see and the contacts it could merge with. */
export async function getContact(db: Database, actor: ActorContext, contactId: string) {
  return withActor(db, actor, async (tx) => {
    const c = await loadContact(tx, contactId);
    // Document history: only requests the viewer can already see (RLS decides).
    const history = (await tx.execute(sql`
      select d.id as document_id, d.title, sr.id as request_id, sr.status::text as status, sr.sent_at,
             rr.status::text as recipient_status
      from request_recipients rr
      join signing_requests sr on sr.id = rr.request_id
      join documents d on d.id = sr.document_id
      where d.workspace_id = ${c.workspaceId}::uuid and lower(rr.email) = lower(${c.email})
      order by sr.created_at desc limit 50
    `)) as unknown as {
      document_id: string;
      title: string;
      request_id: string;
      status: string;
      sent_at: string | null;
      recipient_status: string;
    }[];
    const [owner] = await tx
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, c.ownerUserId));
    const others = await tx
      .select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email })
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.workspaceId, c.workspaceId),
          sql`${schema.contacts.id} <> ${c.id}::uuid`,
          isNull(schema.contacts.archivedAt),
        ),
      )
      .orderBy(asc(schema.contacts.name))
      .limit(500);
    const [can] = (await tx.execute(
      sql`select st_has_permission(${c.workspaceId}::uuid, 'contacts.manage') as ok`,
    )) as unknown as { ok: boolean }[];
    return {
      contact: c,
      ownerName: owner?.name ?? null,
      history: history.map((h) => ({
        documentId: h.document_id,
        title: h.title,
        requestId: h.request_id,
        status: h.status,
        recipientStatus: h.recipient_status,
        sentAt: h.sent_at ? new Date(h.sent_at) : null,
      })),
      mergeCandidates: others,
      canManage: Boolean(can?.ok),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// CSV import and export

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Prevents spreadsheet formula injection when exported files are opened in Excel or Sheets. */
function csvCell(v: string | null | undefined) {
  let s = v ?? '';
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER_ALIASES: Record<string, keyof ContactInput> = {
  name: 'name',
  'full name': 'name',
  email: 'email',
  'email address': 'email',
  phone: 'phone',
  company: 'company',
  organization: 'company',
  'job title': 'jobTitle',
  title: 'jobTitle',
  type: 'contactType',
  'contact type': 'contactType',
  notes: 'notes',
  tags: 'tags',
};

export interface ImportResult {
  created: number;
  skipped: { row: number; reason: string }[];
}

/** Imports shared contacts from CSV with a header row. Existing addresses are skipped, not overwritten. */
export async function importContacts(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  csv: string,
  meta: Meta = {},
): Promise<ImportResult> {
  if (csv.length > 1_000_000)
    throw new AppError('invalid', 'The file is too large. Import up to 1 MB at a time.');
  const rows = parseCsv(csv.replace(/^﻿/, ''));
  if (rows.length < 2)
    throw new AppError('invalid', 'The file needs a header row and at least one contact.');
  if (rows.length > 2001) throw new AppError('invalid', 'Import up to 2,000 contacts at a time.');
  const header = rows[0]!.map((h) => HEADER_ALIASES[h.trim().toLowerCase()]);
  if (!header.includes('name') || !header.includes('email'))
    throw new AppError('invalid', 'The header row must include Name and Email columns.');
  return withActor(db, actor, async (tx) => {
    await permission(tx, workspaceId);
    const existing = new Set(
      (
        await tx
          .select({ email: schema.contacts.email })
          .from(schema.contacts)
          .where(
            and(
              eq(schema.contacts.workspaceId, workspaceId),
              eq(schema.contacts.visibility, 'shared'),
            ),
          )
      ).map((r) => r.email.toLowerCase()),
    );
    const result: ImportResult = { created: 0, skipped: [] };
    const values: (z.output<typeof contactSchema> & {
      workspaceId: string;
      ownerUserId: string;
    })[] = [];
    rows.slice(1).forEach((cells, i) => {
      const obj: Record<string, string> = {};
      header.forEach((k, j) => {
        if (k) obj[k] = cells[j] ?? '';
      });
      const parsed = contactSchema.safeParse({ ...obj, visibility: 'shared' });
      if (!parsed.success) {
        result.skipped.push({
          row: i + 2,
          reason: parsed.error.issues[0]?.message ?? 'Invalid row',
        });
        return;
      }
      if (existing.has(parsed.data.email)) {
        result.skipped.push({ row: i + 2, reason: `${parsed.data.email} is already a contact` });
        return;
      }
      existing.add(parsed.data.email);
      values.push({ ...parsed.data, workspaceId, ownerUserId: actor.userId });
    });
    for (let i = 0; i < values.length; i += 500)
      await tx.insert(schema.contacts).values(values.slice(i, i + 500));
    result.created = values.length;
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'contact.imported',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: { created: result.created, skipped: result.skipped.length },
      ...meta,
    });
    return result;
  });
}

export async function exportContactsCsv(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  meta: Meta = {},
) {
  if (!uuid.safeParse(workspaceId).success) throw new AppError('not_found', 'Workspace not found');
  return withActor(db, actor, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, workspaceId), isNull(schema.contacts.archivedAt)))
      .orderBy(asc(schema.contacts.name));
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'contact.exported',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: { count: rows.length },
      ...meta,
    });
    const head = 'Name,Email,Phone,Company,Job title,Contact type,Tags,Notes,Visibility,Last used';
    const lines = rows.map((c) =>
      [
        c.name,
        c.email,
        c.phone,
        c.company,
        c.jobTitle,
        c.contactType,
        c.tags.join(', '),
        c.notes,
        c.visibility,
        c.lastUsedAt?.toISOString() ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
    return [head, ...lines].join('\r\n') + '\r\n';
  });
}

/** Address suggestions for the signers step: active contacts the viewer can see. */
export async function suggestContacts(db: Database, actor: ActorContext, workspaceId: string) {
  if (!uuid.safeParse(workspaceId).success) return [];
  return withActor(db, actor, (tx) =>
    tx
      .select({ name: schema.contacts.name, email: schema.contacts.email })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, workspaceId), isNull(schema.contacts.archivedAt)))
      .orderBy(desc(sql`coalesce(${schema.contacts.lastUsedAt}, ${schema.contacts.createdAt})`))
      .limit(300),
  );
}
