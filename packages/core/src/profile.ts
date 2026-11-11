import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withActor, type Database, type ActorContext } from '@st/db';
import { recordAudit } from './audit';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  jobTitle: z.string().trim().max(120).optional().or(z.literal('')),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^[+0-9 ()\-.]*$/, 'Use digits, spaces and + ( ) - only')
    .optional()
    .or(z.literal('')),
  timezone: z.string().refine((tz) => TIMEZONES.has(tz), 'Choose a valid time zone'),
});

export async function getProfile(db: Database, actor: ActorContext) {
  return withActor(db, actor, async (tx) => {
    const [u] = await tx
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        twoFactorEnabled: schema.user.twoFactorEnabled,
      })
      .from(schema.user)
      .where(eq(schema.user.id, actor.userId));
    const [p] = await tx
      .select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, actor.userId));
    return {
      ...u!,
      jobTitle: p?.jobTitle ?? '',
      phone: p?.phone ?? '',
      timezone: p?.timezone ?? 'America/Chicago',
    };
  });
}

export async function updateProfile(
  db: Database,
  actor: ActorContext,
  input: z.input<typeof profileUpdateSchema>,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const data = profileUpdateSchema.parse(input);
  await withActor(db, actor, async (tx) => {
    await tx
      .update(schema.user)
      .set({ name: data.name, updatedAt: new Date() })
      .where(eq(schema.user.id, actor.userId));
    await tx
      .insert(schema.userProfiles)
      .values({
        userId: actor.userId,
        jobTitle: data.jobTitle || null,
        phone: data.phone || null,
        timezone: data.timezone,
      })
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: {
          jobTitle: data.jobTitle || null,
          phone: data.phone || null,
          timezone: data.timezone,
          updatedAt: new Date(),
        },
      });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'profile.updated',
      targetType: 'user',
      targetId: actor.userId,
      ...meta,
    });
  });
}
