import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, withActor, type Database, type ActorContext, type Tx } from '@st/db';
import { AppError } from '../errors';
import { recordAudit } from '../audit';
import { decryptSecret, encryptSecret } from '../webhooks';
import { getConfigValue } from '../config';
import {
  CONNECTORS,
  getConnector,
  getConnectorRuntime,
  resolveAvailability,
  type OAuthClientLookup,
  type ResolvedAvailability,
} from './registry';
import {
  refreshTokens,
  revokeAtProvider,
  scopedProviderFetch,
  type IntegrationKeys,
} from './oauth';
import { logActivity } from './activity';
import {
  IntegrationError,
  type ConnectorDefinition,
  type ExternalAccount,
  type OAuthConfig,
  type ProviderFetch,
  type TokenSet,
} from './types';

type Meta = { ipAddress?: string | null; userAgent?: string | null };

/** Server-side settings every integration service needs. */
export interface IntegrationContext {
  keys: IntegrationKeys;
  oauthClient: OAuthClientLookup;
  /** The `integrations` feature flag for this environment. */
  featureEnabled: boolean;
  /** Injected in tests; defaults to global fetch. */
  fetch?: ProviderFetch;
  now?: () => number;
}

export const AVAILABILITY_KEY = 'integrations.availability';

async function hasPerm(tx: Tx, workspaceId: string, perm: string): Promise<boolean> {
  const [r] = (await tx.execute(
    sql`select st_has_permission(${workspaceId}::uuid, ${perm}) as ok`,
  )) as unknown as { ok: boolean }[];
  return Boolean(r?.ok);
}

