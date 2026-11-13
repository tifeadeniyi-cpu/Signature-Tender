import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withActor, type Database, type ActorContext, type Tx } from '@st/db';
import { AppError } from './errors';
import { requireCardForTeam } from './billing';
import { recordAudit } from './audit';
import { hashSecret, newSecret, isPlausibleSecret } from './signing-crypto';
import { PERMISSIONS, isPermissionKey, type PermissionKey } from './permissions';

/**
 * Team management (spec Part 20): members, invitations, custom roles and groups. Every rule is
 * also enforced in the database: nobody can give a role that carries permissions they lack,
 * change their own membership, or leave a workspace without an active owner.
 */

type Meta = { ipAddress?: string | null; userAgent?: string | null };
const uuid = z.string().uuid();
const checkId = (id: string, what = 'Not found') => {
  if (!uuid.safeParse(id).success) throw new AppError('not_found', what);
};

async function can(tx: Tx, ws: string, perm: PermissionKey) {
  const [r] = (await tx.execute(
    sql`select st_has_permission(${ws}::uuid, ${perm}) as ok`,
  )) as unknown as { ok: boolean }[];
  return Boolean(r?.ok);
}
async function requirePerm(tx: Tx, ws: string, perm: PermissionKey, message: string) {
  if (!(await can(tx, ws, perm))) throw new AppError('forbidden', message);
}
async function canAssign(tx: Tx, ws: string, roleId: string) {
  const [r] = (await tx.execute(
    sql`select st_can_assign_role(${ws}::uuid, ${roleId}::uuid) as ok`,
  )) as unknown as { ok: boolean }[];
  return Boolean(r?.ok);
}

/** Maps the database's last-owner guard to a readable error. */
function ownerGuard(err: unknown): never {
  const msg = String((err as { message?: string })?.message ?? '');
  const cause = String((err as { cause?: { message?: string } })?.cause?.message ?? '');
  if (msg.includes('at least one active owner') || cause.includes('at least one active owner'))
    throw new AppError('conflict', 'A workspace must keep at least one active owner.');
  throw err;
}

// ---------------------------------------------------------------------------------------------
// Overview

export type MemberStatus = 'active' | 'suspended' | 'removed' | 'invited';

export interface TeamMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  status: MemberStatus;
  memberType: 'internal' | 'external';
  groups: { id: string; name: string }[];
  lastActiveAt: Date | null;
  joinedAt: Date;
  isYou: boolean;
  /** Whether the viewer may change this person (role they could assign, and not themselves). */
  manageable: boolean;
}

export interface TeamInvitation {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  groupName: string | null;
  memberType: 'internal' | 'external';
  invitedByName: string;
  expiresAt: Date;
  lastSentAt: Date;
  sentCount: number;
  state: 'pending' | 'expired';
  manageable: boolean;
}

export interface TeamRole {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: PermissionKey[];
  memberCount: number;
  assignable: boolean;
}

