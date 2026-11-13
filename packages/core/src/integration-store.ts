import { z } from 'zod';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { schema, withActor, type ActorContext, type Database } from '@st/db';
import { AppError } from './errors';
import { recordAudit } from './audit';
import { getIntegration } from './integrations';
import { createDocumentFromUpload } from './documents';
import { setExternalRef } from './api';
import type { ObjectStorage } from './storage';
import { IntegrationError, openTokens, sealTokens, type OAuthTokens } from './integration-oauth';
import {
  downloadDriveFileAsPdf,
  driveFileName,
  getDriveFile,
  googleAccount,
  refreshGoogleToken,
  resolveDriveFolder,
  revokeGoogleToken,
  uploadPdfToDrive,
  type GoogleOAuthClient,
} from './connectors/google-drive';

type Meta = { ipAddress?: string | null; userAgent?: string | null };
type Fetch = typeof fetch;

/** Server-side configuration the connectors need. Missing providers are simply unavailable. */
export interface IntegrationRuntime {
  encKey: Buffer;
  google?: GoogleOAuthClient;
  fetch?: Fetch;
}

async function can(db: Database, actor: ActorContext, workspaceId: string, perm: string) {
  return withActor(db, actor, async (tx) => {
    const [r] = (await tx.execute(
      sql`select st_has_permission(${workspaceId}::uuid, ${perm}) as ok`,
    )) as unknown as { ok: boolean }[];
    return Boolean(r?.ok);
  });
}

async function requireCan(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  perm: string,
  msg: string,
) {
  if (!(await can(db, actor, workspaceId, perm))) throw new AppError('forbidden', msg);
}

// ---------------------------------------------------------------------------------------------
// Connections

/**
 * Saves an OAuth connection after the provider's callback: identifies the account, seals the
 * tokens and marks the connection active. Reconnecting replaces the stored tokens.
 */
export async function saveOAuthConnection(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  provider: string,
  tokens: OAuthTokens,
  rt: IntegrationRuntime,
  meta: Meta = {},
) {
  const info = getIntegration(provider);
  if (!info?.available || info.kind !== 'oauth')
    throw new AppError('invalid', 'This integration is not available yet.');
  await requireCan(
    db,
    actor,
    workspaceId,
    'integrations.manage',
    'Your role does not allow connecting integrations.',
  );
  if (!tokens.refreshToken)
    throw new AppError('invalid', 'Google did not grant offline access. Try connecting again.');
  const account =
    provider === 'google_drive' ? await googleAccount(tokens.accessToken, rt.fetch) : null;
  const sealed = sealTokens(tokens, rt.encKey);
  const now = new Date();
  await withActor(db, actor, async (tx) => {
    const [c] = await tx
      .insert(schema.integrationConnections)
      .values({
        workspaceId,
        provider,
        status: 'active',
        createdBy: actor.userId,
        externalAccountId: account?.id ?? null,
        externalAccountLabel: account?.label ?? null,
        scopes: tokens.scopes,
        connectedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.integrationConnections.workspaceId, schema.integrationConnections.provider],
        set: {
          status: 'active',
          createdBy: actor.userId,
          externalAccountId: account?.id ?? null,
          externalAccountLabel: account?.label ?? null,
          scopes: tokens.scopes,
          connectedAt: now,
          revokedAt: null,
          lastError: null,
          lastErrorAt: null,
          updatedAt: now,
        },
      })
      .returning({ id: schema.integrationConnections.id });
    await tx
      .insert(schema.integrationCredentials)
      .values({
        connectionId: c!.id,
        workspaceId,
        secretEncrypted: sealed,
        accessTokenExpiresAt: tokens.expiresAt,
      })
      .onConflictDoUpdate({
        target: schema.integrationCredentials.connectionId,
        set: { secretEncrypted: sealed, accessTokenExpiresAt: tokens.expiresAt, updatedAt: now },
      });
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'integration.connected',
      targetType: 'integration',
      targetId: provider,
      metadata: { account: account?.label ?? null, scopes: tokens.scopes },
      ...meta,
    });
    await tx.insert(schema.integrationJobs).values({
      workspaceId,
      connectionId: c!.id,
      provider,
      operation: 'connect',
      status: 'succeeded',
      attempts: 1,
      details: { account: account?.label ?? null },
      createdBy: actor.userId,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
    });
  });
}