export async function getAvailabilityOverrides(db: Database): Promise<Record<string, unknown>> {
  const v = await getConfigValue<unknown>(db, AVAILABILITY_KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function availabilityFor(
  db: Database,
  ctx: Pick<IntegrationContext, 'oauthClient' | 'featureEnabled'>,
  def: ConnectorDefinition,
): Promise<ResolvedAvailability> {
  return resolveAvailability(def, await getAvailabilityOverrides(db), ctx);
}

function oauthOf(def: ConnectorDefinition): OAuthConfig {
  if (def.auth.type !== 'oauth2') throw new AppError('invalid', `${def.name} does not use OAuth.`);
  return def.auth;
}

/**
 * Checks that the signed-in member may start connecting `provider` with this visibility, and that
 * the connector can be connected at all. Called before redirecting to the provider.
 */
export async function assertCanConnect(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  provider: string,
  visibility: 'workspace' | 'personal',
  ctx: Pick<IntegrationContext, 'oauthClient' | 'featureEnabled'>,
): Promise<ConnectorDefinition> {
  const def = getConnector(provider);
  if (!def) throw new AppError('not_found', 'Unknown integration.');
  const a = await availabilityFor(db, ctx, def);
  if (!a.connectable || def.auth.type !== 'oauth2')
    throw new AppError('invalid', `${def.name} cannot be connected right now.`);
  if (visibility === 'personal' && !def.allowsPersonal)
    throw new AppError('invalid', `${def.name} can only be connected for the whole workspace.`);
  await withActor(db, actor, async (tx) => {
    const ok =
      visibility === 'workspace'
        ? await hasPerm(tx, workspaceId, 'integrations.manage')
        : (await hasPerm(tx, workspaceId, 'integrations.use')) ||
          (await hasPerm(tx, workspaceId, 'integrations.manage'));
    if (!ok) throw new AppError('forbidden', 'Your role does not allow connecting this app.');
  });
  return def;
}

function seal(ctx: IntegrationContext, plain: string) {
  return encryptSecret(plain, ctx.keys.tokenKey);
}

/**
 * Finishes an OAuth connection after the code exchange: looks up the external account with the new
 * token, then creates or refreshes the connection and stores the sealed tokens. Reconnecting the
 * same account updates the existing connection instead of creating a second one.
 */
export async function completeOAuthConnection(
  db: Database,
  actor: ActorContext,
  args: {
    workspaceId: string;
    provider: string;
    visibility: 'workspace' | 'personal';
    tokens: TokenSet;
  },
  ctx: IntegrationContext,
  meta: Meta = {},
): Promise<{ connectionId: string; account: ExternalAccount; reconnected: boolean }> {
  const def = getConnector(args.provider);
  if (!def || def.auth.type !== 'oauth2') throw new AppError('not_found', 'Unknown integration.');
  const runtime = getConnectorRuntime(def.key);
  if (!runtime) throw new AppError('invalid', `${def.name} is not available yet.`);
  const cfg = def.auth;
  const providerFetch = scopedProviderFetch(cfg, ctx.fetch);
  const call = (url: string, init: RequestInit = {}) =>
    providerFetch(url, {
      ...init,
      headers: { ...(init.headers as object), authorization: `Bearer ${args.tokens.accessToken}` },
    });
  const account = await runtime.fetchAccount(call);
  if (!account.id)
    throw new IntegrationError('internal', 'The provider did not identify the account.');
  const missing = cfg.scopes.filter((s) => !args.tokens.scopes.includes(s));

  return withActor(db, actor, async (tx) => {
    const owner = args.visibility === 'personal' ? actor.userId : null;
    const [existing] = await tx
      .select({ id: schema.integrationConnections.id })
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.workspaceId, args.workspaceId),
          eq(schema.integrationConnections.provider, def.key),
          eq(schema.integrationConnections.externalAccountId, account.id),
          owner
            ? eq(schema.integrationConnections.ownerUserId, owner)
            : sql`${schema.integrationConnections.ownerUserId} is null`,
        ),
      );
    const now = new Date(ctx.now?.() ?? Date.now());
    const values = {
      status: missing.length ? 'permission_required' : 'active',
      externalAccountLabel: account.label.slice(0, 200),
      scopes: args.tokens.scopes,
      connectedAt: now,
      lastSuccessAt: now,
      lastErrorCode: missing.length ? 'missing_scopes' : null,
      lastErrorMessage: missing.length ? `Not granted: ${missing.join(', ')}` : null,
      revokedAt: null,
      updatedAt: now,
    };
    let connectionId: string;
    if (existing) {
      const res = await tx
        .update(schema.integrationConnections)
        .set(values)
        .where(eq(schema.integrationConnections.id, existing.id))
        .returning({ id: schema.integrationConnections.id });
      if (!res.length)
        throw new AppError('forbidden', 'Your role does not allow reconnecting this app.');
      connectionId = existing.id;
    } else {
      const [row] = await tx
        .insert(schema.integrationConnections)
        .values({
          workspaceId: args.workspaceId,
          provider: def.key,
          visibility: args.visibility,
          ownerUserId: owner,
          externalAccountId: account.id,
          createdBy: actor.userId,
          ...values,
        })
        .returning({ id: schema.integrationConnections.id });
      connectionId = row!.id;
    }
    const sealed = {
      sealedAccessToken: seal(ctx, args.tokens.accessToken),
      sealedRefreshToken: args.tokens.refreshToken ? seal(ctx, args.tokens.refreshToken) : null,
      tokenType: args.tokens.tokenType,
      expiresAt: args.tokens.expiresAt,
      updatedAt: now,
    };
    await tx
      .insert(schema.integrationCredentials)
      .values({ connectionId, workspaceId: args.workspaceId, ...sealed })
      .onConflictDoUpdate({ target: schema.integrationCredentials.connectionId, set: sealed });
    await recordAudit(tx, {
      workspaceId: args.workspaceId,
      actorUserId: actor.userId,
      action: existing ? 'integration.reconnected' : 'integration.connected',
      targetType: 'integration',
      targetId: connectionId,
      metadata: { provider: def.key, visibility: args.visibility, scopes: args.tokens.scopes },
      ...meta,
    });
    await logActivity(tx, {
      workspaceId: args.workspaceId,
      connectionId,
      provider: def.key,
      action: existing ? 'connection.reconnected' : 'connection.connected',
      status: 'success',
      actorUserId: actor.userId,
      metadata: { visibility: args.visibility, missingScopes: missing },
    });
    return { connectionId, account, reconnected: Boolean(existing) };
  });
}