export async function getTeam(db: Database, actor: ActorContext, workspaceId: string) {
  checkId(workspaceId, 'Workspace not found');
  return withActor(db, actor, async (tx) => {
    await requirePerm(tx, workspaceId, 'team.view', 'Your role does not allow viewing the team.');
    const canManage = await can(tx, workspaceId, 'team.manage');
    const canManageRoles = await can(tx, workspaceId, 'roles.manage');

    const roleRows = await tx
      .select()
      .from(schema.roles)
      .where(
        sql`${schema.roles.workspaceId} is null or ${schema.roles.workspaceId} = ${workspaceId}::uuid`,
      )
      .orderBy(asc(schema.roles.createdAt));
    const rp = roleRows.length
      ? await tx
          .select()
          .from(schema.rolePermissions)
          .where(
            inArray(
              schema.rolePermissions.roleId,
              roleRows.map((r) => r.id),
            ),
          )
      : [];
    const assignable = new Set<string>();
    if (canManage)
      for (const r of roleRows) if (await canAssign(tx, workspaceId, r.id)) assignable.add(r.id);

    const memberRows = await tx
      .select({
        m: schema.workspaceMemberships,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.workspaceMemberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.workspaceMemberships.userId))
      .where(eq(schema.workspaceMemberships.workspaceId, workspaceId))
      .orderBy(asc(schema.workspaceMemberships.createdAt));
    const groups = await tx
      .select()
      .from(schema.workspaceGroups)
      .where(eq(schema.workspaceGroups.workspaceId, workspaceId))
      .orderBy(asc(schema.workspaceGroups.name));
    const gm = await tx
      .select()
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.workspaceId, workspaceId));
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const roleById = new Map(roleRows.map((r) => [r.id, r]));

    const members: TeamMember[] = memberRows
      .filter((r) => r.m.status !== 'removed')
      .map((r) => {
        const role = roleById.get(r.m.roleId);
        return {
          membershipId: r.m.id,
          userId: r.m.userId,
          name: r.name,
          email: r.email,
          roleId: r.m.roleId,
          roleKey: role?.key ?? '',
          roleName: role?.name ?? 'Unknown role',
          status: r.m.status as MemberStatus,
          memberType: r.m.memberType as 'internal' | 'external',
          groups: gm
            .filter((g) => g.membershipId === r.m.id)
            .map((g) => ({ id: g.groupId, name: groupName.get(g.groupId) ?? '' })),
          lastActiveAt: r.m.lastActiveAt,
          joinedAt: r.m.createdAt,
          isYou: r.m.userId === actor.userId,
          manageable: canManage && r.m.userId !== actor.userId && assignable.has(r.m.roleId),
        };
      });

    const invRows = await tx
      .select({ i: schema.workspaceInvitations, inviter: schema.user.name })
      .from(schema.workspaceInvitations)
      .innerJoin(schema.user, eq(schema.user.id, schema.workspaceInvitations.invitedBy))
      .where(
        and(
          eq(schema.workspaceInvitations.workspaceId, workspaceId),
          isNull(schema.workspaceInvitations.acceptedAt),
          isNull(schema.workspaceInvitations.revokedAt),
        ),
      )
      .orderBy(asc(schema.workspaceInvitations.createdAt));
    const now = Date.now();
    const invitations: TeamInvitation[] = invRows.map(({ i, inviter }) => ({
      id: i.id,
      email: i.email,
      roleId: i.roleId,
      roleName: roleById.get(i.roleId)?.name ?? '',
      groupName: i.groupId ? (groupName.get(i.groupId) ?? null) : null,
      memberType: i.memberType as 'internal' | 'external',
      invitedByName: inviter,
      expiresAt: i.expiresAt,
      lastSentAt: i.lastSentAt,
      sentCount: i.sentCount,
      state: i.expiresAt.getTime() < now ? 'expired' : 'pending',
      manageable: canManage && assignable.has(i.roleId),
    }));

    const roles: TeamRole[] = roleRows
      .filter((r) => r.key !== 'signer')
      .map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        permissions: rp
          .filter((p) => p.roleId === r.id)
          .map((p) => p.permissionKey)
          .filter(isPermissionKey),
        memberCount: members.filter((m) => m.roleId === r.id && m.status !== 'removed').length,
        assignable: assignable.has(r.id),
      }));

    return {
      members,
      invitations,
      roles,
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: gm.filter((x) => x.groupId === g.id).length,
      })),
      canManage,
      canManageRoles,
      metrics: {
        total: members.length,
        active: members.filter((m) => m.status === 'active').length,
        pending: invitations.filter((i) => i.state === 'pending').length,
        inactive: members.filter((m) => m.status === 'suspended').length,
        roles: roles.length,
        groups: groups.length,
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Invitations

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  roleId: uuid,
  groupId: uuid.nullable().optional(),
  memberType: z.enum(['internal', 'external']).default('internal'),
  expiresInDays: z.coerce
    .number()
    .int()
    .min(1, 'At least 1 day')
    .max(30, '30 days at most')
    .default(7),
});
export type InviteInput = z.input<typeof inviteSchema>;

