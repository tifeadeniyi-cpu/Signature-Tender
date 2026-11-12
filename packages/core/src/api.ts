import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { schema, withActor, type Database, type ActorContext, type Tx } from '@st/db';
import { AppError } from './errors';
import { recordAudit } from './audit';
import { newSecret, hashSecret, sha256Hex } from './signing-crypto';
import { appendEvidenceEvent, type Invitation } from './signing';
import { getBalances } from './billing';
import { getConfigValue } from './config';

type Meta = { ipAddress?: string | null; userAgent?: string | null };
const uuid = z.string().uuid();

/**
 * Scopes a key can carry. A key also acts as the member who created it, so it can never do more
 * than that member's role allows, and only inside the key's workspace.
 */
export const API_SCOPES = {
  'documents:read': 'Read documents, requests, status and events',
  'documents:write': 'Upload documents and set recipients, fields and settings',
  'requests:send': 'Send, cancel and remind signing requests',
  'files:read': 'Download completed documents and certificates',
  'embedded:sign': 'Create embedded signing sessions',
  'billing:read': 'Read credit balance and usage',
} as const;
export type ApiScope = keyof typeof API_SCOPES;
const scopeEnum = z.enum(Object.keys(API_SCOPES) as [ApiScope, ...ApiScope[]]);

export const apiKeyInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the key').max(80),
  scopes: z.array(scopeEnum).min(1, 'Choose at least one scope').max(20),
  expiresInDays: z.number().int().min(1).max(730).nullable().optional(),
});

const KEY_PREFIX = 'stk_';

async function requireApiManage(tx: Tx, ws: string) {
  const [r] = (await tx.execute(
    sql`select st_has_permission(${ws}::uuid, 'api.manage') as ok`,
  )) as unknown as { ok: boolean }[];
  if (!r?.ok) throw new AppError('forbidden', 'Your role does not allow managing API keys.');
}

/** Creates a key. The full key is returned once and never stored. */
export async function createApiKey(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: z.input<typeof apiKeyInputSchema>,
  meta: Meta = {},
): Promise<{ id: string; key: string; prefix: string }> {
  if (!uuid.safeParse(workspaceId).success) throw new AppError('not_found', 'Workspace not found');
  const input = apiKeyInputSchema.parse(raw);
  const key = `${KEY_PREFIX}${newSecret()}`;
  const prefix = key.slice(0, 12);
  const id = await withActor(db, actor, async (tx) => {
    await requireApiManage(tx, workspaceId);
    const [row] = await tx
      .insert(schema.apiKeys)
      .values({
        workspaceId,
        name: input.name,
        prefix,
        keyHash: hashSecret(key),
        scopes: [...new Set(input.scopes)],
        createdBy: actor.userId,
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86_400_000)
          : null,
      })
      .returning({ id: schema.apiKeys.id });
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'api.key_created',
      targetType: 'api_key',
      targetId: row!.id,
      metadata: { name: input.name, scopes: input.scopes, prefix },
      ...meta,
    });
    return row!.id;
  });
  return { id, key, prefix };
}

export async function listApiKeys(db: Database, actor: ActorContext, workspaceId: string) {
  return withActor(db, actor, async (tx) => {
    await requireApiManage(tx, workspaceId);
    return tx
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        prefix: schema.apiKeys.prefix,
        scopes: schema.apiKeys.scopes,
        createdAt: schema.apiKeys.createdAt,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        expiresAt: schema.apiKeys.expiresAt,
        revokedAt: schema.apiKeys.revokedAt,
        createdByName: schema.user.name,
      })
      .from(schema.apiKeys)
      .innerJoin(schema.user, eq(schema.user.id, schema.apiKeys.createdBy))
      .where(eq(schema.apiKeys.workspaceId, workspaceId))
      .orderBy(desc(schema.apiKeys.createdAt));
  });
}