export async function getConnection(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  provider: string,
) {
  return withActor(db, actor, async (tx) => {
    const [c] = await tx
      .select({
        id: schema.integrationConnections.id,
        provider: schema.integrationConnections.provider,
        status: schema.integrationConnections.status,
        externalAccountLabel: schema.integrationConnections.externalAccountLabel,
        scopes: schema.integrationConnections.scopes,
        settings: schema.integrationConnections.settings,
        connectedAt: schema.integrationConnections.connectedAt,
        lastSuccessAt: schema.integrationConnections.lastSuccessAt,
        lastErrorAt: schema.integrationConnections.lastErrorAt,
        lastError: schema.integrationConnections.lastError,
      })
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.workspaceId, workspaceId),
          eq(schema.integrationConnections.provider, provider),
        ),
      );
    return c ?? null;
  });
}

/**
 * A valid access token for an active connection, refreshed when it expires within a minute.
 * Never returned to the browser except the short-lived token the Google Picker needs.
 */
export async function getAccessToken(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  provider: string,
  rt: IntegrationRuntime,
): Promise<{ accessToken: string; expiresAt: Date | null; connectionId: string }> {
  const row = await withActor(db, actor, async (tx) => {
    const [r] = await tx
      .select({
        id: schema.integrationConnections.id,
        status: schema.integrationConnections.status,
        secret: schema.integrationCredentials.secretEncrypted,
        expiresAt: schema.integrationCredentials.accessTokenExpiresAt,
      })
      .from(schema.integrationConnections)
      .innerJoin(
        schema.integrationCredentials,
        eq(schema.integrationCredentials.connectionId, schema.integrationConnections.id),
      )
      .where(
        and(
          eq(schema.integrationConnections.workspaceId, workspaceId),
          eq(schema.integrationConnections.provider, provider),
        ),
      );
    return r;
  });
  if (!row) throw new AppError('not_found', 'Connect the integration first.');
  if (row.status === 'expired')
    throw new AppError(
      'conflict',
      'This connection has expired. Reconnect it on the Integrations page.',
    );
  if (row.status !== 'active') throw new AppError('not_found', 'Connect the integration first.');
  const t = openTokens(row.secret, rt.encKey);
  if (row.expiresAt && row.expiresAt.getTime() > Date.now() + 60_000)
    return { accessToken: t.accessToken, expiresAt: row.expiresAt, connectionId: row.id };
  if (!t.refreshToken || !rt.google) throw new AppError('conflict', 'Reconnect the integration.');
  try {
    const fresh = await refreshGoogleToken(rt.google, t.refreshToken, rt.fetch);
    await withActor(db, actor, (tx) =>
      tx
        .update(schema.integrationCredentials)
        .set({
          secretEncrypted: sealTokens(fresh, rt.encKey),
          accessTokenExpiresAt: fresh.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.integrationCredentials.connectionId, row.id)),
    );
    return { accessToken: fresh.accessToken, expiresAt: fresh.expiresAt, connectionId: row.id };
  } catch (err) {
    if (err instanceof IntegrationError && err.code === 'auth_revoked') {
      await markConnection(db, actor, row.id, 'expired', err.message);
      throw new AppError(
        'conflict',
        'Google access was withdrawn. Reconnect Google Drive on the Integrations page.',
      );
    }
    throw err;
  }
}

