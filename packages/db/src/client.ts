import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDb(
  url: string,
  opts: { max?: number } = {},
): { db: Database; close: () => Promise<void> } {
  if (!url) throw new Error('Database URL is not configured');
  const client = postgres(url, { max: opts.max ?? 10, prepare: false, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

export interface ActorContext {
  /** Authenticated user id. Row-level security policies read it via current_setting('app.user_id'). */
  userId: string;
}

/**
 * Runs `fn` in a transaction with the actor bound for row-level security. All tenant-scoped reads
 * and writes must go through this helper; the app's database role cannot see tenant rows otherwise.
 */
export async function withActor<T>(
  db: Database,
  actor: ActorContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!actor.userId) throw new Error('withActor requires a userId');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${actor.userId}, true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` with a recipient's link token bound for row-level security. Only the SHA-256 of the token
 * is sent to the database; policies resolve it to exactly one recipient of one request.
 */
export async function withSigner<T>(
  db: Database,
  tokenHash: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new Error('withSigner requires a token hash');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.signer_token_hash', ${tokenHash}, true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` as the billing system: the Stripe webhook after it has verified Stripe's signature.
 * Policies let this context record payments and grant credits, which no signed-in user can do.
 * Only the webhook handlers in @st/core billing may call this.
 */
export async function withBillingSystem<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.system_actor', 'billing', true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` as the notification dispatcher: it claims queued emails, records send results and
 * provider delivery events. Policies let only this context update notification rows.
 * Only the notification service in @st/core may call this.
 */
export async function withNotificationSystem<T>(
  db: Database,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.system_actor', 'notifications', true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` as the certificate re-issue job: it may read completed requests' evidence and give
 * those still on an old certificate a new one (see migration 0023). Only @st/core's
 * reissueCertificates may call this, after a staff check.
 */
export async function withCertificateSystem<T>(
  db: Database,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.system_actor', 'certificates', true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` as a signed-in user reading documents they claimed after signing. Claim policies are
 * active only in this context, so claimed requests never appear in ordinary workspace queries.
 */
export async function withClaimant<T>(
  db: Database,
  actor: ActorContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!actor.userId) throw new Error('withClaimant requires a userId');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${actor.userId}, true)`);
    await tx.execute(sql`select set_config('app.claimant', 'on', true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` with a verified-email retrieval session bound (spec 17.3). Policies resolve the
 * session hash to one email and expose only that recipient's own requests and allowed files.
 */
export async function withRetrieval<T>(
  db: Database,
  sessionHash: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f]{64}$/.test(sessionHash)) throw new Error('withRetrieval requires a session hash');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.retrieval_session_hash', ${sessionHash}, true)`);
    return fn(tx);
  });
}

export interface StudioActor {
  /** Signed-in user, if any. */
  userId?: string | null;
  /** SHA-256 of the guest Studio cookie, if the browser has one. */
  guestHash?: string | null;
}

/**
 * Runs `fn` as a Signature Studio designer: a signed-in user and/or a guest browser session.
 * Policies show each actor only the designs and purchases that belong to them.
 */
export async function withStudio<T>(
  db: Database,
  actor: StudioActor,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (actor.guestHash && !/^[0-9a-f]{64}$/.test(actor.guestHash))
    throw new Error('withStudio requires a guest session hash');
  if (!actor.userId && !actor.guestHash) throw new Error('withStudio requires an actor');
  return db.transaction(async (tx) => {
    if (actor.userId) await tx.execute(sql`select set_config('app.user_id', ${actor.userId}, true)`);
    if (actor.guestHash)
      await tx.execute(sql`select set_config('app.studio_guest', ${actor.guestHash}, true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` as the Studio fulfilment service: it renders and stores purchased files, logs
 * downloads and keeps rate-limit counters. Callers must check the entitlement first.
 * Only the Studio service in @st/core may call this.
 */
export async function withStudioSystem<T>(
  db: Database,
  fn: (tx: Tx) => Promise<T>,
  userId?: string,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.system_actor', 'studio', true)`);
    if (userId) await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