export async function revokeApiKey(
  db: Database,
  actor: ActorContext,
  keyId: string,
  meta: Meta = {},
) {
  if (!uuid.safeParse(keyId).success) throw new AppError('not_found', 'Key not found');
  await withActor(db, actor, async (tx) => {
    const [k] = await tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, keyId));
    if (!k) throw new AppError('not_found', 'Key not found');
    if (k.revokedAt) return;
    await tx
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(schema.apiKeys.id, keyId));
    await recordAudit(tx, {
      workspaceId: k.workspaceId,
      actorUserId: actor.userId,
      action: 'api.key_revoked',
      targetType: 'api_key',
      targetId: keyId,
      metadata: { prefix: k.prefix },
      ...meta,
    });
  });
}

/** Issues a replacement with the same scopes. The old key keeps working for 24 hours. */
export async function rotateApiKey(
  db: Database,
  actor: ActorContext,
  keyId: string,
  meta: Meta = {},
) {
  if (!uuid.safeParse(keyId).success) throw new AppError('not_found', 'Key not found');
  const old = await withActor(db, actor, async (tx) => {
    const [k] = await tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, keyId));
    if (!k || k.revokedAt) throw new AppError('not_found', 'Key not found');
    return k;
  });
  const next = await createApiKey(
    db,
    actor,
    old.workspaceId,
    { name: old.name, scopes: old.scopes as ApiScope[] },
    meta,
  );
  await withActor(db, actor, async (tx) => {
    const grace = new Date(Date.now() + 86_400_000);
    await tx
      .update(schema.apiKeys)
      .set({ expiresAt: old.expiresAt && old.expiresAt < grace ? old.expiresAt : grace })
      .where(eq(schema.apiKeys.id, keyId));
  });
  return next;
}

export interface ApiPrincipal {
  keyId: string;
  workspaceId: string;
  actor: ActorContext;
  scopes: ApiScope[];
}

/** Checks a presented key. Returns null for unknown, revoked, expired or orphaned keys. */
export async function authenticateApiKey(
  db: Database,
  presented: string,
): Promise<ApiPrincipal | null> {
  if (!presented.startsWith(KEY_PREFIX) || presented.length < 30 || presented.length > 200)
    return null;
  const rows = (await db.transaction((tx) =>
    tx.execute(sql`select * from st_api_key_lookup(${hashSecret(presented)})`),
  )) as unknown as { id: string; workspace_id: string; created_by: string; scopes: string[] }[];
  const k = rows[0];
  if (!k) return null;
  return {
    keyId: k.id,
    workspaceId: k.workspace_id,
    actor: { userId: k.created_by },
    scopes: k.scopes.filter((s): s is ApiScope => s in API_SCOPES),
  };
}

export function requireScope(p: ApiPrincipal, scope: ApiScope) {
  if (!p.scopes.includes(scope))
    throw new AppError('forbidden', `This API key does not have the ${scope} scope.`);
}

/** Counts a request against the key's per-minute limit. */
export async function hitRateLimit(
  db: Database,
  keyId: string,
  perMinute: number,
): Promise<boolean> {
  const [r] = (await db.transaction((tx) =>
    tx.execute(sql`select st_api_rate_hit(${keyId}::uuid, ${perMinute}) as ok`),
  )) as unknown as { ok: boolean }[];
  return Boolean(r?.ok);
}

/** Counts a failed call (4xx or 5xx) in the key's daily usage. */
export async function recordApiError(db: Database, keyId: string) {
  await db.transaction((tx) => tx.execute(sql`select st_api_usage_error(${keyId}::uuid)`));
}

export type IdempotencyStart =
  | { state: 'new' }
  | { state: 'replay'; status: number; body: unknown }
  | { state: 'mismatch' }
  | { state: 'in_progress' };

export async function beginIdempotent(
  db: Database,
  keyId: string,
  idemKey: string,
  requestFingerprint: string,
): Promise<IdempotencyStart> {
  if (!/^[\w.:-]{8,200}$/.test(idemKey))
    throw new AppError(
      'invalid',
      'Idempotency-Key must be 8 to 200 letters, digits, dots, dashes or colons.',
    );
  const [r] = (await db.transaction((tx) =>
    tx.execute(
      sql`select * from st_api_idem_begin(${keyId}::uuid, ${idemKey}, ${sha256Hex(requestFingerprint)})`,
    ),
  )) as unknown as { state: string; status: number | null; body: unknown }[];
  if (r?.state === 'replay') return { state: 'replay', status: r.status!, body: r.body };
  return { state: (r?.state ?? 'new') as 'new' | 'mismatch' | 'in_progress' };
}

