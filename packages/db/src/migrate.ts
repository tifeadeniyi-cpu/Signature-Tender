import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDb } from './client';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Applies pending migrations. Must run with the owner role; the app role cannot create tables. */
export async function runMigrations(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS });
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