export interface InvitationMail {
  invitationId: string;
  email: string;
  token: string;
  workspaceName: string;
  inviterName: string;
  roleName: string;
  expiresAt: Date;
}

async function mailFor(
  tx: Tx,
  inv: typeof schema.workspaceInvitations.$inferSelect,
  token: string,
  actor: ActorContext,
): Promise<InvitationMail> {
  const [w] = await tx
    .select({ name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, inv.workspaceId));
  const [r] = await tx
    .select({ name: schema.roles.name })
    .from(schema.roles)
    .where(eq(schema.roles.id, inv.roleId));
  const [u] = await tx
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, actor.userId));
  return {
    invitationId: inv.id,
    email: inv.email,
    token,
    workspaceName: w?.name ?? '',
    inviterName: u?.name ?? '',
    roleName: r?.name ?? '',
    expiresAt: inv.expiresAt,
  };
}

/** Creates an invitation and returns what the email needs. The token is never stored. */
export async function inviteMember(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: InviteInput,
  meta: Meta = {},
  /** Set when payments are live: companies then need a card on file to add people. */
  opts: { cardRequired?: boolean } = {},
): Promise<InvitationMail> {
  checkId(workspaceId, 'Workspace not found');
  const input = inviteSchema.parse(raw);
  return withActor(db, actor, async (tx) => {
    await requirePerm(tx, workspaceId, 'team.manage', 'Your role does not allow inviting people.');
    // Companies keep a card on file to add team members.
    if (opts.cardRequired) await requireCardForTeam(tx, workspaceId);
    if (!(await canAssign(tx, workspaceId, input.roleId)))
      throw new AppError('forbidden', 'You cannot give a role with more access than your own.');
    const [existing] = (await tx.execute(sql`
      select m.status from workspace_memberships m join "user" u on u.id = m.user_id
      where m.workspace_id = ${workspaceId}::uuid and lower(u.email) = ${input.email}
    `)) as unknown as { status: string }[];
    if (existing && existing.status !== 'removed')
      throw new AppError('conflict', 'This person is already a member of the workspace.');
    const [open] = await tx
      .select({ id: schema.workspaceInvitations.id })
      .from(schema.workspaceInvitations)
      .where(
        and(
          eq(schema.workspaceInvitations.workspaceId, workspaceId),
          sql`lower(${schema.workspaceInvitations.email}) = ${input.email}`,
          isNull(schema.workspaceInvitations.acceptedAt),
          isNull(schema.workspaceInvitations.revokedAt),
        ),
      );
    if (open)
      throw new AppError(
        'conflict',
        'This address already has an open invitation. Resend it instead.',
      );
    if (input.groupId) {
      const [g] = await tx
        .select()
        .from(schema.workspaceGroups)
        .where(
          and(
            eq(schema.workspaceGroups.id, input.groupId),
            eq(schema.workspaceGroups.workspaceId, workspaceId),
          ),
        );
      if (!g) throw new AppError('invalid', 'Choose a group from this workspace.');
    }
    const token = newSecret();
    const [inv] = await tx
      .insert(schema.workspaceInvitations)
      .values({
        workspaceId,
        email: input.email,
        roleId: input.roleId,
        groupId: input.groupId ?? null,
        memberType: input.memberType,
        tokenHash: hashSecret(token),
        invitedBy: actor.userId,
        expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
      })
      .returning();
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'team.member_invited',
      targetType: 'invitation',
      targetId: inv!.id,
      metadata: { email: input.email, roleId: input.roleId, memberType: input.memberType },
      ...meta,
    });
    return mailFor(tx, inv!, token, actor);
  });
}

