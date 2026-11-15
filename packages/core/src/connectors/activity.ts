import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { schema, withActor, type Database, type ActorContext, type Tx } from '@st/db';

export type ActivityStatus = 'success' | 'pending' | 'retrying' | 'failed' | 'cancelled';

export interface ActivityInput {
  workspaceId: string;
  connectionId?: string | null;
  provider: string;
  action: string;
  status: ActivityStatus;
  actorUserId: string;
  jobId?: string | null;
  documentId?: string | null;
  requestId?: string | null;
  externalReference?: string | null;
  correlationId?: string | null;
  durationMs?: number | null;
  errorCode?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEY =
  /token|secret|password|passwd|authorization|auth_code|^code$|api[_-]?key|cookie|session|email|phone|content|body|file_?data|signature_?image|ssn/i;
const BEARER = /\b(bearer\s+)[a-z0-9._~+/=-]+/gi;
const LONG_SECRET = /\b[a-z0-9_-]{40,}\b/gi;
const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi;

/** Removes secrets and personal details from free text before it is stored or shown. */
export function sanitizeText(s: string, max = 500): string {
  return s
    .replace(BEARER, '$1[redacted]')
    .replace(EMAIL, '[email]')
    .replace(LONG_SECRET, '[redacted]')
    .slice(0, max);
}

/**
 * Keeps log metadata to references and outcomes: drops keys that could hold secrets, tokens,
 * personal details or document contents, shortens strings, and limits nesting.
 */
export function sanitizeMetadata(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    if (SENSITIVE_KEY.test(k)) continue;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = sanitizeText(v, 200);
    else if (Array.isArray(v))
      out[k] = v
        .slice(0, 10)
        .map((x) =>
          typeof x === 'string' ? sanitizeText(x, 100) : typeof x === 'number' ? x : null,
        );
    else if (typeof v === 'object' && depth < 2) out[k] = sanitizeMetadata(v, depth + 1);
  }
  return out;
}

export async function logActivity(tx: Tx, a: ActivityInput) {
  const [row] = await tx
    .insert(schema.integrationActivity)
    .values({
      workspaceId: a.workspaceId,
      connectionId: a.connectionId ?? null,
      provider: a.provider,
      action: a.action,
      status: a.status,
      actorUserId: a.actorUserId,
      jobId: a.jobId ?? null,
      documentId: a.documentId ?? null,
      requestId: a.requestId ?? null,
      externalReference: a.externalReference ? sanitizeText(a.externalReference, 200) : null,
      correlationId: a.correlationId ?? null,
      durationMs: a.durationMs ?? null,
      errorCode: a.errorCode ?? null,
      message: a.message ? sanitizeText(a.message) : null,
      metadata: sanitizeMetadata(a.metadata ?? {}),
    })
    .returning({ id: schema.integrationActivity.id });
  return row!.id;
}

export interface ActivityFilter {
  provider?: string;
  connectionId?: string;
  status?: ActivityStatus;
  /** Cursor: entries older than this time. */
  before?: Date;
  limit?: number;
}

/** Activity & Sync Logs. RLS limits it to the member's own entries unless they can view logs. */
export async function listIntegrationActivity(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  f: ActivityFilter = {},
) {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  return withActor(db, actor, (tx) =>
    tx
      .select({
        id: schema.integrationActivity.id,
        occurredAt: schema.integrationActivity.occurredAt,
        provider: schema.integrationActivity.provider,
        connectionId: schema.integrationActivity.connectionId,
        connectionLabel: schema.integrationConnections.externalAccountLabel,
        action: schema.integrationActivity.action,
        status: schema.integrationActivity.status,
        externalReference: schema.integrationActivity.externalReference,
        documentId: schema.integrationActivity.documentId,
        requestId: schema.integrationActivity.requestId,
        jobId: schema.integrationActivity.jobId,
        correlationId: schema.integrationActivity.correlationId,
        durationMs: schema.integrationActivity.durationMs,
        errorCode: schema.integrationActivity.errorCode,
        message: schema.integrationActivity.message,
        metadata: schema.integrationActivity.metadata,
      })
      .from(schema.integrationActivity)
      .leftJoin(
        schema.integrationConnections,
        eq(schema.integrationConnections.id, schema.integrationActivity.connectionId),
      )
      .where(
        and(
          eq(schema.integrationActivity.workspaceId, workspaceId),
          f.provider ? eq(schema.integrationActivity.provider, f.provider) : undefined,
          f.connectionId ? eq(schema.integrationActivity.connectionId, f.connectionId) : undefined,
          f.status ? eq(schema.integrationActivity.status, f.status) : undefined,
          f.before ? lt(schema.integrationActivity.occurredAt, f.before) : undefined,
        ),
      )
      .orderBy(
        desc(schema.integrationActivity.occurredAt),
        desc(sql`${schema.integrationActivity.id}`),
      )
      .limit(limit),
  );
}