export async function finishIdempotent(
  db: Database,
  keyId: string,
  idemKey: string,
  status: number,
  body: unknown,
) {
  await db.transaction((tx) =>
    tx.execute(
      sql`select st_api_idem_finish(${keyId}::uuid, ${idemKey}, ${status}, ${JSON.stringify(body ?? null)}::jsonb)`,
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Resource guards and API-only operations

/** Every API call stays inside the key's workspace, even when its member belongs to others. */
export async function assertDocumentInWorkspace(db: Database, p: ApiPrincipal, documentId: string) {
  if (!uuid.safeParse(documentId).success) throw new AppError('not_found', 'Document not found');
  const [d] = await withActor(db, p.actor, (tx) =>
    tx
      .select({ workspaceId: schema.documents.workspaceId })
      .from(schema.documents)
      .where(and(eq(schema.documents.id, documentId), sql`${schema.documents.deletedAt} is null`)),
  );
  if (!d || d.workspaceId !== p.workspaceId) throw new AppError('not_found', 'Document not found');
}

export async function assertRequestInWorkspace(db: Database, p: ApiPrincipal, requestId: string) {
  if (!uuid.safeParse(requestId).success) throw new AppError('not_found', 'Request not found');
  const [r] = await withActor(db, p.actor, (tx) =>
    tx
      .select({
        workspaceId: schema.signingRequests.workspaceId,
        documentId: schema.signingRequests.documentId,
      })
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId)),
  );
  if (!r || r.workspaceId !== p.workspaceId) throw new AppError('not_found', 'Request not found');
  return r;
}

export const externalRefSchema = z.object({
  source: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9_-]{2,40}$/,
      'source must be 2 to 40 lowercase letters, digits, dashes or underscores',
    ),
  id: z.string().trim().min(1).max(200),
  metadata: z.record(z.string().max(60), z.string().max(500)).optional(),
});

export async function setExternalRef(
  db: Database,
  actor: ActorContext,
  documentId: string,
  raw: z.input<typeof externalRefSchema>,
) {
  const ref = externalRefSchema.parse(raw);
  if (ref.metadata && Object.keys(ref.metadata).length > 20)
    throw new AppError('invalid', 'metadata can hold up to 20 keys.');
  await withActor(db, actor, async (tx) => {
    const res = await tx
      .update(schema.documents)
      .set({
        externalSource: ref.source,
        externalId: ref.id,
        externalMetadata: ref.metadata ?? null,
      })
      .where(eq(schema.documents.id, documentId))
      .returning({ id: schema.documents.id });
    if (!res.length) throw new AppError('forbidden', 'You cannot edit this document.');
  });
}

/** Looks up documents by a partner's record reference. */
export async function findByExternalRef(db: Database, p: ApiPrincipal, source: string, id: string) {
  return withActor(db, p.actor, (tx) =>
    tx
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        status: schema.documents.status,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.workspaceId, p.workspaceId),
          eq(schema.documents.externalSource, source),
          eq(schema.documents.externalId, id),
          sql`${schema.documents.deletedAt} is null`,
        ),
      )
      .orderBy(desc(schema.documents.createdAt))
      .limit(50),
  );
}