/** Records that the person cancelled or the provider refused the authorization. */
export async function recordOAuthFailure(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  provider: string,
  reason: 'cancelled' | 'failed',
  detail: string,
) {
  await withActor(db, actor, (tx) =>
    logActivity(tx, {
      workspaceId,
      provider,
      action: 'connection.authorize',
      status: reason === 'cancelled' ? 'cancelled' : 'failed',
      actorUserId: actor.userId!,
      errorCode: reason === 'cancelled' ? 'access_denied' : 'oauth_failed',
      message: detail,
    }),
  );
}

export interface ConnectionRow {
  id: string;
  provider: string;
  status: string;
  visibility: string;
  ownerUserId: string | null;
  createdBy: string | null;
  connectedByName: string | null;
  externalAccountLabel: string | null;
  scopes: string[];
  settings: Record<string, unknown>;
  connectedAt: Date | null;
  createdAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastRefreshedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  revokedAt: Date | null;
  automations: number;
  failedJobs7d: number;
}

/** Connections visible to the member: workspace ones, plus their own personal ones. No secrets. */
export async function listIntegrationConnections(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
): Promise<ConnectionRow[]> {
  const c = schema.integrationConnections;
  return withActor(db, actor, (tx) =>
    tx
      .select({
        id: c.id,
        provider: c.provider,
        status: c.status,
        visibility: c.visibility,
        ownerUserId: c.ownerUserId,
        createdBy: c.createdBy,
        connectedByName: schema.user.name,
        externalAccountLabel: c.externalAccountLabel,
        scopes: c.scopes,
        settings: c.settings,
        connectedAt: c.connectedAt,
        createdAt: c.createdAt,
        lastSuccessAt: c.lastSuccessAt,
        lastFailureAt: c.lastFailureAt,
        lastRefreshedAt: c.lastRefreshedAt,
        lastErrorCode: c.lastErrorCode,
        lastErrorMessage: c.lastErrorMessage,
        revokedAt: c.revokedAt,
        automations: sql<number>`(select count(*)::int from integration_event_subscriptions s where s.connection_id = ${c.id} and s.enabled)`,
        failedJobs7d: sql<number>`(select count(*)::int from integration_sync_jobs j where j.connection_id = ${c.id} and j.status = 'failed' and j.updated_at > now() - interval '7 days')`,
      })
      .from(c)
      .leftJoin(schema.user, eq(schema.user.id, c.createdBy))
      // Partner and Slack connections (no external account) are listed by listConnections.
      .where(and(eq(c.workspaceId, workspaceId), sql`${c.externalAccountId} is not null`))
      .orderBy(desc(c.createdAt)),
  );
}

async function loadConnection(tx: Tx, connectionId: string) {
  const [c] = await tx
    .select()
    .from(schema.integrationConnections)
    .where(eq(schema.integrationConnections.id, connectionId));
  if (!c) throw new AppError('not_found', 'This connection was not found.');
  return c;
}

/** Records the outcome of a provider call on the connection (health). */
export async function recordConnectionHealth(
  tx: Tx,
  connectionId: string,
  r:
    | { ok: true; refreshed?: boolean }
    | {
        ok: false;
        status: 'expired' | 'permission_required' | 'error';
        code: string;
        message: string;
      },
) {
  await tx.execute(
    r.ok
      ? sql`select st_integration_record_health(${connectionId}::uuid, true, 'active', null, null, ${Boolean(r.refreshed)})`
      : sql`select st_integration_record_health(${connectionId}::uuid, false, ${r.status}, ${r.code}, ${r.message}, false)`,
  );
}

const REFRESH_MARGIN_MS = 60_000;

/**
 * Returns a valid access token for the connection, refreshing it first when it is about to expire.
 * Runs in its own transaction as `actor` (who must be able to use the connection), so a refreshed
 * token is saved even if the work that follows fails. The credentials row is locked while
 * refreshing so two workers cannot both spend a single-use refresh token.
 */