/** Issues a fresh link (the old one stops working) and extends an expired invitation by 7 days. */
export async function resendInvitation(
  db: Database,
  actor: ActorContext,
  invitationId: string,
  meta: Meta = {},
): Promise<InvitationMail> {
  checkId(invitationId, 'Invitation not found');
  return withActor(db, actor, async (tx) => {
    const [inv] = await tx
      .select()
      .from(schema.workspaceInvitations)
      .where(eq(schema.workspaceInvitations.id, invitationId));
    if (!inv || inv.acceptedAt || inv.revokedAt)
      throw new AppError('not_found', 'Invitation not found');
    const lastMinute = Date.now() - inv.lastSentAt.getTime() < 60_000;
    if (lastMinute)
      throw new AppError('conflict', 'Wait a minute before sending this invitation again.');
    const token = newSecret();
    const expiresAt =
      inv.expiresAt.getTime() < Date.now() + 86_400_000
        ? new Date(Date.now() + 7 * 86_400_000)
        : inv.expiresAt;
    const res = await tx
      .update(schema.workspaceInvitations)
      .set({
        tokenHash: hashSecret(token),
        expiresAt,
        lastSentAt: new Date(),
        sentCount: inv.sentCount + 1,
      })
      .where(eq(schema.workspaceInvitations.id, invitationId))
      .returning();
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow managing this invitation.');
    await recordAudit(tx, {
      workspaceId: inv.workspaceId,
      actorUserId: actor.userId,
      action: 'team.invitation_resent',
      targetType: 'invitation',
      targetId: inv.id,
      ...meta,
    });
    return mailFor(tx, res[0]!, token, actor);
  });
}

