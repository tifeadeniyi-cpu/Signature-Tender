'use server';
import { revalidatePath } from 'next/cache';
import { setArchived, restoreDeletedDraft, setLegalHold, setRetentionPolicy } from '@st/core';
import { db } from '@/lib/db';
import { requireUser, requireWorkspace, requestMeta } from '@/lib/session';
import { toActionError, type ActionState } from '@/lib/action-result';

export async function archiveAction(
  documentId: string,
  archived: boolean,
  _prev: ActionState,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    await setArchived(db(), { userId: user.id }, documentId, archived, await requestMeta());
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath('/app/documents', 'layout');
  return { ok: true, message: archived ? 'Moved to Archived.' : 'Moved out of Archived.' };
}

export async function restoreDraftAction(
  documentId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    await restoreDeletedDraft(db(), { userId: user.id }, documentId, await requestMeta());
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath('/app/documents', 'layout');
  return { ok: true, message: 'Draft restored. It is back in your documents.' };
}

export async function legalHoldAction(
  documentId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const hold = fd.get('hold') === 'on';
  try {
    await setLegalHold(
      db(),
      { userId: user.id },
      documentId,
      { hold, reason: String(fd.get('reason') ?? '') },
      await requestMeta(),
    );
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/app/documents/${documentId}`);
  return { ok: true, message: hold ? 'Legal hold placed.' : 'Legal hold lifted.' };
}

export async function retentionPolicyAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const { user, membership } = await requireWorkspace();
  const documentType = String(fd.get('documentType') ?? '') || null;
  const raw = String(fd.get('days') ?? '').trim();
  const remove = fd.get('intent') === 'remove';
  const days = remove ? null : Number(raw);
  if (!remove && (!raw || !Number.isFinite(days)))
    return {
      ok: false,
      message: 'Enter a number of days.',
      fieldErrors: { days: 'Enter a number of days.' },
    };
  try {
    await setRetentionPolicy(
      db(),
      { userId: user.id },
      membership.workspace.id,
      { documentType, days },
      await requestMeta(),
    );
  } catch (err) {
    const r = toActionError(err);
    return r?.fieldErrors?.form
      ? { ...r, message: r.fieldErrors.form, fieldErrors: { days: r.fieldErrors.form } }
      : r;
  }
  revalidatePath('/app/settings/retention');
  return { ok: true, message: remove ? 'Rule removed.' : 'Retention saved.' };
}
