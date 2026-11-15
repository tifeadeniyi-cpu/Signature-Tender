import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { schema, withActor, type Database, type ActorContext } from '@st/db';
import { AppError } from './errors';
import { recordAudit } from './audit';
import { CONNECTORS } from './connectors/registry';
import { createApiKey, revokeApiKey, type ApiScope } from './api';
import {
  createSlackEndpoint,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  sendTestWebhook,
  type WebhookContext,
} from './webhooks';

type Meta = { ipAddress?: string | null; userAgent?: string | null };

/**
 * Legacy shape of the catalogue, used by the Phase 7 Integrations page. The catalogue itself lives in
 * connectors/registry.ts; only partner and Slack connectors are connected through this file.
 */
export interface IntegrationInfo {
  key: string;
  name: string;
  category: string;
  description: string;
  available: boolean;
  /** `api`: the partner calls our API with a key. `slack`: we post messages to a Slack webhook. */
  kind?: 'api' | 'slack';
  /** Scopes the connection's API key gets. */
  scopes?: ApiScope[];
  note?: string;
}

const PARTNER_SCOPES: ApiScope[] = [
  'documents:read',
  'documents:write',
  'requests:send',
  'files:read',
  'embedded:sign',
];

export const INTEGRATIONS: IntegrationInfo[] = CONNECTORS.map((c) => ({
  key: c.key,
  name: c.name,
  category: c.category,
  description: c.description,
  available:
    c.implemented && (c.auth.type === 'partner_api_key' || c.auth.type === 'slack_webhook'),
  kind:
    c.auth.type === 'partner_api_key'
      ? 'api'
      : c.auth.type === 'slack_webhook'
        ? 'slack'
        : undefined,
  scopes: c.auth.type === 'partner_api_key' ? PARTNER_SCOPES : undefined,
}));

export function getIntegration(key: string) {
  return INTEGRATIONS.find((i) => i.key === key);
}

export async function listConnections(db: Database, actor: ActorContext, workspaceId: string) {
  return withActor(db, actor, (tx) =>
    tx
      .select({
        id: schema.integrationConnections.id,
        provider: schema.integrationConnections.provider,
        status: schema.integrationConnections.status,
        createdAt: schema.integrationConnections.createdAt,
        updatedAt: schema.integrationConnections.updatedAt,
        apiKeyPrefix: schema.apiKeys.prefix,
        apiKeyLastUsedAt: schema.apiKeys.lastUsedAt,
        apiKeyRevokedAt: schema.apiKeys.revokedAt,
        webhookUrl: sql<
          string | null
        >`case when ${schema.webhookEndpoints.format} = 'slack' then 'https://hooks.slack.com/services/••••' else ${schema.webhookEndpoints.url} end`,
        webhookEnabled: schema.webhookEndpoints.enabled,
        failedDeliveries: sql<number>`(select count(*)::int from webhook_deliveries d where d.endpoint_id = ${schema.integrationConnections.webhookEndpointId} and d.status in ('failed','dead'))`,
      })
      .from(schema.integrationConnections)
      .leftJoin(schema.apiKeys, eq(schema.apiKeys.id, schema.integrationConnections.apiKeyId))
      .leftJoin(
        schema.webhookEndpoints,
        eq(schema.webhookEndpoints.id, schema.integrationConnections.webhookEndpointId),
      )
      .where(
        and(
          eq(schema.integrationConnections.workspaceId, workspaceId),
          sql`${schema.integrationConnections.externalAccountId} is null`,
        ),
      ),
  );
}

export const connectInputSchema = z.object({
  provider: z.string(),
  webhookUrl: z.string().trim().max(2000).optional().or(z.literal('')),
});

async function saveConnection(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  provider: string,
  apiKeyId: string | null,
  webhookEndpointId: string | null,
  meta: Meta,
  metadata: Record<string, unknown>,
) {
  await withActor(db, actor, async (tx) => {
    await tx
      .insert(schema.integrationConnections)
      .values({
        workspaceId,
        provider,
        status: 'active',
        apiKeyId,
        webhookEndpointId,
        createdBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: [schema.integrationConnections.workspaceId, schema.integrationConnections.provider],
        targetWhere: sql`${schema.integrationConnections.externalAccountId} is null`,
        set: { status: 'active', apiKeyId, webhookEndpointId, updatedAt: new Date() },
      });
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'integration.connected',
      targetType: 'integration',
      targetId: provider,
      metadata,
      ...meta,
    });
  });
}

