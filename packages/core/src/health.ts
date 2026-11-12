import { sql } from 'drizzle-orm';
import type { Database } from '@st/db';

/** Round trip to the database for health checks. Reads no tenant data. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