export async function getAccessToken(
  db: Database,
  actor: ActorContext,
  connectionId: string,
  ctx: IntegrationContext,
): Promise<{ token: string; cfg: OAuthConfig; provider: string }> {
  let failure: IntegrationError | null = null;
  const out = await withActor(db, actor, async (tx) => {
    try {
      return await accessTokenTx(tx, connectionId, ctx);
    } catch (err) {
      // Commit the health change recorded before the error instead of rolling it back.
      if (err instanceof IntegrationError) {
        failure = err;
        return null;
      }
      throw err;
    }
  });
  if (!out) throw failure!;
  return out;
}

async function accessTokenTx(
  tx: Tx,
  connectionId: string,
  ctx: IntegrationContext,
): Promise<{ token: string; cfg: OAuthConfig; provider: string }> {
  const conn = await loadConnection(tx, connectionId);
  if (conn.status === 'disabled')
    throw new IntegrationError('auth_expired', 'This connection was disconnected.', {
      retryable: false,
    });
  const def = getConnector(conn.provider);
  if (!def || def.auth.type !== 'oauth2')
    throw new IntegrationError('not_configured', 'Unknown connector.');
  const cfg = def.auth;
  const [cred] = await tx
    .select()
    .from(schema.integrationCredentials)
    .where(eq(schema.integrationCredentials.connectionId, connectionId))
    .for('update');
  if (!cred)
    throw new IntegrationError('auth_expired', 'No stored authorization. Reconnect the app.', {
      retryable: false,
    });
  const now = ctx.now?.() ?? Date.now();
  if (!cred.expiresAt || cred.expiresAt.getTime() - REFRESH_MARGIN_MS > now)
    return {
      token: decryptSecret(cred.sealedAccessToken, ctx.keys.tokenKey),
      cfg,
      provider: def.key,
    };

  if (!cred.sealedRefreshToken) {
    await recordConnectionHealth(tx, connectionId, {
      ok: false,
      status: 'expired',
      code: 'auth_expired',
      message: 'The authorization expired. Reconnect the app.',
    });
    throw new IntegrationError('auth_expired', 'The authorization expired. Reconnect the app.', {
      retryable: false,
    });
  }
  const client = ctx.oauthClient(def.key);
  if (!client)
    throw new IntegrationError('not_configured', `${def.name} is not set up on this server.`);
  let t: TokenSet;
  try {
    t = await refreshTokens(
      cfg,
      client,
      decryptSecret(cred.sealedRefreshToken, ctx.keys.tokenKey),
      ctx.fetch,
      now,
    );
  } catch (err) {
    if (err instanceof IntegrationError && err.code === 'auth_expired')
      await recordConnectionHealth(tx, connectionId, {
        ok: false,
        status: 'expired',
        code: 'auth_expired',
        message: 'The authorization was revoked or expired. Reconnect the app.',
      });
    throw err;
  }
  await tx
    .update(schema.integrationCredentials)
    .set({
      sealedAccessToken: seal(ctx, t.accessToken),
      sealedRefreshToken: t.refreshToken ? seal(ctx, t.refreshToken) : cred.sealedRefreshToken,
      tokenType: t.tokenType,
      expiresAt: t.expiresAt,
      updatedAt: new Date(now),
    })
    .where(eq(schema.integrationCredentials.connectionId, connectionId));
  await recordConnectionHealth(tx, connectionId, { ok: true, refreshed: true });
  return { token: t.accessToken, cfg, provider: def.key };
}

/**
 * An authenticated, host-limited caller for the connection. Provider responses are classified:
 * 401 means the authorization is no longer valid, 403 a missing permission, 429 rate limiting.
 */
