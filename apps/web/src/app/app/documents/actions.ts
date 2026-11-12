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
  isFeatureEnabled,
  sendForSignature,
  cancelRequest,
  finalizeRequest,
  verifyRequestIntegrity,
  getDocument,
  type ReadinessIssue,
} from '@st/core';
import { env } from '@/lib/env';
import { storage } from '@/lib/storage';
import { sendInvitations } from '@/lib/signing-mail';
import { db } from '@/lib/db';
import { requireUser, requireWorkspace, requestMeta } from '@/lib/session';
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

export async function sendTestAction(
  documentId: string,
): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  const actor = { userId: user.id };
  try {
    const testSigningEnabled = await isFeatureEnabled(db(), 'test_signing', env().APP_ENV);
    const { invitations } = await sendForSignature(
      db(),
      storage(),
      actor,
      documentId,
      { mode: 'test', testSigningEnabled },
      await requestMeta(),
    );
    const d = await getDocument(db(), actor, documentId);
    const { workspaces } = await requireWorkspace();
    const ws = workspaces.find((w) => w.id === d.document.workspaceId);
    await sendInvitations(invitations, {
      title: d.document.title,
      senderName: user.name,
      workspaceName: ws?.name ?? '',
      message: d.document.emailMessage,
      isTest: true,
    });
  } catch (err) {
    const r = toActionError(err);
    return { ok: false, message: r?.message ?? 'Something went wrong.' };
  }
  revalidatePath('/app/documents');
  redirect(`/app/documents/${documentId}`);
}

export async function cancelRequestAction(
  documentId: string,
  requestId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const meta = await requestMeta();
  return run(
    documentId,
    (actor) => cancelRequest(db(), actor, requestId, String(fd.get('reason') ?? ''), meta),
    'Request cancelled. The signing links no longer work.',
  );
}

export async function retryFinalizeAction(
  documentId: string,
  requestId: string,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    const res = await finalizeRequest(db(), storage(), { actor: { userId: user.id } }, requestId);
    await sendInvitations(res.invitations, {
      title: res.title,
      senderName: user.name,
      workspaceName: '',
      message: null,
      isTest: res.isTest,
    });
  } catch (err) {
    const r = toActionError(err);
    return { ok: false, message: r?.message ?? 'Finalizing failed again. Contact support.' };
  }
  revalidatePath(`/app/documents/${documentId}`);
  return { ok: true, message: 'Finalized.' };
}

export type IntegrityReport = Awaited<ReturnType<typeof verifyRequestIntegrity>>;
export async function verifyIntegrityAction(
  requestId: string,
): Promise<{ ok: boolean; report?: IntegrityReport; message?: string }> {
  const user = await requireUser();
  try {
    return {
      ok: true,
      report: await verifyRequestIntegrity(db(), storage(), { userId: user.id }, requestId),
    };
  } catch (err) {
    const r = toActionError(err);
    return { ok: false, message: r?.message ?? 'Could not run the check.' };
  }
}