/**
 * Connects a partner app: issues an API key with the partner's scopes and, if given, a webhook
 * endpoint for status updates. The key and webhook secret are returned once, to paste into the
 * partner app.
 */
export async function connectIntegration(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: z.input<typeof connectInputSchema>,
  ctx: WebhookContext,
  meta: Meta = {},
): Promise<{ apiKey: string | null; webhookSecret: string | null }> {
  const input = connectInputSchema.parse(raw);
  const info = getIntegration(input.provider);
  if (!info?.available) throw new AppError('invalid', 'This integration is not available yet.');
  const existing = await withActor(db, actor, async (tx) => {
    const [ok] = (await tx.execute(
      sql`select st_has_permission(${workspaceId}::uuid, 'integrations.manage') and st_has_permission(${workspaceId}::uuid, 'api.manage') as ok`,
    )) as unknown as { ok: boolean }[];
    if (!ok?.ok)
      throw new AppError('forbidden', 'Your role does not allow connecting integrations.');
    const [c] = await tx
      .select()
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.workspaceId, workspaceId),
          eq(schema.integrationConnections.provider, info.key),
          sql`${schema.integrationConnections.externalAccountId} is null`,
        ),
      );
    return c;
  });
  if (existing?.status === 'active')
    throw new AppError('conflict', `${info.name} is already connected.`);

  if (info.kind === 'slack') {
    if (!input.webhookUrl) throw new AppError('invalid', 'Paste the Slack incoming webhook URL.');
    const hook = await createSlackEndpoint(db, actor, workspaceId, input.webhookUrl, ctx, meta);
    await saveConnection(db, actor, workspaceId, info.key, null, hook.id, meta, { webhook: true });
    // A hello message, so people can see in Slack that it works.
    await sendTestWebhook(db, actor, hook.id);
    return { apiKey: null, webhookSecret: null };
  }
  const key = await createApiKey(
    db,
    actor,
    workspaceId,
    { name: `${info.name} connection`, scopes: info.scopes ?? [] },
    meta,
  );
  let hook: { id: string; secret: string } | null = null;
  try {
    if (input.webhookUrl)
      hook = await createWebhookEndpoint(
        db,
        actor,
        workspaceId,
        { url: input.webhookUrl, description: `${info.name} connection` },
        ctx,
        meta,
      );
  } catch (err) {
    await revokeApiKey(db, actor, key.id, meta);
    throw err;
  }
  await saveConnection(db, actor, workspaceId, info.key, key.id, hook?.id ?? null, meta, {
    apiKeyPrefix: key.prefix,
    webhook: Boolean(hook),
  });
  return { apiKey: key.key, webhookSecret: hook?.secret ?? null };
}

/** Disconnects: revokes the key, removes the webhook endpoint, and marks the connection disabled. */
export async function disconnectIntegration(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  provider: string,
  meta: Meta = {},
) {
  const c = await withActor(db, actor, async (tx) => {
    const [c] = await tx
      .select()
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.workspaceId, workspaceId),
          eq(schema.integrationConnections.provider, provider),
          sql`${schema.integrationConnections.externalAccountId} is null`,
        ),
      );
    if (!c || c.status !== 'active')
      throw new AppError('not_found', 'This integration is not connected.');
    const res = await tx
      .update(schema.integrationConnections)
      .set({ status: 'disabled', updatedAt: new Date() })
      .where(eq(schema.integrationConnections.id, c.id))
      .returning({ id: schema.integrationConnections.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow disconnecting integrations.');
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'integration.disconnected',
      targetType: 'integration',
      targetId: provider,
      ...meta,
    });
    return c;
  });
  if (c.apiKeyId) await revokeApiKey(db, actor, c.apiKeyId, meta);
  if (c.webhookEndpointId)
    await deleteWebhookEndpoint(db, actor, c.webhookEndpointId, meta).catch(() => {});
}
