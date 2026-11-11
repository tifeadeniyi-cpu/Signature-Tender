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

/** Adds a user to a workspace with a system role, using the owner connection (bypasses RLS). */
export async function addMember(
  workspaceId: string,
  userId: string,
  roleKey: string,
): Promise<void> {
  const { db, close } = createDb(OWNER_URL, { max: 1 });
  const { sql } = await import('drizzle-orm');
  const [role] = await db
    .select()
    .from(schema.roles)
    .where(sql`${schema.roles.key} = ${roleKey} and ${schema.roles.workspaceId} is null`);
  await db.insert(schema.workspaceMemberships).values({ workspaceId, userId, roleId: role!.id });
  await close();
}

export async function makePdf(pages = 2): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++)
    doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 50, y: 700 });
  return doc.save();
}
