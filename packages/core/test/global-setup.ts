import { runMigrations } from '@st/db/migrate';
import { seedReferenceData } from '@st/db/seed';
import { OWNER_URL } from './env';

export default async function setup() {
  await runMigrations(OWNER_URL);
  await seedReferenceData(OWNER_URL);
}
