import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDb } from './client';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Lists migrations in the journal that the database has no record of. Drizzle only applies
 * migrations newer than the last one recorded, so a migration from another branch with a later
 * timestamp makes it skip older ones silently. A record matches by timestamp or by file hash
 * (a file edited after it was applied keeps its timestamp).
 */
export function findUnrecorded(
  journal: { folderMillis: number; hash: string }[],
  recorded: { created_at: string | number; hash: string }[],
): number[] {
  const millis = new Set(recorded.map((r) => Number(r.created_at)));
  const hashes = new Set(recorded.map((r) => r.hash));
  return journal
    .filter((m) => !millis.has(m.folderMillis) && !hashes.has(m.hash))
    .map((m) => m.folderMillis);
}

/** Applies pending migrations, then fails if any migration was skipped. Owner role only. */
export async function runMigrations(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS });
    const journal = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const recorded = (await db.execute(
      sql`select created_at, hash from drizzle.__drizzle_migrations`,
    )) as unknown as { created_at: string; hash: string }[];
    const missing = findUnrecorded(journal, recorded);
    if (missing.length)
      throw new Error(
        `Migrations were skipped (journal timestamps ${missing.join(', ')}). The database has a newer migration from another branch. Re-date the skipped journal entries after the newest recorded one; see docs/operations/migrations.md.`,
      );
  } finally {
    await close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error('DATABASE_URL_OWNER is required for migrations');
  await runMigrations(url);
  console.log('Migrations applied');
}