export async function getRequestStatus(db: Database, actor: ActorContext, requestId: string) {
  return withActor(db, actor, async (tx) => {
    const [r] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (!r) throw new AppError('not_found', 'Request not found');
    const recipients = await tx
      .select()
      .from(schema.requestRecipients)
      .where(eq(schema.requestRecipients.requestId, requestId))
      .orderBy(asc(schema.requestRecipients.signingOrder), asc(schema.requestRecipients.createdAt));
    return {
      id: r.id,
      document_id: r.documentId,
      status: r.status,
      test: r.isTest,
      title: r.title,
      signing_order: r.signingOrderEnabled,
      sent_at: r.sentAt,
      completed_at: r.completedAt,
      expires_at: r.expiresAt,
      closed_at: r.closedAt,
      closed_reason: r.closedReason,
      signed_document_available: Boolean(r.signedFileId && r.status === 'completed'),
      certificate_available: Boolean(r.certificateFileId && r.status === 'completed'),
      recipients: recipients.map((x) => ({
        id: x.id,
        name: x.name,
        email: x.email,
        role: x.role,
        signing_order: x.signingOrder,
        status: x.status,
        viewed_at: x.viewedAt,
        signed_at: x.signedAt,
        declined_at: x.declinedAt,
      })),
    };
  });
}

/** The tamper-evident evidence log of a request, without IP addresses or hashes of secrets. */
export async function listRequestEvents(db: Database, actor: ActorContext, requestId: string) {
  return withActor(db, actor, async (tx) => {
    const rows = await tx
      .select({
        seq: schema.signingEvents.seq,
        type: schema.signingEvents.type,
        recipientId: schema.signingEvents.recipientId,
        createdAt: schema.signingEvents.createdAt,
        hash: schema.signingEvents.hash,
      })
      .from(schema.signingEvents)
      .where(eq(schema.signingEvents.requestId, requestId))
      .orderBy(asc(schema.signingEvents.seq));
    return rows.map((e) => ({
      seq: e.seq,
      type: e.type,
      recipient_id: e.recipientId,
      at: e.createdAt,
      hash: e.hash,
    }));
  });
}

const OPEN_STATUSES = ['sent', 'in_progress', 'awaiting_approval'];

async function requireCanSend(tx: Tx, requestId: string) {
  const [r] = (await tx.execute(
    sql`select st_can_send_request(${requestId}::uuid) as ok`,
  )) as unknown as { ok: boolean }[];
  if (!r?.ok) throw new AppError('forbidden', 'Your role does not allow managing this request.');
}

async function rotateLink(
  tx: Tx,
  r: typeof schema.requestRecipients.$inferSelect,
  expiresAt: Date,
) {
  const token = newSecret();
  const res = await tx
    .update(schema.requestRecipients)
    .set({
      tokenHash: hashSecret(token),
      tokenExpiresAt: expiresAt,
      sessionHash: null,
      sessionExpiresAt: null,
    })
    .where(eq(schema.requestRecipients.id, r.id))
    .returning({ id: schema.requestRecipients.id });
  if (!res.length)
    throw new AppError('forbidden', 'Your role does not allow managing this request.');
  return token;
}

/**
 * A short-lived signing link for one recipient whose turn it is, for a partner app to open in its
 * own interface. It replaces the recipient's earlier link.
 */
export async function createEmbeddedSigningSession(
  db: Database,
  actor: ActorContext,
  requestId: string,
  recipientId: string,
  opts: { ttlMinutes: number },
  meta: Meta = {},
): Promise<{ token: string; expiresAt: Date }> {
  if (!uuid.safeParse(recipientId).success) throw new AppError('not_found', 'Recipient not found');
  const ttl = Math.min(Math.max(opts.ttlMinutes, 1), 60);
  return withActor(db, actor, async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (!req) throw new AppError('not_found', 'Request not found');
    await requireCanSend(tx, requestId);
    const [r] = await tx
      .select()
      .from(schema.requestRecipients)
      .where(
        and(
          eq(schema.requestRecipients.id, recipientId),
          eq(schema.requestRecipients.requestId, requestId),
        ),
      );
    if (!r) throw new AppError('not_found', 'Recipient not found');
    if (!OPEN_STATUSES.includes(req.status) || !['notified', 'viewed'].includes(r.status))
      throw new AppError('conflict', 'This recipient has nothing to sign right now.');
    const expiresAt = new Date(Date.now() + ttl * 60_000);
    const cap = req.expiresAt && req.expiresAt < expiresAt ? req.expiresAt : expiresAt;
    const token = await rotateLink(tx, r, cap);
    await appendEvidenceEvent(tx, {
      requestId,
      workspaceId: req.workspaceId,
      actorUserId: actor.userId,
      recipientId: r.id,
      type: 'recipient.embedded_session_created',
      data: { ttlMinutes: ttl },
      ...meta,
    });
    return { token, expiresAt: cap };
  });
}

