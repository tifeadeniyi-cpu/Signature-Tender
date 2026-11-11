'use server';
import { revalidatePath } from 'next/cache';
import { updateWorkspace, updateProfile, createWorkspace } from '@st/core';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireUser, requireWorkspace, requestMeta, WORKSPACE_COOKIE } from '@/lib/session';
import { toActionError, type ActionState } from '@/lib/action-result';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

export async function saveWorkspace(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, membership } = await requireWorkspace();
  try {
    await updateWorkspace(
      db(),
      { userId: user.id },
      membership.workspace.id,
      {
        name: str(fd, 'name'),
        legalName: str(fd, 'legalName'),
        contactEmail: str(fd, 'contactEmail'),
        website: str(fd, 'website'),
      },
      await requestMeta(),
    );
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath('/app', 'layout');
  return { ok: true, message: 'Workspace settings saved.' };
}

export async function saveProfile(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await updateProfile(
      db(),
      { userId: user.id },
      {
        name: str(fd, 'name'),
        jobTitle: str(fd, 'jobTitle'),
        phone: str(fd, 'phone'),
        timezone: str(fd, 'timezone'),
      },
      await requestMeta(),
    );
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath('/app', 'layout');
  return { ok: true, message: 'Profile saved.' };
}

export async function createWorkspaceAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  let id: string;
  try {
    ({ id } = await createWorkspace(
      db(),
      { userId: user.id },
      { name: str(fd, 'name') },
      await requestMeta(),
    ));
  } catch (err) {
    return toActionError(err);
  }
  (await cookies()).set(WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  redirect('/app');
}
