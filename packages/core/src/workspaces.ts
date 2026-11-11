import { and, eq, sql, asc } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withActor, type Database, type ActorContext } from '@st/db';
import { recordAudit } from './audit';
import { AppError } from './errors';
import type { PermissionKey } from './permissions';

export const workspaceNameSchema = z.string().trim().min(1, 'Workspace name is required').max(120);

export const workspaceUpdateSchema = z.object({
  name: workspaceNameSchema,
  legalName: z.string().trim().max(200).optional().or(z.literal('')),
  contactEmail: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  website: z
    .string()
    .trim()
    .url('Enter a full URL, including https://')
    .refine((v) => v.startsWith('https://') || v.startsWith('http://'), 'Use an http(s) URL')
    .optional()
    .or(z.literal('')),
});

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'workspace';
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  roleKey: string;
  roleName: string;
}

export interface MembershipContext {
  workspace: typeof schema.workspaces.$inferSelect;
  roleKey: string;
  roleName: string;
  permissions: PermissionKey[];
}

export async function listMyWorkspaces(
  db: Database,
  actor: ActorContext,
): Promise<WorkspaceSummary[]> {
  return withActor(db, actor, async (tx) => {
    const rows = await tx
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        roleKey: schema.roles.key,
        roleName: schema.roles.name,
      })
      .from(schema.workspaceMemberships)
      .innerJoin(
        schema.workspaces,
        eq(schema.workspaces.id, schema.workspaceMemberships.workspaceId),
      )
      .innerJoin(schema.roles, eq(schema.roles.id, schema.workspaceMemberships.roleId))
      .where(
        and(
          eq(schema.workspaceMemberships.userId, actor.userId),
          eq(schema.workspaceMemberships.status, 'active'),
        ),
      )
      .orderBy(asc(schema.workspaces.createdAt));
    return rows;
  });
}

/** Loads the actor's membership in a workspace, or throws `forbidden` if they are not an active member. */
export async function getMembership(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
): Promise<MembershipContext> {
  if (!z.string().uuid().safeParse(workspaceId).success)
    throw new AppError('not_found', 'Workspace not found');
  return withActor(db, actor, async (tx) => {
    const rows = await tx
      .select({
        workspace: schema.workspaces,
        roleKey: schema.roles.key,
        roleName: schema.roles.name,
        roleId: schema.roles.id,
      })
      .from(schema.workspaceMemberships)
      .innerJoin(
        schema.workspaces,
        eq(schema.workspaces.id, schema.workspaceMemberships.workspaceId),
      )
      .innerJoin(schema.roles, eq(schema.roles.id, schema.workspaceMemberships.roleId))
      .where(
        and(
          eq(schema.workspaceMemberships.workspaceId, workspaceId),
          eq(schema.workspaceMemberships.userId, actor.userId),
          eq(schema.workspaceMemberships.status, 'active'),
        ),
      );
    const row = rows[0];
    if (!row) throw new AppError('forbidden', 'You do not have access to this workspace');
    const perms = await tx
      .select({ key: schema.rolePermissions.permissionKey })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, row.roleId));
    return {
      workspace: row.workspace,
      roleKey: row.roleKey,
      roleName: row.roleName,
      permissions: perms.map((p) => p.key as PermissionKey),
    };
  });
}

export async function createWorkspace(
  db: Database,
  actor: ActorContext,
  input: { name: string },
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string }> {
  const name = workspaceNameSchema.parse(input.name);
  return withActor(db, actor, async (tx) => {
    const [ownerRole] = await tx
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(sql`${schema.roles.workspaceId} is null`, eq(schema.roles.key, 'owner')));
    if (!ownerRole) throw new Error('System roles are not seeded');
    const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`;
    const [ws] = await tx
      .insert(schema.workspaces)
      .values({ name, slug, createdBy: actor.userId })
      .returning({ id: schema.workspaces.id });
    await tx
      .insert(schema.workspaceMemberships)
      .values({ workspaceId: ws!.id, userId: actor.userId, roleId: ownerRole.id });
    await recordAudit(tx, {
      workspaceId: ws!.id,
      actorUserId: actor.userId,
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: ws!.id,
      metadata: { name },
      ...meta,
    });
    return { id: ws!.id };
  });
}

export async function updateWorkspace(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  input: z.input<typeof workspaceUpdateSchema>,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const data = workspaceUpdateSchema.parse(input);
  const membership = await getMembership(db, actor, workspaceId);
  if (!membership.permissions.includes('workspace.manage')) {
    throw new AppError('forbidden', 'Your role cannot change workspace settings');
  }
  await withActor(db, actor, async (tx) => {
    const updated = await tx
      .update(schema.workspaces)
      .set({
        name: data.name,
        legalName: data.legalName || null,
        contactEmail: data.contactEmail || null,
        website: data.website || null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, workspaceId))
      .returning({ id: schema.workspaces.id });
    if (!updated.length)
      throw new AppError('forbidden', 'Your role cannot change workspace settings');
    const changed = Object.keys(data).filter(
      (k) =>
        (data as Record<string, unknown>)[k] !==
        (membership.workspace as Record<string, unknown>)[k],
    );
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'workspace.updated',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: { fields: changed },
      ...meta,
    });
  });
}

export async function listAuditEvents(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  limit = 50,
) {
  return withActor(db, actor, (tx) =>
    tx
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.workspaceId, workspaceId))
      .orderBy(sql`${schema.auditEvents.seq} desc`)
      .limit(Math.min(Math.max(limit, 1), 200)),
  );
}