/** New links for recipients whose turn it is, to email as a reminder. At most once an hour. */
export async function remindRecipients(
  db: Database,
  actor: ActorContext,
  requestId: string,
  meta: Meta = {},
): Promise<{
  invitations: Invitation[];
  title: string;
  senderName: string;
  workspaceName: string;
  workspaceId: string;
  isTest: boolean;
  emailMessage: string | null;
}> {
  const days = await getConfigValue(db, 'signing.link_valid_days', 30);
  return withActor(db, actor, async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    if (!req) throw new AppError('not_found', 'Request not found');
    await requireCanSend(tx, requestId);
    // One reminder at a time per request.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'remind:' + requestId}, 0))`,
    );
    if (!OPEN_STATUSES.includes(req.status))
      throw new AppError('conflict', 'This request is not waiting on anyone.');
    const [recent] = await tx
      .select({ at: schema.signingEvents.createdAt })
      .from(schema.signingEvents)
      .where(
        and(
          eq(schema.signingEvents.requestId, requestId),
          eq(schema.signingEvents.type, 'recipient.reminded'),
          sql`${schema.signingEvents.createdAt} > now() - interval '1 hour'`,
        ),
      )
      .limit(1);
    if (recent)
      throw new AppError('rate_limited', 'A reminder was sent in the last hour. Try again later.');
    const pending = await tx
      .select()
      .from(schema.requestRecipients)
      .where(
        and(
          eq(schema.requestRecipients.requestId, requestId),
          sql`${schema.requestRecipients.status} in ('notified','viewed')`,
        ),
      );
    if (!pending.length) throw new AppError('conflict', 'Nobody is waiting to sign right now.');
    const expiresAt = req.expiresAt ?? new Date(Date.now() + days * 86_400_000);
    const invitations: Invitation[] = [];
    for (const r of pending) {
      const token = await rotateLink(tx, r, expiresAt);
      invitations.push({ recipientId: r.id, name: r.name, email: r.email, token, kind: 'sign' });
      await appendEvidenceEvent(tx, {
        requestId,
        workspaceId: req.workspaceId,
        actorUserId: actor.userId,
        recipientId: r.id,
        type: 'recipient.reminded',
        ...meta,
      });
    }
    return {
      invitations,
      title: req.title,
      senderName: req.senderName,
      workspaceName: req.workspaceName,
      workspaceId: req.workspaceId,
      isTest: req.isTest,
      emailMessage: req.emailMessage,
    };
  });
}

export async function getCreditBalance(db: Database, p: ApiPrincipal) {
  return withActor(db, p.actor, async (tx) => {
    const [ok] = (await tx.execute(
      sql`select st_has_permission(${p.workspaceId}::uuid, 'billing.manage') as ok`,
    )) as unknown as { ok: boolean }[];
    if (!ok?.ok) throw new AppError('forbidden', 'The member behind this key cannot view billing.');
    return getBalances(tx, p.workspaceId);
  });
}

/** Requests created per month for the last `months` months, split into live and test. */
export async function getUsage(db: Database, p: ApiPrincipal, months = 6) {
  const n = Math.min(Math.max(months, 1), 24);
  return withActor(db, p.actor, async (tx) => {
    const rows = (await tx.execute(sql`
      select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
             count(*) filter (where not is_test)::int as live,
             count(*) filter (where is_test)::int as test,
             count(*) filter (where status = 'completed')::int as completed
      from signing_requests
      where workspace_id = ${p.workspaceId}::uuid and created_at >= date_trunc('month', now()) - (${n - 1} * interval '1 month')
      group by 1 order by 1
    `)) as unknown as { month: string; live: number; test: number; completed: number }[];
    return rows;
  });
}
