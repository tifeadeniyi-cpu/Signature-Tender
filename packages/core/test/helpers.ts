import { createDb, schema } from '@st/db';
import { OWNER_URL } from './env';

/** Creates a verified user directly with the owner connection (bypasses auth for service tests). */
export async function makeUser(label: string): Promise<string> {
  const { db, close } = createDb(OWNER_URL, { max: 1 });
  const id = `test_${label}_${crypto.randomUUID()}`;
  await db
    .insert(schema.user)
    .values({ id, name: label, email: `${id}@example.test`, emailVerified: true });
  await close();
  return id;
}
