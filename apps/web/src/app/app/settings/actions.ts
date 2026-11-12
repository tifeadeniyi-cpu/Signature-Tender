'use server';
import { revalidatePath } from 'next/cache';
import {
  updateWorkspace,
  updateProfile,
  createWorkspace,
  saveBranding,
  uploadLogo,
  removeLogo,
} from '@st/core';
import { storage } from '@/lib/storage';
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

export async function saveBrandingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, membership } = await requireWorkspace();
  try {
    await saveBranding(
      db(),
      { userId: user.id },
      membership.workspace.id,
      {
        brandName: str(fd, 'brandName'),
        brandColor: fd.get('useColor') === 'on' ? str(fd, 'brandColor') : '',
      },
      await requestMeta(),
    );
  } catch (err) {
    const r = toActionError(err);
    // The form has no inline field errors, so name the problem in the message.
    const first = r?.fieldErrors && Object.values(r.fieldErrors)[0];
    return first ? { ok: false, message: first } : r;
  }
  revalidatePath('/app/settings/branding');
  return { ok: true, message: 'Branding saved.' };
}

export async function logoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, membership } = await requireWorkspace();
  const actor = { userId: user.id };
  try {
    if (fd.get('intent') === 'remove') {
      await removeLogo(db(), actor, membership.workspace.id, await requestMeta());
      revalidatePath('/app/settings/branding');
      return { ok: true, message: 'Logo removed.' };
    }
    const file = fd.get('logo');
    if (!(file instanceof File) || file.size === 0)
      return { ok: false, message: 'Choose a PNG or JPEG image.' };
    if (file.size > 512 * 1024) return { ok: false, message: 'Use a logo under 512 KB.' };
    await uploadLogo(
      db(),
      storage(),
      actor,
      membership.workspace.id,
      new Uint8Array(await file.arrayBuffer()),
      await requestMeta(),
    );
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath('/app/settings/branding');
  return { ok: true, message: 'Logo uploaded.' };
}