export async function connectionCaller(
  db: Database,
  actor: ActorContext,
  connectionId: string,
  ctx: IntegrationContext,
) {
  const { token, cfg } = await getAccessToken(db, actor, connectionId, ctx);
  const f = scopedProviderFetch(cfg, ctx.fetch);
  return async (url: string, init: RequestInit = {}) => {
    let res: Response;
    try {
      res = await f(url, {
        ...init,
        headers: { ...(init.headers as object), authorization: `Bearer ${token}` },
      });
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError('provider_unavailable', 'The provider did not respond.');
    }
    if (res.status === 401)
      throw new IntegrationError(
        'auth_expired',
        'The provider no longer accepts this connection.',
        {
          retryable: false,
        },
      );
    if (res.status === 403)
      throw new IntegrationError('permission_revoked', 'The provider refused access.', {
        retryable: false,
      });
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      throw new IntegrationError('rate_limited', 'The provider is rate limiting.', {
        retryAfterSeconds: Number.isFinite(ra) ? ra : undefined,
      });
    }
    if (res.status >= 500)
      throw new IntegrationError('provider_unavailable', 'The provider had an error.');
    return res;
  };
}

/** Classifies any error from connector work. */
export function toIntegrationError(err: unknown): IntegrationError {
  if (err instanceof IntegrationError) return err;
  if (err instanceof AppError)
    return new IntegrationError(
      err.code === 'not_found' ? 'not_found' : 'invalid_request',
      err.message,
      { retryable: false },
    );
  return new IntegrationError('internal', 'Something went wrong while talking to the app.', {
    retryable: true,
  });
}

/** True when the error is about the connection itself rather than one record. */
export function isConnectionError(e: IntegrationError): boolean {
  return (
    e.connectionStatus !== null ||
    e.code === 'provider_unavailable' ||
    e.code === 'rate_limited' ||
    e.code === 'not_configured'
  );
}

/** Records a failed provider call on the connection, in its own transaction. */
export async function recordConnectionFailure(
  db: Database,
  actor: ActorContext,
  connectionId: string,
  e: IntegrationError,
) {
  // Errors about one record (not found, invalid input, mapping) say nothing about the connection.
  if (!isConnectionError(e)) return;
  await withActor(db, actor, (tx) =>
    recordConnectionHealth(tx, connectionId, {
      ok: false,
      status: e.connectionStatus ?? 'error',
      code: e.code,
      message: e.message,
    }),
  );
}

/** "Test connection": one cheap authenticated call, recorded in health and activity. */
export async function testIntegrationConnection(
  db: Database,
  actor: ActorContext,
  connectionId: string,
  ctx: IntegrationContext,
): Promise<{ ok: boolean; message: string }> {
  const conn = await withActor(db, actor, (tx) => loadConnection(tx, connectionId));
  const runtime = getConnectorRuntime(conn.provider);
  if (!runtime) throw new AppError('invalid', 'This connector cannot be tested.');
  const started = Date.now();
  let e: IntegrationError | null = null;
  try {
    const call = await connectionCaller(db, actor, connectionId, ctx);
    if (runtime.validate) await runtime.validate(call);
    else await runtime.fetchAccount(call);
  } catch (err) {
    e = toIntegrationError(err);
  }
  await withActor(db, actor, async (tx) => {
    await recordConnectionHealth(
      tx,
      connectionId,
      e
        ? { ok: false, status: e.connectionStatus ?? 'error', code: e.code, message: e.message }
        : { ok: true },
    );
    await logActivity(tx, {
      workspaceId: conn.workspaceId,
      connectionId,
      provider: conn.provider,
      action: 'connection.test',
      status: e ? 'failed' : 'success',
      actorUserId: actor.userId!,
      errorCode: e?.code ?? null,
      message: e?.message ?? null,
      durationMs: Date.now() - started,
    });
  });
  return e ? { ok: false, message: e.message } : { ok: true, message: 'The connection works.' };
}

/**
 * Disconnects an OAuth connection: revokes the grant at the provider (best effort), deletes the
 * stored tokens, turns off its automations, cancels waiting jobs and marks it disconnected. Links
 * to envelopes stay, so history is kept.
 */
