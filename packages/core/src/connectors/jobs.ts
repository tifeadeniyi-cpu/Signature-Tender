import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, withActor, type Database, type ActorContext } from '@st/db';
import { AppError } from '../errors';
import { getConnector, getConnectorRuntime } from './registry';
import {
  connectionCaller,
  isConnectionError,
  recordConnectionHealth,
  toIntegrationError,
  type IntegrationContext,
} from './connections';
import { logActivity, sanitizeMetadata, sanitizeText } from './activity';
import { IntegrationError, type ActionResult } from './types';

export interface EnqueueInput {
  workspaceId: string;
  connectionId: string;
  operation: string;
  /**
   * Identifies the unit of work. Queuing the same key again returns the existing job instead of
   * creating a second one, so a double click or a retried request cannot duplicate work.
   */
  idempotencyKey: string;
  documentId?: string | null;
  requestId?: string | null;
  externalReference?: string | null;
  input?: Record<string, unknown>;
  maxAttempts?: number;
}

/** Queues connector work as the signed-in member. Returns the job id and whether it was new. */
export async function enqueueIntegrationJob(
  db: Database,
  actor: ActorContext,
  j: EnqueueInput,
): Promise<{ id: string; created: boolean }> {
  if (!/^[a-zA-Z0-9:._-]{1,200}$/.test(j.idempotencyKey))
    throw new AppError('invalid', 'Invalid idempotency key.');
  return withActor(db, actor, async (tx) => {
    const [conn] = await tx
      .select({
        provider: schema.integrationConnections.provider,
        status: schema.integrationConnections.status,
      })
      .from(schema.integrationConnections)
      .where(eq(schema.integrationConnections.id, j.connectionId));
    if (!conn) throw new AppError('not_found', 'This connection was not found.');
    if (conn.status === 'disabled') throw new AppError('invalid', 'This app is disconnected.');
    const def = getConnector(conn.provider);
    if (
      !def?.actions.some((a) => a.key === j.operation) &&
      !getConnectorRuntime(conn.provider)?.actions[j.operation]
    )
      throw new AppError('invalid', 'This app does not support that action.');
    const [row] = await tx
      .insert(schema.integrationSyncJobs)
      .values({
        workspaceId: j.workspaceId,
        connectionId: j.connectionId,
        operation: j.operation,
        idempotencyKey: j.idempotencyKey,
        actorUserId: actor.userId!,
        documentId: j.documentId ?? null,
        requestId: j.requestId ?? null,
        externalReference: j.externalReference ?? null,
        input: sanitizeMetadata(j.input ?? {}),
        maxAttempts: Math.min(Math.max(j.maxAttempts ?? 6, 1), 10),
      })
      .onConflictDoNothing({
        target: [schema.integrationSyncJobs.workspaceId, schema.integrationSyncJobs.idempotencyKey],
      })
      .returning({ id: schema.integrationSyncJobs.id });
    if (row) {
      await logActivity(tx, {
        workspaceId: j.workspaceId,
        connectionId: j.connectionId,
        provider: conn.provider,
        action: j.operation,
        status: 'pending',
        actorUserId: actor.userId!,
        jobId: row.id,
        documentId: j.documentId,
        requestId: j.requestId,
        externalReference: j.externalReference,
      });
      return { id: row.id, created: true };
    }
    const [existing] = await tx
      .select({ id: schema.integrationSyncJobs.id })
      .from(schema.integrationSyncJobs)
      .where(
        and(
          eq(schema.integrationSyncJobs.workspaceId, j.workspaceId),
          eq(schema.integrationSyncJobs.idempotencyKey, j.idempotencyKey),
        ),
      );
    if (!existing) throw new AppError('conflict', 'This work is already queued by someone else.');
    return { id: existing.id, created: false };
  });
}

interface ClaimedJob {
  id: string;
  workspace_id: string;
  connection_id: string;
  provider: string;
  operation: string;
  actor_user_id: string;
  attempt_count: number;
  max_attempts: number;
  document_id: string | null;
  request_id: string | null;
  correlation_id: string | null;
  input: Record<string, unknown>;
}

export interface RunJobsResult {
  claimed: number;
  succeeded: number;
  retrying: number;
  failed: number;
}

/**
 * Runs due connector jobs. Each job runs as the member who queued it (or who created the
 * automation), so it can only do what that member's role allows today. Results, health and
 * sanitised activity are recorded in a separate transaction from the work itself.
 */
export async function runIntegrationJobs(
  db: Database,
  ctx: IntegrationContext,
  opts: { limit?: number } = {},
): Promise<RunJobsResult> {
  const jobs = (await db.execute(
    sql`select * from st_integration_claim_jobs(${opts.limit ?? 20})`,
  )) as unknown as ClaimedJob[];
  const result: RunJobsResult = { claimed: jobs.length, succeeded: 0, retrying: 0, failed: 0 };
  for (const job of jobs) {
    const status = await runOne(db, ctx, job);
    if (status === 'succeeded') result.succeeded++;
    else if (status === 'retrying') result.retrying++;
    else result.failed++;
  }
  return result;
}

