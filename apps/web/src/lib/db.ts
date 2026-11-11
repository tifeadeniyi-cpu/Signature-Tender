import 'server-only';
import { createDb, type Database } from '@st/db';
import { env } from './env';

const globalForDb = globalThis as unknown as { __stDb?: Database };

/** Single pooled connection per server instance, as the non-superuser app role (RLS applies). */
export function db(): Database {
  globalForDb.__stDb ??= createDb(env().DATABASE_URL).db;
  return globalForDb.__stDb;
}
