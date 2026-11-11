import { fileURLToPath as __toPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runMigrations } from '@st/db/migrate';
import { seedReferenceData } from '@st/db/seed';

const __dirname = __toPath(new URL('.', import.meta.url));

export default async function globalSetup() {
  const owner =
    process.env.TEST_DATABASE_URL_OWNER ??
    'postgres://st_owner:st_owner@localhost:5432/signature_tender_test';
  await runMigrations(owner);
  await seedReferenceData(owner);
  await fs.rm(path.resolve(__dirname, '../.mail-e2e'), { recursive: true, force: true });
}
