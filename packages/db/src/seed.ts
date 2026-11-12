import { sql } from 'drizzle-orm';
import { createDb } from './client';
import * as s from './schema';
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  LAUNCH_PLANS,
  LAUNCH_PRICES,
  FEATURE_FLAGS,
  APP_CONFIG,
} from './reference';

/** Idempotent reference-data seed. Safe to run repeatedly; never inserts customer data. */
export async function seedReferenceData(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await db.transaction(async (tx) => {
      for (const [key, description] of Object.entries(PERMISSIONS)) {
        await tx
          .insert(s.permissions)
          .values({ key, description })
          .onConflictDoUpdate({ target: s.permissions.key, set: { description } });
      }
      for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
        const existing = await tx
          .select()
          .from(s.roles)
          .where(sql`${s.roles.workspaceId} is null and ${s.roles.key} = ${key}`);
        let roleId = existing[0]?.id;
        if (!roleId) {
          const [row] = await tx
            .insert(s.roles)
            .values({ key, name: role.name, description: role.description, isSystem: true })
            .returning();
          roleId = row!.id;
        } else {
          await tx
            .update(s.roles)
            .set({ name: role.name, description: role.description })
            .where(sql`${s.roles.id} = ${roleId}`);
        }
        await tx.delete(s.rolePermissions).where(sql`${s.rolePermissions.roleId} = ${roleId}`);
        if (role.permissions.length) {
          await tx
            .insert(s.rolePermissions)
            .values(role.permissions.map((p) => ({ roleId: roleId!, permissionKey: p })));
        }
      }
      for (const p of LAUNCH_PLANS) {
        await tx
          .insert(s.subscriptionPlans)
          .values({ ...p })
          .onConflictDoNothing({ target: s.subscriptionPlans.code });
      }
      for (const p of LAUNCH_PRICES) {
        await tx
          .insert(s.prices)
          .values({ ...p })
          .onConflictDoNothing({ target: s.prices.code });
      }
      for (const f of FEATURE_FLAGS) {
        await tx
          .insert(s.featureFlags)
          .values({ ...f, environments: 'environments' in f ? [...f.environments] : [] })
          .onConflictDoNothing({ target: s.featureFlags.key });
      }
      for (const c of APP_CONFIG) {
        await tx
          .insert(s.appConfig)
          .values({ ...c })
          .onConflictDoNothing({ target: s.appConfig.key });
      }
    });
  } finally {
    await close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error('DATABASE_URL_OWNER is required');
  await seedReferenceData(url);
  console.log('Reference data seeded');
}