export async function revokeInvitation(
  db: Database,
  actor: ActorContext,
  invitationId: string,
  meta: Meta = {},
) {
  checkId(invitationId, 'Invitation not found');
  await withActor(db, actor, async (tx) => {
    const [inv] = await tx
      .select()
      .from(schema.workspaceInvitations)
      .where(eq(schema.workspaceInvitations.id, invitationId));
    if (!inv || inv.acceptedAt || inv.revokedAt)
      throw new AppError('not_found', 'Invitation not found');
    const res = await tx
      .update(schema.workspaceInvitations)
      .set({ revokedAt: new Date() })
      .where(eq(schema.workspaceInvitations.id, invitationId))
      .returning({ id: schema.workspaceInvitations.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow managing this invitation.');
    await recordAudit(tx, {
      workspaceId: inv.workspaceId,
      actorUserId: actor.userId,
      action: 'team.invitation_revoked',
      targetType: 'invitation',
      targetId: inv.id,
      ...meta,
    });
  });
}

export async function previewInvitation(db: Database, actor: ActorContext | null, token: string) {
  if (!isPlausibleSecret(token)) return null;
  const run = async (tx: Tx) => {
    const [row] = (await tx.execute(
      sql`select * from st_invitation_preview(${hashSecret(token)})`,
    )) as unknown as {
      workspace_name: string;
      inviter_name: string;
      email: string;
      role_name: string;
      state: 'open' | 'revoked' | 'accepted' | 'expired';
    }[];
    return row
      ? {
          workspaceName: row.workspace_name,
          inviterName: row.inviter_name,
          email: row.email,
          roleName: row.role_name,
          state: row.state,
        }
      : null;
  };
  return actor ? withActor(db, actor, run) : db.transaction(run);
}

const ACCEPT_MESSAGES: Record<string, string> = {
  not_found: 'This invitation link is not valid.',
  revoked: 'This invitation was cancelled. Ask for a new one.',
  accepted: 'This invitation has already been used.',
  expired: 'This invitation has expired. Ask for a new one.',
  unverified: 'Verify your email address first.',
  wrong_email: 'This invitation was sent to a different email address. Sign in with that address.',
};

export async function acceptInvitation(db: Database, actor: ActorContext, token: string) {
  if (!isPlausibleSecret(token)) throw new AppError('not_found', ACCEPT_MESSAGES.not_found!);
  return withActor(db, actor, async (tx) => {
    const [r] = (await tx.execute(
      sql`select * from st_accept_invitation(${hashSecret(token)})`,
    )) as unknown as { result: string; ws: string | null }[];
    if (r?.result !== 'ok')
      throw new AppError(
        r?.result === 'not_found'
          ? 'not_found'
          : r?.result === 'wrong_email'
            ? 'forbidden'
            : 'conflict',
        ACCEPT_MESSAGES[r?.result ?? 'not_found'] ?? ACCEPT_MESSAGES.not_found!,
      );
    return { workspaceId: r.ws! };
  });
}

// ---------------------------------------------------------------------------------------------
// Members

async function loadMember(tx: Tx, membershipId: string) {
  const [m] = await tx
    .select()
    .from(schema.workspaceMemberships)
    .where(eq(schema.workspaceMemberships.id, membershipId));
  if (!m) throw new AppError('not_found', 'Member not found');
  return m;
}

export async function changeMemberRole(
  db: Database,
  actor: ActorContext,
  membershipId: string,
  roleId: string,
  meta: Meta = {},
) {
  checkId(membershipId, 'Member not found');
  checkId(roleId, 'Role not found');
  await withActor(db, actor, async (tx) => {
    const m = await loadMember(tx, membershipId);
    if (m.userId === actor.userId)
      throw new AppError('forbidden', 'You cannot change your own role.');
    if (!(await canAssign(tx, m.workspaceId, roleId)))
      throw new AppError('forbidden', 'You cannot give a role with more access than your own.');
    const res = await tx
      .update(schema.workspaceMemberships)
      .set({ roleId, updatedAt: new Date() })
      .where(eq(schema.workspaceMemberships.id, membershipId))
      .returning({ id: schema.workspaceMemberships.id })
      .catch(ownerGuard);
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow changing this member.');
    await recordAudit(tx, {
      workspaceId: m.workspaceId,
      actorUserId: actor.userId,
      action: 'team.role_changed',
      targetType: 'membership',
      targetId: membershipId,
      metadata: { from: m.roleId, to: roleId },
      ...meta,
    });
  });
}

/** Suspends, reactivates or removes a member. Removing keeps their history and documents. */
export async function setMemberStatus(
  db: Database,
  actor: ActorContext,
  membershipId: string,
  status: 'active' | 'suspended' | 'removed',
  meta: Meta = {},
) {
  checkId(membershipId, 'Member not found');
  await withActor(db, actor, async (tx) => {
    const m = await loadMember(tx, membershipId);
    if (m.userId === actor.userId)
      throw new AppError('forbidden', 'You cannot change your own membership here.');
    const res = await tx
      .update(schema.workspaceMemberships)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.workspaceMemberships.id, membershipId))
      .returning({ id: schema.workspaceMemberships.id })
      .catch(ownerGuard);
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow changing this member.');
    if (status === 'removed')
      await tx
        .delete(schema.groupMembers)
        .where(eq(schema.groupMembers.membershipId, membershipId));
    await recordAudit(tx, {
      workspaceId: m.workspaceId,
      actorUserId: actor.userId,
      action:
        status === 'active'
          ? 'team.member_reactivated'
          : status === 'suspended'
            ? 'team.member_suspended'
            : 'team.member_removed',
      targetType: 'membership',
      targetId: membershipId,
      ...meta,
    });
  });
}

/** Replaces the groups a member belongs to. */
export async function setMemberGroups(
  db: Database,
  actor: ActorContext,
  membershipId: string,
  groupIds: string[],
  meta: Meta = {},
) {
  checkId(membershipId, 'Member not found');
  const ids = z.array(uuid).max(20).parse(groupIds);
  await withActor(db, actor, async (tx) => {
    const m = await loadMember(tx, membershipId);
    await requirePerm(
      tx,
      m.workspaceId,
      'team.manage',
      'Your role does not allow changing groups.',
    );
    await tx.delete(schema.groupMembers).where(eq(schema.groupMembers.membershipId, membershipId));
    if (ids.length)
      await tx
        .insert(schema.groupMembers)
        .values(ids.map((groupId) => ({ groupId, membershipId, workspaceId: m.workspaceId })));
    await recordAudit(tx, {
      workspaceId: m.workspaceId,
      actorUserId: actor.userId,
      action: 'team.groups_changed',
      targetType: 'membership',
      targetId: membershipId,
      metadata: { groupIds: ids },
      ...meta,
    });
  });
}