export async function disconnectIntegrationConnection(
  db: Database,
  actor: ActorContext,
  connectionId: string,
  ctx: IntegrationContext,
  meta: Meta = {},
) {
  // Revoke first, while the token can still be read.
  let revoked = false;
  const def = await withActor(db, actor, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    const [ok] = (await tx.execute(
      sql`select st_integration_can_manage(${connectionId}::uuid) as ok`,
    )) as unknown as { ok: boolean }[];
    if (!ok?.ok)
      throw new AppError('forbidden', 'Your role does not allow disconnecting this app.');
    if (conn.status === 'disabled')
      throw new AppError('conflict', 'This app is already disconnected.');
    return getConnector(conn.provider);
  });
  if (def?.auth.type === 'oauth2') {
    const token = await withActor(db, actor, async (tx) => {
      const [cred] = await tx
        .select()
        .from(schema.integrationCredentials)
        .where(eq(schema.integrationCredentials.connectionId, connectionId));
      if (!cred) return null;
      try {
        return decryptSecret(cred.sealedRefreshToken ?? cred.sealedAccessToken, ctx.keys.tokenKey);
      } catch {
        return null;
      }
    });
    if (token) revoked = await revokeAtProvider(def.auth, token, ctx.fetch);
  }
  await withActor(db, actor, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    await tx
      .delete(schema.integrationCredentials)
      .where(eq(schema.integrationCredentials.connectionId, connectionId));
    const now = new Date();
    const res = await tx
      .update(schema.integrationConnections)
      .set({ status: 'disabled', revokedAt: now, updatedAt: now })
      .where(eq(schema.integrationConnections.id, connectionId))
      .returning({ id: schema.integrationConnections.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow disconnecting this app.');
    await tx
      .update(schema.integrationEventSubscriptions)
      .set({ enabled: false, updatedAt: now })
      .where(eq(schema.integrationEventSubscriptions.connectionId, connectionId));
    await tx
      .update(schema.integrationSyncJobs)
      .set({ status: 'cancelled', updatedAt: now, errorCode: 'disconnected' })
      .where(
        and(
          eq(schema.integrationSyncJobs.connectionId, connectionId),
          sql`${schema.integrationSyncJobs.status} in ('pending','retrying')`,
        ),
      );
    await recordAudit(tx, {
      workspaceId: conn.workspaceId,
      actorUserId: actor.userId,
      action: 'integration.disconnected',
      targetType: 'integration',
      targetId: connectionId,
      metadata: { provider: conn.provider, revokedAtProvider: revoked },
      ...meta,
    });
    await logActivity(tx, {
      workspaceId: conn.workspaceId,
      connectionId,
      provider: conn.provider,
      action: 'connection.disconnected',
      status: 'success',
      actorUserId: actor.userId!,
      metadata: { revokedAtProvider: revoked },
    });
  });
  return { revokedAtProvider: revoked };
}

/** Saves connector settings (default folder, naming, ...). Only keys the caller passes are kept. */
export async function updateConnectionSettings(
  db: Database,
  actor: ActorContext,
  connectionId: string,
  settings: Record<string, string | number | boolean | null>,
  meta: Meta = {},
) {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(settings).slice(0, 30)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k))
      throw new AppError('invalid', 'Invalid setting name.');
    clean[k] = typeof v === 'string' ? v.slice(0, 500) : v;
  }
  await withActor(db, actor, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    const res = await tx
      .update(schema.integrationConnections)
      .set({ settings: { ...conn.settings, ...clean }, updatedAt: new Date() })
      .where(eq(schema.integrationConnections.id, connectionId))
      .returning({ id: schema.integrationConnections.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow changing these settings.');
    await recordAudit(tx, {
      workspaceId: conn.workspaceId,
      actorUserId: actor.userId,
      action: 'integration.settings_updated',
      targetType: 'integration',
      targetId: connectionId,
      metadata: { keys: Object.keys(clean) },
      ...meta,
    });
  });
}

/** Marketplace view: every connector with its resolved availability. */
export async function listMarketplace(
  db: Database,
  ctx: Pick<IntegrationContext, 'oauthClient' | 'featureEnabled'>,
) {
  const overrides = await getAvailabilityOverrides(db);
  return CONNECTORS.map((def) => ({ def, ...resolveAvailability(def, overrides, ctx) }));
}