async function runOne(db: Database, ctx: IntegrationContext, job: ClaimedJob): Promise<string> {
  const actor = { userId: job.actor_user_id };
  const started = Date.now();
  let res: ActionResult | null = null;
  let err: IntegrationError | null = null;
  try {
    const runtime = getConnectorRuntime(job.provider);
    const handler = runtime?.actions[job.operation];
    if (!handler)
      throw new IntegrationError('not_configured', 'This action is not available.', {
        retryable: false,
      });
    const call = await connectionCaller(db, actor, job.connection_id, ctx);
    res = await handler({
      db,
      actor,
      connectionId: job.connection_id,
      workspaceId: job.workspace_id,
      actorUserId: job.actor_user_id,
      call,
      input: job.input ?? {},
      documentId: job.document_id,
      requestId: job.request_id,
      correlationId: job.correlation_id,
    });
  } catch (e) {
    err = toIntegrationError(e);
  }
  const durationMs = Date.now() - started;
  const finish = async () => {
    const [r] = (await db.execute(
      sql`select st_integration_finish_job(${job.id}::uuid, ${!err}, ${err?.retryable ?? false},
        ${err?.code ?? null}, ${err ? sanitizeText(err.message) : null},
        ${JSON.stringify(sanitizeMetadata(res?.output ?? {}))}::jsonb,
        ${err?.options.retryAfterSeconds ?? null}) as status`,
    )) as unknown as { status: string | null }[];
    return r?.status ?? 'failed';
  };
  const status = await finish();
  // Health and activity are written as the job's member. If they can no longer act in the
  // workspace (removed, role changed), the job result above still stands.
  await withActor(db, actor, async (tx) => {
    if (!err) await recordConnectionHealth(tx, job.connection_id, { ok: true });
    else if (isConnectionError(err))
      await recordConnectionHealth(tx, job.connection_id, {
        ok: false,
        status: err.connectionStatus ?? 'error',
        code: err.code,
        message: err.message,
      });
    await logActivity(tx, {
      workspaceId: job.workspace_id,
      connectionId: job.connection_id,
      provider: job.provider,
      action: job.operation,
      status: status === 'succeeded' ? 'success' : status === 'retrying' ? 'retrying' : 'failed',
      actorUserId: job.actor_user_id,
      jobId: job.id,
      documentId: job.document_id,
      requestId: job.request_id,
      correlationId: job.correlation_id,
      externalReference: res?.externalReference ?? null,
      durationMs,
      errorCode: err?.code ?? null,
      message: err?.message ?? res?.message ?? null,
      metadata: { attempt: job.attempt_count, maxAttempts: job.max_attempts },
    });
  }).catch(() => undefined);
  return status;
}

/** Sends a failed job back to the queue (managers only). Connector actions are idempotent, so a
 * retry finishes the work rather than repeating it. */
export async function retryIntegrationJob(db: Database, actor: ActorContext, jobId: string) {
  return withActor(db, actor, async (tx) => {
    const res = await tx
      .update(schema.integrationSyncJobs)
      .set({
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: new Date(),
        errorCode: null,
        errorMessage: null,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.integrationSyncJobs.id, jobId),
          eq(schema.integrationSyncJobs.status, 'failed'),
        ),
      )
      .returning();
    const job = res[0];
    if (!job)
      throw new AppError('invalid', 'Only failed jobs can be retried, and only by a manager.');
    const [conn] = await tx
      .select({ provider: schema.integrationConnections.provider })
      .from(schema.integrationConnections)
      .where(eq(schema.integrationConnections.id, job.connectionId));
    await logActivity(tx, {
      workspaceId: job.workspaceId,
      connectionId: job.connectionId,
      provider: conn?.provider ?? 'unknown',
      action: job.operation,
      status: 'pending',
      actorUserId: actor.userId!,
      jobId,
      message: 'Retry requested',
    });
  });
}

export async function cancelIntegrationJob(db: Database, actor: ActorContext, jobId: string) {
  return withActor(db, actor, async (tx) => {
    const res = await tx
      .update(schema.integrationSyncJobs)
      .set({ status: 'cancelled', updatedAt: new Date(), completedAt: new Date() })
      .where(
        and(
          eq(schema.integrationSyncJobs.id, jobId),
          sql`${schema.integrationSyncJobs.status} in ('pending','retrying')`,
        ),
      )
      .returning();
    if (!res[0])
      throw new AppError('invalid', 'Only waiting jobs can be cancelled, and only by a manager.');
  });
}

/** Jobs for the logs page: what ran, its attempts and outcome. No secrets are stored on jobs. */
export async function listIntegrationJobs(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  f: { connectionId?: string; status?: string; limit?: number } = {},
) {
  const j = schema.integrationSyncJobs;
  return withActor(db, actor, (tx) =>
    tx
      .select({
        id: j.id,
        connectionId: j.connectionId,
        operation: j.operation,
        status: j.status,
        attemptCount: j.attemptCount,
        maxAttempts: j.maxAttempts,
        nextAttemptAt: j.nextAttemptAt,
        documentId: j.documentId,
        requestId: j.requestId,
        externalReference: j.externalReference,
        correlationId: j.correlationId,
        errorCode: j.errorCode,
        errorMessage: j.errorMessage,
        createdAt: j.createdAt,
        completedAt: j.completedAt,
      })
      .from(j)
      .where(
        and(
          eq(j.workspaceId, workspaceId),
          f.connectionId ? eq(j.connectionId, f.connectionId) : undefined,
          f.status ? eq(j.status, f.status) : undefined,
        ),
      )
      .orderBy(desc(j.createdAt))
      .limit(Math.min(Math.max(f.limit ?? 50, 1), 200)),
  );
}
