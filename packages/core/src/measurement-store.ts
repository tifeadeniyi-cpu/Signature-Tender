import { sql } from 'drizzle-orm';
import { withActor, type ActorContext, type Database } from '@st/db';
import { isSitePage, type TrafficSource } from './measurement';

// Server-side recording. Each call goes through a validating database function; the app role
// cannot read these tables back.

/** Counts one website visit (page group and source category only, no visitor identifier). */
export async function recordVisit(db: Database, page: string, source: TrafficSource) {
  await db.execute(sql`select st_track_visit(${isSitePage(page) ? page : 'other'}, ${source})`);
}

/** Records where a new account came from (once, and only within 7 days of creating it). */
export async function recordSignupSource(db: Database, actor: ActorContext, source: TrafficSource) {
  await withActor(db, actor, (tx) => tx.execute(sql`select st_track_signup_source(${source})`));
}

/** Adds active seconds for today. The database caps the amount by the time actually elapsed. */
export async function recordActiveTime(db: Database, actor: ActorContext, seconds: number) {
  const s = Math.max(0, Math.min(90, Math.round(seconds)));
  if (!s) return;
  await withActor(db, actor, (tx) => tx.execute(sql`select st_track_active(${s}::int)`));
}

/** Deletes per-person activity older than 13 months. Returns the rows removed. */
export async function pruneMeasurement(db: Database): Promise<number> {
  const [r] = (await db.execute(sql`select st_track_prune() as n`)) as unknown as { n: number }[];
  return Number(r?.n ?? 0);
}
