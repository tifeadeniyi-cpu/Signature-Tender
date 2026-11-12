'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  inviteMember,
  resendInvitation,
  revokeInvitation,
  changeMemberRole,
  setMemberStatus,
  setMemberGroups,
  setMemberType,
  createGroup,
  deleteGroup,
  saveCustomRole,
  deleteCustomRole,
  acceptInvitation,
  AppError,
} from '@st/core';
import { db } from '@/lib/db';
import { requireUser, requireWorkspace, requestMeta, WORKSPACE_COOKIE } from '@/lib/session';
import { toFormError, type ActionState } from '@/lib/action-result';
import { sendTeamInvitation } from '@/lib/team-mail';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

async function run(fn: () => Promise<unknown>, ok: string): Promise<ActionState> {
  try {
    await fn();
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath('/app/team');
  return { ok: true, message: ok };
}

export async function inviteAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, membership } = await requireWorkspace();
  const email = str(fd, 'email');
  return run(async () => {
    const mail = await inviteMember(
      db(),
      { userId: user.id },
      membership.workspace.id,
      {
        email,
        roleId: str(fd, 'roleId'),
        groupId: str(fd, 'groupId') || null,
        memberType: str(fd, 'memberType') === 'external' ? 'external' : 'internal',
        expiresInDays: Number(str(fd, 'expiresInDays') || 7),
      },
      await requestMeta(),
    );
    await sendTeamInvitation(mail);
  }, `Invitation sent to ${email.trim().toLowerCase()}.`);
}

export async function resendInviteAction(id: string, _prev: ActionState): Promise<ActionState> {
  const user = await requireUser();
  return run(async () => {
    const mail = await resendInvitation(db(), { userId: user.id }, id, await requestMeta());
    await sendTeamInvitation(mail);
  }, 'A new invitation link was sent. The old link no longer works.');
}

export async function revokeInviteAction(id: string, _prev: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const meta = await requestMeta();
  return run(() => revokeInvitation(db(), { userId: user.id }, id, meta), 'Invitation cancelled.');
}

export async function memberAction(
  membershipId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const actor = { userId: user.id };
  const meta = await requestMeta();
  const intent = str(fd, 'intent');
  if (intent === 'role')
    return run(
      () => changeMemberRole(db(), actor, membershipId, str(fd, 'roleId'), meta),
      'Role updated.',
    );
  if (intent === 'groups')
    return run(
      () => setMemberGroups(db(), actor, membershipId, fd.getAll('groupId').map(String), meta),
      'Groups updated.',
    );
  if (intent === 'type')
    return run(
      () =>
        setMemberType(
          db(),
          actor,
          membershipId,
          str(fd, 'memberType') === 'external' ? 'external' : 'internal',
          meta,
        ),
      'Access type updated.',
    );
  const status = intent === 'suspend' ? 'suspended' : intent === 'remove' ? 'removed' : 'active';
  return run(
    () => setMemberStatus(db(), actor, membershipId, status, meta),
    status === 'suspended'
      ? 'Member suspended.'
      : status === 'removed'
        ? 'Member removed.'
        : 'Member reactivated.',
  );
}

export async function groupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, membership } = await requireWorkspace();
  const meta = await requestMeta();
  if (str(fd, 'intent') === 'delete')
    return run(
      () => deleteGroup(db(), { userId: user.id }, str(fd, 'groupId'), meta),
      'Group deleted.',
    );
  return run(
    () => createGroup(db(), { userId: user.id }, membership.workspace.id, str(fd, 'name'), meta),
    'Group created.',
  );
}

export async function roleAction(
  roleId: string | null,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const { user, membership } = await requireWorkspace();
  const meta = await requestMeta();
  if (str(fd, 'intent') === 'delete' && roleId)
    return run(
      () => deleteCustomRole(db(), { userId: user.id }, membership.workspace.id, roleId, meta),
      'Role deleted.',
    );
  return run(
    () =>
      saveCustomRole(
        db(),
        { userId: user.id },
        membership.workspace.id,
        roleId,
        {
          name: str(fd, 'name'),
          description: str(fd, 'description'),
          permissions: fd.getAll('permission').map(String),
        },
        meta,
      ),
    roleId ? 'Role saved.' : 'Role created.',
  );
}

export async function acceptInviteAction(token: string, _prev: ActionState): Promise<ActionState> {
  const user = await requireUser();
  let ws: string;
  try {
    ws = (await acceptInvitation(db(), { userId: user.id }, token)).workspaceId;
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    throw err;
  }
  (await cookies()).set(WORKSPACE_COOKIE, ws, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect('/app');
}