async function markConnection(
  db: Database,
  actor: ActorContext,
  connectionId: string,
  status: 'expired' | 'error',
  message: string,
) {
  // Recorded where the member's role allows it; the worker records it for everyone else.
  await withActor(db, actor, (tx) =>
    tx
      .update(schema.integrationConnections)
      .set({ status, lastError: message, lastErrorAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.integrationConnections.id, connectionId)),
  ).catch(() => undefined);
}

export const driveSettingsSchema = z.object({
  autoSave: z.boolean().default(false),
  saveCertificate: z.boolean().default(true),
  folderId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{10,200}$/)
    .nullable()
    .default(null),
  folderName: z.string().max(200).nullable().default(null),
  naming: z.enum(['title', 'title_date']).default('title'),
  /** Set when auto-save is switched on; only documents finished after it are saved. */
  autoSaveSince: z.string().datetime().nullable().default(null),
});
export type DriveSettings = z.infer<typeof driveSettingsSchema>;

export function readDriveSettings(raw: unknown): DriveSettings {
  const r = driveSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : driveSettingsSchema.parse({});
}

export async function updateIntegrationSettings(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  provider: string,
  raw: unknown,
  meta: Meta = {},
) {
  if (provider !== 'google_drive')
    throw new AppError('invalid', 'This integration has no settings.');
  const input = driveSettingsSchema.parse(raw);
  await requireCan(
    db,
    actor,
    workspaceId,
    'integrations.manage',
    'Your role does not allow changing integration settings.',
  );
  await withActor(db, actor, async (tx) => {
    const [cur] = await tx
      .select({ settings: schema.integrationConnections.settings })
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.workspaceId, workspaceId),
          eq(schema.integrationConnections.provider, provider),
        ),
      );
    const prev = readDriveSettings(cur?.settings);
    const settings: DriveSettings = {
      ...input,
      autoSaveSince: input.autoSave
        ? prev.autoSave && prev.autoSaveSince
          ? prev.autoSaveSince
          : new Date().toISOString()
        : null,
    };
    const res = await tx
      .update(schema.integrationConnections)
      .set({ settings, updatedAt: new Date() })
      .where(
        and(
          eq(schema.integrationConnections.workspaceId, workspaceId),
          eq(schema.integrationConnections.provider, provider),
        ),
      )
      .returning({ id: schema.integrationConnections.id });
    if (!res.length) throw new AppError('not_found', 'Connect the integration first.');
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'integration.settings_changed',
      targetType: 'integration',
      targetId: provider,
      metadata: {
        autoSave: settings.autoSave,
        saveCertificate: settings.saveCertificate,
        folder: settings.folderName,
        naming: settings.naming,
      },
      ...meta,
    });
  });
}

/** Disconnects an OAuth connection: revokes at the provider, deletes stored tokens, keeps history. */
export async function disconnectOAuthIntegration(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  provider: string,
  rt: IntegrationRuntime,
  meta: Meta = {},
) {
  await requireCan(
    db,
    actor,
    workspaceId,
    'integrations.manage',
    'Your role does not allow disconnecting integrations.',
  );
  const sealed = await withActor(db, actor, async (tx) => {
    const [c] = await tx
      .select({
        id: schema.integrationConnections.id,
        secret: schema.integrationCredentials.secretEncrypted,
      })
      .from(schema.integrationConnections)
      .leftJoin(
        schema.integrationCredentials,
        eq(schema.integrationCredentials.connectionId, schema.integrationConnections.id),
      )
      .where(
        and(
          eq(schema.integrationConnections.workspaceId, workspaceId),
          eq(schema.integrationConnections.provider, provider),
        ),
      );
    if (!c) throw new AppError('not_found', 'This integration is not connected.');
    await tx
      .delete(schema.integrationCredentials)
      .where(eq(schema.integrationCredentials.connectionId, c.id));
    await tx
      .update(schema.integrationConnections)
      .set({ status: 'disabled', revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.integrationConnections.id, c.id));
    // Queued work for this connection will not run.
    await tx.execute(sql`select st_integration_cancel(${c.id}::uuid)`);
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'integration.disconnected',
      targetType: 'integration',
      targetId: provider,
      ...meta,
    });
    return c.secret;
  });
  if (sealed && provider === 'google_drive') {
    const t = openTokens(sealed, rt.encKey);
    await revokeGoogleToken(t.refreshToken ?? t.accessToken, rt.fetch);
  }
}