export async function setMemberType(
  db: Database,
  actor: ActorContext,
  membershipId: string,
  memberType: 'internal' | 'external',
  meta: Meta = {},
) {
  checkId(membershipId, 'Member not found');
  const type = z.enum(['internal', 'external']).parse(memberType);
  await withActor(db, actor, async (tx) => {
    const m = await loadMember(tx, membershipId);
    const res = await tx
      .update(schema.workspaceMemberships)
      .set({ memberType: type, updatedAt: new Date() })
      .where(eq(schema.workspaceMemberships.id, membershipId))
      .returning({ id: schema.workspaceMemberships.id });
    if (!res.length)
      throw new AppError('forbidden', 'Your role does not allow changing this member.');
    await recordAudit(tx, {
      workspaceId: m.workspaceId,
      actorUserId: actor.userId,
      action: 'team.member_type_changed',
      targetType: 'membership',
      targetId: membershipId,
      metadata: { memberType: type },
      ...meta,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Groups

const groupName = z.string().trim().min(1, 'Name the group').max(60);

export async function createGroup(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  name: string,
  meta: Meta = {},
) {
  checkId(workspaceId, 'Workspace not found');
  const n = groupName.parse(name);
  return withActor(db, actor, async (tx) => {
    await requirePerm(tx, workspaceId, 'team.manage', 'Your role does not allow managing groups.');
    const [dup] = await tx
      .select({ id: schema.workspaceGroups.id })
      .from(schema.workspaceGroups)
      .where(
        and(
          eq(schema.workspaceGroups.workspaceId, workspaceId),
          sql`lower(${schema.workspaceGroups.name}) = lower(${n})`,
        ),
      );
    if (dup) throw new AppError('conflict', 'A group with this name already exists.');
    const [g] = await tx
      .insert(schema.workspaceGroups)
      .values({ workspaceId, name: n })
      .returning();
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'team.group_created',
      targetType: 'group',
      targetId: g!.id,
      metadata: { name: n },
      ...meta,
    });
    return g!;
  });
}

export async function deleteGroup(
  db: Database,
  actor: ActorContext,
  groupId: string,
  meta: Meta = {},
) {
  checkId(groupId, 'Group not found');
  await withActor(db, actor, async (tx) => {
    const [g] = await tx
      .select()
      .from(schema.workspaceGroups)
      .where(eq(schema.workspaceGroups.id, groupId));
    if (!g) throw new AppError('not_found', 'Group not found');
    const res = await tx
      .delete(schema.workspaceGroups)
      .where(eq(schema.workspaceGroups.id, groupId))
      .returning({ id: schema.workspaceGroups.id });
    if (!res.length) throw new AppError('forbidden', 'Your role does not allow managing groups.');
    await recordAudit(tx, {
      workspaceId: g.workspaceId,
      actorUserId: actor.userId,
      action: 'team.group_deleted',
      targetType: 'group',
      targetId: groupId,
      metadata: { name: g.name },
      ...meta,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Custom roles

export const roleSchema = z.object({
  name: z.string().trim().min(1, 'Name the role').max(60),
  description: z.string().trim().max(200).default(''),
  permissions: z
    .array(z.string())
    .max(Object.keys(PERMISSIONS).length)
    .transform((a, ctx) => {
      const bad = a.filter((p) => !isPermissionKey(p));
      if (bad.length) ctx.addIssue({ code: 'custom', message: 'Unknown permission' });
      return [...new Set(a.filter(isPermissionKey))];
    }),
});
export type RoleInput = z.input<typeof roleSchema>;

const slugKey = (name: string) =>
  `custom_${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30) || 'role'
  }_${crypto.randomUUID().slice(0, 6)}`;

/** Creates (no id) or updates a custom role. It can only carry permissions the editor holds. */
export async function saveCustomRole(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  roleId: string | null,
  raw: RoleInput,
  meta: Meta = {},
) {
  checkId(workspaceId, 'Workspace not found');
  if (roleId) checkId(roleId, 'Role not found');
  const input = roleSchema.parse(raw);
  return withActor(db, actor, async (tx) => {
    await requirePerm(tx, workspaceId, 'roles.manage', 'Your role does not allow editing roles.');
    for (const p of input.permissions)
      if (!(await can(tx, workspaceId, p)))
        throw new AppError(
          'forbidden',
          `You cannot grant "${PERMISSIONS[p]}" because you do not have it.`,
        );
    const [dup] = await tx
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(
        and(
          sql`(${schema.roles.workspaceId} is null or ${schema.roles.workspaceId} = ${workspaceId}::uuid)`,
          sql`lower(${schema.roles.name}) = lower(${input.name})`,
          roleId ? sql`${schema.roles.id} <> ${roleId}::uuid` : sql`true`,
        ),
      );
    if (dup) throw new AppError('conflict', 'A role with this name already exists.');
    let id = roleId;
    if (roleId) {
      const [r] = await tx.select().from(schema.roles).where(eq(schema.roles.id, roleId));
      if (!r || r.workspaceId !== workspaceId || r.isSystem)
        throw new AppError(
          'forbidden',
          'Built-in roles cannot be changed. Create a custom role instead.',
        );
      // Members holding this role must stay manageable by the editor, so the role cannot be used
      // to reach beyond the editor's own access.
      await tx
        .update(schema.roles)
        .set({ name: input.name, description: input.description })
        .where(eq(schema.roles.id, roleId));
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    } else {
      const [r] = await tx
        .insert(schema.roles)
        .values({
          workspaceId,
          key: slugKey(input.name),
          name: input.name,
          description: input.description,
          isSystem: false,
        })
        .returning();
      id = r!.id;
    }
    if (input.permissions.length)
      await tx
        .insert(schema.rolePermissions)
        .values(input.permissions.map((p) => ({ roleId: id!, permissionKey: p })));
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: roleId ? 'team.role_updated' : 'team.role_created',
      targetType: 'role',
      targetId: id!,
      metadata: { name: input.name, permissions: input.permissions },
      ...meta,
    });
    return { id: id! };
  });
}

export async function deleteCustomRole(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  roleId: string,
  meta: Meta = {},
) {
  checkId(roleId, 'Role not found');
  await withActor(db, actor, async (tx) => {
    const [r] = await tx.select().from(schema.roles).where(eq(schema.roles.id, roleId));
    if (!r || r.workspaceId !== workspaceId || r.isSystem)
      throw new AppError('not_found', 'Role not found');
    const [inUse] = (await tx.execute(sql`
      select (select count(*) from workspace_memberships where role_id = ${roleId}::uuid and status <> 'removed')
           + (select count(*) from workspace_invitations where role_id = ${roleId}::uuid and accepted_at is null and revoked_at is null) as n
    `)) as unknown as { n: number | string }[];
    if (Number(inUse?.n ?? 0) > 0)
      throw new AppError('conflict', 'Move members and open invitations to another role first.');
    const res = await tx
      .delete(schema.roles)
      .where(eq(schema.roles.id, roleId))
      .returning({ id: schema.roles.id });
    if (!res.length) throw new AppError('forbidden', 'Your role does not allow editing roles.');
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'team.role_deleted',
      targetType: 'role',
      targetId: roleId,
      metadata: { name: r.name },
      ...meta,
    });
  });
}

/** Records that the actor used the workspace (throttled in the database). */
export async function touchMembership(db: Database, actor: ActorContext, workspaceId: string) {
  if (!uuid.safeParse(workspaceId).success) return;
  await withActor(db, actor, (tx) =>
    tx.execute(sql`select st_touch_membership(${workspaceId}::uuid)`),
  );
}
