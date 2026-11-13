import { and, eq, sql } from 'drizzle-orm';
import { schema, withActor, type Database, type ActorContext } from '@st/db';
import { AppError } from '../errors';

export interface LinkInput {
  connectionId: string;
  externalObjectType: string;
  externalObjectId: string;
  externalLabel?: string | null;
  documentId: string;
  requestId?: string | null;
}

const TYPE_RE = /^[a-z][a-z0-9_]{0,40}$/;

/**
 * Links an external record to a document (and its signing request, once sent). Linking the same
 * record to the same document again updates the existing link instead of adding a duplicate.
 * The document and request are the canonical Signature Tender records; nothing is copied.
 */
export async function linkExternalRecord(db: Database, actor: ActorContext, l: LinkInput) {
  if (!TYPE_RE.test(l.externalObjectType)) throw new AppError('invalid', 'Invalid record type.');
  const extId = l.externalObjectId.trim();
  if (!extId || extId.length > 300) throw new AppError('invalid', 'Invalid external record id.');
  return withActor(db, actor, async (tx) => {
    const [conn] = await tx
      .select({
        workspaceId: schema.integrationConnections.workspaceId,
        provider: schema.integrationConnections.provider,
      })
      .from(schema.integrationConnections)
      .where(eq(schema.integrationConnections.id, l.connectionId));
    if (!conn) throw new AppError('not_found', 'This connection was not found.');
    const [row] = await tx
      .insert(schema.integrationMappings)
      .values({
        workspaceId: conn.workspaceId,
        connectionId: l.connectionId,
        provider: conn.provider,
        externalObjectType: l.externalObjectType,
        externalObjectId: extId,
        externalLabel: l.externalLabel?.slice(0, 200) ?? null,
        documentId: l.documentId,
        requestId: l.requestId ?? null,
        createdBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: [
          schema.integrationMappings.connectionId,
          schema.integrationMappings.externalObjectType,
          schema.integrationMappings.externalObjectId,
          schema.integrationMappings.documentId,
        ],
        set: {
          // Never unlink a request that was already recorded.
          requestId: sql`coalesce(excluded.request_id, ${schema.integrationMappings.requestId})`,
          externalLabel: sql`coalesce(excluded.external_label, ${schema.integrationMappings.externalLabel})`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.integrationMappings.id });
    return row!.id;
  });
}

export async function setMappingSyncStatus(
  db: Database,
  actor: ActorContext,
  mappingId: string,
  status: 'pending' | 'synced' | 'failed',
) {
  await withActor(db, actor, (tx) =>
    tx
      .update(schema.integrationMappings)
      .set({
        syncStatus: status,
        lastSyncedAt: status === 'synced' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationMappings.id, mappingId)),
  );
}

/** External records linked to a document or request. */
export async function listMappingsForDocument(
  db: Database,
  actor: ActorContext,
  documentId: string,
) {
  return withActor(db, actor, (tx) =>
    tx
      .select({
        id: schema.integrationMappings.id,
        connectionId: schema.integrationMappings.connectionId,
        provider: schema.integrationMappings.provider,
        externalObjectType: schema.integrationMappings.externalObjectType,
        externalObjectId: schema.integrationMappings.externalObjectId,
        externalLabel: schema.integrationMappings.externalLabel,
        requestId: schema.integrationMappings.requestId,
        syncStatus: schema.integrationMappings.syncStatus,
        lastSyncedAt: schema.integrationMappings.lastSyncedAt,
      })
      .from(schema.integrationMappings)
      .where(eq(schema.integrationMappings.documentId, documentId)),
  );
}

/** Documents already linked to an external record, to avoid importing the same record twice. */
export async function findMappingsByExternal(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  provider: string,
  externalObjectType: string,
  externalObjectId: string,
) {
  return withActor(db, actor, (tx) =>
    tx
      .select()
      .from(schema.integrationMappings)
      .where(
        and(
          eq(schema.integrationMappings.workspaceId, workspaceId),
          eq(schema.integrationMappings.provider, provider),
          eq(schema.integrationMappings.externalObjectType, externalObjectType),
          eq(schema.integrationMappings.externalObjectId, externalObjectId),
        ),
      ),
  );
}

/**
 * Envelopes sent through each integration, for usage-by-integration reporting. Counts sent
 * (non-test) requests linked to an integration record; billing itself is the normal ledger.
 */
export async function integrationUsage(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  sinceDays = 30,
) {
  return withActor(db, actor, async (tx) => {
    const rows = (await tx.execute(sql`
      select m.provider, count(distinct r.id)::int as envelopes,
        count(distinct r.id) filter (where r.status = 'completed')::int as completed
      from integration_mappings m
      join signing_requests r on r.id = m.request_id
      where m.workspace_id = ${workspaceId}::uuid and r.is_test = false
        and r.sent_at > now() - make_interval(days => ${sinceDays})
      group by m.provider order by envelopes desc`)) as unknown as {
      provider: string;
      envelopes: number;
      completed: number;
    }[];
    return rows;
  });
}