// ---------------------------------------------------------------------------------------------
// Activity

export interface ActivityFilters {
  provider?: string;
  status?: string;
  limit?: number;
}

export async function listIntegrationActivity(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  filters: ActivityFilters = {},
) {
  const where: SQL[] = [eq(schema.integrationJobs.workspaceId, workspaceId)];
  if (filters.provider) where.push(eq(schema.integrationJobs.provider, filters.provider));
  if (filters.status) where.push(eq(schema.integrationJobs.status, filters.status));
  return withActor(db, actor, (tx) =>
    tx
      .select({
        id: schema.integrationJobs.id,
        provider: schema.integrationJobs.provider,
        operation: schema.integrationJobs.operation,
        status: schema.integrationJobs.status,
        attempts: schema.integrationJobs.attempts,
        documentId: schema.integrationJobs.documentId,
        requestId: schema.integrationJobs.requestId,
        externalReference: schema.integrationJobs.externalReference,
        errorCode: schema.integrationJobs.errorCode,
        errorMessage: schema.integrationJobs.errorMessage,
        details: schema.integrationJobs.details,
        nextAttemptAt: schema.integrationJobs.nextAttemptAt,
        createdAt: schema.integrationJobs.createdAt,
        completedAt: schema.integrationJobs.completedAt,
        durationMs: schema.integrationJobs.durationMs,
        eventId: schema.integrationJobs.eventId,
        accountLabel: schema.integrationConnections.externalAccountLabel,
      })
      .from(schema.integrationJobs)
      .leftJoin(
        schema.integrationConnections,
        eq(schema.integrationConnections.id, schema.integrationJobs.connectionId),
      )
      .where(and(...where))
      .orderBy(desc(schema.integrationJobs.createdAt))
      .limit(Math.min(filters.limit ?? 100, 500)),
  );
}

export async function retryIntegrationJob(db: Database, actor: ActorContext, jobId: string) {
  const ok = await withActor(db, actor, async (tx) => {
    const [r] = (await tx.execute(
      sql`select st_integration_retry(${jobId}::uuid) as ok`,
    )) as unknown as {
      ok: boolean;
    }[];
    return Boolean(r?.ok);
  });
  if (!ok)
    throw new AppError(
      'forbidden',
      'Only failed jobs can be retried, by members who manage integrations.',
    );
}

// ---------------------------------------------------------------------------------------------
// Google Drive: import

/**
 * Imports a file the member picked in the Google Picker into a new draft, through the same upload
 * path as any other document. Links the draft to the Drive file (external reference + mapping) and
 * logs the action.
 */
