import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { schema, withActor, type Database, type ActorContext } from '@st/db';
import { AppError } from './errors';
import { recordAudit } from './audit';
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
 * The integrations catalogue. Only entries with `available: true` can be connected; the rest are
 * listed so people can see what is planned, and are labelled as not available. Nothing here is
 * shown as working unless the connection code exists (spec Part 22).
 */
export interface IntegrationInfo {
  key: string;
  name: string;
  category: 'Partner apps' | 'Storage' | 'Productivity' | 'Communication' | 'CRM' | 'Payments';
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

export const INTEGRATIONS: IntegrationInfo[] = [
  {
    key: 'beam_artist',
    name: 'Beam Artist',
    category: 'Partner apps',
    description:
      'Send booking agreements and contracts for signature from Beam Artist and get status back by webhook.',
    available: true,
    kind: 'api',
    scopes: PARTNER_SCOPES,
  },
  {
    key: 'jectstack',
    name: 'Jectstack',
    category: 'Partner apps',
    description:
      'Send project agreements for signature from Jectstack and keep a reference to the signed record.',
    available: true,
    kind: 'api',
    scopes: PARTNER_SCOPES,
  },
  {
    key: 'google_workspace',
    name: 'Google Workspace',
    category: 'Productivity',
    description: 'Sign in and contacts from Google Workspace.',
    available: false,
  },
  {
    key: 'google_drive',
    name: 'Google Drive',
    category: 'Storage',
    description: 'Import documents and save signed copies to Drive.',
    available: false,
  },
  {
    key: 'microsoft_365',
    name: 'Microsoft 365',
    category: 'Productivity',
    description: 'Sign in and contacts from Microsoft 365.',
    available: false,
  },
  {
    key: 'onedrive',
    name: 'OneDrive',
    category: 'Storage',
    description: 'Import documents and save signed copies to OneDrive.',
    available: false,
  },
  {
    key: 'dropbox',
    name: 'Dropbox',
    category: 'Storage',
    description: 'Import documents and save signed copies to Dropbox.',
    available: false,
  },
  {
    key: 'box',
    name: 'Box',
    category: 'Storage',
    description: 'Import documents and save signed copies to Box.',
    available: false,
  },
  {
    key: 'slack',
    name: 'Slack',
    category: 'Communication',
    description:
      'Post to a Slack channel when documents are sent, signed, completed, declined, expired or cancelled. Uses a Slack incoming webhook; messages carry the document title and a link, never its contents.',
    available: true,
    kind: 'slack',
  },
  {
    key: 'salesforce',
    name: 'Salesforce',
    category: 'CRM',
    description: 'Send agreements from Salesforce records.',
    available: false,
  },
  {
    key: 'jira',
    name: 'Jira',
    category: 'Productivity',
    description: 'Link signing requests to Jira issues.',
    available: false,
  },
  {
    key: 'stripe',
    name: 'Stripe',
    category: 'Payments',
    description: 'Collect payment from recipients as part of signing.',
    available: false,
    note: 'Signature Tender uses Stripe for its own billing. Connecting your own Stripe account is not available yet.',
  },
];

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
      .where(eq(schema.integrationConnections.workspaceId, workspaceId)),
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
