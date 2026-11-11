'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  updateDocumentDetails,
  saveRecipients,
  saveFields,
  saveSettings,
  markReadyToSend,
  deleteDraft,
  getConfigValue,
  type ReadinessIssue,
} from '@st/core';
import { db } from '@/lib/db';
import { requireUser, requestMeta } from '@/lib/session';
import { toActionError, type ActionState } from '@/lib/action-result';

type Recipients = Parameters<typeof saveRecipients>[3];
type Fields = Parameters<typeof saveFields>[3];
type Settings = Parameters<typeof saveSettings>[3];

async function run(
  documentId: string,
  fn: (actor: { userId: string }) => Promise<unknown>,
  okMessage: string,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    await fn({ userId: user.id });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/app/documents/${documentId}`, 'layout');
  revalidatePath('/app/documents');
  return { ok: true, message: okMessage };
}

export async function saveDetailsAction(
  documentId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const meta = await requestMeta();
  return run(
    documentId,
    (actor) =>
      updateDocumentDetails(
        db(),
        actor,
        documentId,
        {
          title: String(fd.get('title') ?? ''),
          documentType: String(fd.get('documentType') ?? ''),
        },
        meta,
      ),
    'Document details saved.',
  );
}

export async function saveRecipientsAction(
  documentId: string,
  input: Recipients,
): Promise<ActionState> {
  const meta = await requestMeta();
  const maxSigners = await getConfigValue(db(), 'limits.max_signers_per_request', 5);
  return run(
    documentId,
    (actor) => saveRecipients(db(), actor, documentId, input, { maxSigners }, meta),
    'Recipients saved.',
  );
}

export async function saveFieldsAction(documentId: string, input: Fields): Promise<ActionState> {
  const meta = await requestMeta();
  return run(
    documentId,
    (actor) => saveFields(db(), actor, documentId, input, meta),
    'Fields saved.',
  );
}

export async function saveSettingsAction(
  documentId: string,
  input: Settings,
): Promise<ActionState> {
  const meta = await requestMeta();
  return run(
    documentId,
    (actor) => saveSettings(db(), actor, documentId, input, meta),
    'Settings saved.',
  );
}

export async function markReadyAction(
  documentId: string,
): Promise<{ ok: boolean; message?: string; issues?: ReadinessIssue[] }> {
  const user = await requireUser();
  try {
    const issues = await markReadyToSend(
      db(),
      { userId: user.id },
      documentId,
      await requestMeta(),
    );
    revalidatePath(`/app/documents/${documentId}`, 'layout');
    revalidatePath('/app/documents');
    return issues.length
      ? { ok: false, message: 'A few things need attention first.', issues }
      : { ok: true, message: 'Marked ready to send.' };
  } catch (err) {
    const r = toActionError(err);
    return { ok: false, message: r?.message ?? 'Something went wrong.' };
  }
}

export async function deleteDraftAction(documentId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    await deleteDraft(db(), { userId: user.id }, documentId, await requestMeta());
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath('/app/documents');
  redirect('/app/documents');
}