export async function importFromGoogleDrive(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  workspaceId: string,
  fileId: string,
  rt: IntegrationRuntime,
  limits: { maxBytes: number; maxPages: number },
  meta: Meta = {},
): Promise<{ documentId: string }> {
  const started = Date.now();
  const { accessToken, connectionId } = await getAccessToken(
    db,
    actor,
    workspaceId,
    'google_drive',
    rt,
  );
  const log = (values: Partial<typeof schema.integrationJobs.$inferInsert>) =>
    withActor(db, actor, (tx) =>
      tx.insert(schema.integrationJobs).values({
        workspaceId,
        connectionId,
        provider: 'google_drive',
        operation: 'import_document',
        attempts: 1,
        createdBy: actor.userId,
        startedAt: new Date(started),
        completedAt: new Date(),
        durationMs: Date.now() - started,
        externalReference: fileId,
        ...values,
      }),
    ).catch(() => undefined);
  try {
    const file = await getDriveFile(accessToken, fileId, rt.fetch);
    const { bytes, filename } = await downloadDriveFileAsPdf(
      accessToken,
      file,
      limits.maxBytes,
      rt.fetch,
    );
    const title = file.name.replace(/\.pdf$/i, '').slice(0, 200) || 'Untitled document';
    const { id } = await createDocumentFromUpload(
      db,
      storage,
      actor,
      { workspaceId, title, documentType: 'other', filename, bytes },
      limits,
      meta,
    );
    await setExternalRef(db, actor, id, {
      source: 'google_drive',
      id: file.id,
      metadata: { name: file.name.slice(0, 200), mimeType: file.mimeType },
    });
    await withActor(db, actor, (tx) =>
      tx
        .insert(schema.integrationMappings)
        .values({
          workspaceId,
          connectionId,
          provider: 'google_drive',
          externalObjectType: 'file',
          externalObjectId: file.id,
          documentId: id,
          syncStatus: 'imported',
        })
        .onConflictDoNothing(),
    );
    await log({
      status: 'succeeded',
      documentId: id,
      details: { name: file.name.slice(0, 200), exported: file.mimeType !== 'application/pdf' },
    });
    return { documentId: id };
  } catch (err) {
    const code =
      err instanceof IntegrationError ? err.code : err instanceof AppError ? err.code : 'unknown';
    const message = err instanceof Error ? err.message : 'Import failed';
    await log({ status: 'failed', errorCode: String(code), errorMessage: message.slice(0, 500) });
    if (err instanceof IntegrationError) {
      if (err.code === 'auth_revoked' || err.code === 'auth_expired')
        await markConnection(db, actor, connectionId, 'expired', err.message);
      throw new AppError(err.code === 'not_found' ? 'not_found' : 'invalid', err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Worker

export interface IntegrationWorkerResult {
  queued: number;
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Queues and runs integration jobs (today: saving finished documents to Google Drive). Runs with
 * no signed-in member, only through SECURITY DEFINER functions. Safe to run concurrently: jobs are
 * claimed with SKIP LOCKED, and uploads are de-duplicated by job id so a retry never creates a
 * second copy.
 */
export async function runIntegrationJobs(
  db: Database,
  storage: ObjectStorage,
  rt: IntegrationRuntime,
  opts: { limit?: number; maxAttempts?: number } = {},
): Promise<IntegrationWorkerResult> {
  const limit = opts.limit ?? 10;
  const maxAttempts = opts.maxAttempts ?? 6;
  const [q] = (await db.transaction((tx) =>
    tx.execute(sql`select st_integration_enqueue(${limit * 5}) as n`),
  )) as unknown as { n: number }[];
  const jobs = (await db.transaction((tx) =>
    tx.execute(sql`select * from st_integration_claim(${limit})`),
  )) as unknown as {
    job_id: string;
    workspace_id: string;
    connection_id: string | null;
    provider: string;
    operation: string;
    attempts: number;
    settings: Record<string, unknown> | null;
    secret_encrypted: string | null;
    access_token_expires_at: Date | string | null;
    request_id: string | null;
    title: string | null;
    certificate_number: string | null;
    signed_storage_key: string | null;
    certificate_storage_key: string | null;
    completed_at: Date | string | null;
  }[];
  const result: IntegrationWorkerResult = {
    queued: q?.n ?? 0,
    attempted: jobs.length,
    succeeded: 0,
    failed: 0,
  };

  const finish = (
    id: string,
    ok: boolean,
    permanent: boolean,
    code: string | null,
    message: string | null,
    ref: string | null,
    details: Record<string, unknown>,
  ) =>
    db.transaction((tx) =>
      tx.execute(
        sql`select st_integration_finish(${id}::uuid, ${ok}, ${permanent}, ${code}, ${message}, ${ref}, ${JSON.stringify(details)}::jsonb, ${maxAttempts})`,
      ),
    );

  for (const j of jobs) {
    try {
      if (j.provider !== 'google_drive' || j.operation !== 'save_signed_copy')
        throw new IntegrationError('invalid_config', `Unknown job ${j.provider}/${j.operation}`);
      if (!rt.google)
        throw new IntegrationError(
          'provider_unavailable',
          'Google Drive is not configured on this server.',
        );
      if (!j.secret_encrypted || !j.connection_id)
        throw new IntegrationError('auth_revoked', 'Google Drive is not connected any more.');
      if (!j.signed_storage_key)
        throw new IntegrationError('missing_file', 'The signed document is not available.');
      const settings = readDriveSettings(j.settings);
      let { accessToken, refreshToken } = openTokens(j.secret_encrypted, rt.encKey);
      const exp = j.access_token_expires_at ? new Date(j.access_token_expires_at) : null;
      if (!exp || exp.getTime() < Date.now() + 60_000) {
        if (!refreshToken) throw new IntegrationError('auth_revoked', 'Reconnect Google Drive.');
        const fresh = await refreshGoogleToken(rt.google, refreshToken, rt.fetch);
        accessToken = fresh.accessToken;
        refreshToken = fresh.refreshToken;
        await db.transaction((tx) =>
          tx.execute(
            sql`select st_integration_store_tokens(${j.connection_id}::uuid, ${sealTokens(fresh, rt.encKey)}, ${fresh.expiresAt?.toISOString() ?? null}::timestamptz)`,
          ),
        );
      }
      const folder = await resolveDriveFolder(accessToken, settings.folderId, rt.fetch);
      const completedAt = j.completed_at ? new Date(j.completed_at) : null;
      const naming = {
        naming: settings.naming,
        completedAt,
        certificateNumber: j.certificate_number,
      };
      const signed = await uploadPdfToDrive(
        accessToken,
        {
          folderId: folder.id,
          name: driveFileName(j.title ?? 'Document', 'signed', naming),
          bytes: await storage.get(j.signed_storage_key),
          dedupeKey: `${j.job_id}:signed`,
        },
        rt.fetch,
      );
      const files = [signed.name];
      const refs = [signed.id];
      if (settings.saveCertificate && j.certificate_storage_key) {
        const cert = await uploadPdfToDrive(
          accessToken,
          {
            folderId: folder.id,
            name: driveFileName(j.title ?? 'Document', 'certificate', naming),
            bytes: await storage.get(j.certificate_storage_key),
            dedupeKey: `${j.job_id}:certificate`,
          },
          rt.fetch,
        );
        files.push(cert.name);
        refs.push(cert.id);
      }
      await finish(j.job_id, true, false, null, null, refs.join(','), {
        folder: folder.name,
        files,
      });
      result.succeeded++;
    } catch (err) {
      const e =
        err instanceof IntegrationError
          ? err
          : new IntegrationError(
              'unknown',
              err instanceof Error ? err.message.slice(0, 200) : 'Unknown error',
            );
      await finish(j.job_id, false, e.permanent, e.code, e.message, null, {}).catch(
        () => undefined,
      );
      result.failed++;
    }
  }
  return result;
}

/** Run counts for an automation (a connection's queued operation). */
export async function automationStats(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  connectionId: string,
  operation: string,
) {
  return withActor(db, actor, async (tx) => {
    const [r] = (await tx.execute(
      sql`select count(*)::int as total, count(*) filter (where status = 'failed')::int as failed, max(created_at) as last
          from integration_jobs where workspace_id = ${workspaceId}::uuid and connection_id = ${connectionId}::uuid and operation = ${operation}`,
    )) as unknown as { total: number; failed: number; last: Date | string | null }[];
    return r ?? { total: 0, failed: 0, last: null };
  });
}
