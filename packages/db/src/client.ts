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
