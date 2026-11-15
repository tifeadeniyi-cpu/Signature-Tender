'use server';
import { kickWebhooks } from '@/lib/webhooks';
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
  sendPaidRequest,
  cancelRequest,
  finalizeRequest,
  verifyRequestIntegrity,
  getDocument,
  type ReadinessIssue,
} from '@st/core';
import { env } from '@/lib/env';
import { storage } from '@/lib/storage';
import { sendInvitations } from '@/lib/signing-mail';
import { dispatchAfterResponse } from '@/lib/notifications';
import { db } from '@/lib/db';
import { liveSendingEnabled } from '@/lib/billing';
import { requireUser, requireWorkspace, requestMeta } from '@/lib/session';
import { toActionError, type ActionState } from '@/lib/action-result';
import { startRequestCheckout } from '@/app/app/billing/actions';

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
  acknowledged = false,
): Promise<{ ok: boolean; message?: string }> {
  kickWebhooks();
  const user = await requireUser();
  const actor = { userId: user.id };
  let signNow = false;
  try {
    const testSigningEnabled = await isFeatureEnabled(db(), 'test_signing', env().APP_ENV);
    const { invitations, selfSign } = await sendForSignature(
      db(),
      storage(),
      actor,
      documentId,
      {
        mode: 'test',
        testSigningEnabled,
        specializedAck: acknowledged ? { source: 'sender' } : undefined,
      },
      await requestMeta(),
    );
    if (selfSign) signNow = true;
    const d = await getDocument(db(), actor, documentId);
    const { workspaces } = await requireWorkspace();
    const ws = workspaces.find((w) => w.id === d.document.workspaceId);
    if (!selfSign)
      await sendInvitations(invitations, {
        title: d.document.title,
        senderName: user.name,
        workspaceName: ws?.name ?? '',
        message: d.document.emailMessage,
        isTest: true,
        workspaceId: d.document.workspaceId,
      });
  } catch (err) {
    const r = toActionError(err);
    return { ok: false, message: r?.message ?? 'Something went wrong.' };
  }
  revalidatePath('/app/documents');
  redirect(signNow ? `/app/documents/${documentId}/sign-now` : `/app/documents/${documentId}`);
}

/** Sends for real. Spends a credit if there is one; otherwise the request waits for payment. */
export async function sendLiveAction(
  documentId: string,
  acknowledged = false,
): Promise<{ ok: boolean; message?: string }> {
  kickWebhooks();
  const user = await requireUser();
  const actor = { userId: user.id };
  let signNow = false;
  let checkoutFor: string | null = null;
  try {
    const res = await sendForSignature(
      db(),
      storage(),
      actor,
      documentId,
      {
        mode: 'live',
        testSigningEnabled: false,
        liveSendingEnabled: await liveSendingEnabled(),
        specializedAck: acknowledged ? { source: 'sender' } : undefined,
      },
      await requestMeta(),
    );
    if (res.selfSign) {
      // Sign it yourself: go straight to signing, or to the $0.99 checkout first.
      if (res.status === 'sent') signNow = true;
      else checkoutFor = res.requestId;
    } else if (res.status === 'sent') {
      const d = await getDocument(db(), actor, documentId);
      const { workspaces } = await requireWorkspace();
      const ws = workspaces.find((w) => w.id === d.document.workspaceId);
      await sendInvitations(res.invitations, {
        title: d.document.title,
        senderName: user.name,
        workspaceName: ws?.name ?? '',
        message: d.document.emailMessage,
        isTest: false,
        workspaceId: d.document.workspaceId,
      });
    }
  } catch (err) {
    const r = toActionError(err);
    return { ok: false, message: r?.message ?? 'Something went wrong.' };
  }
  // Outside the try: opening checkout ends in a redirect to Stripe.
  if (checkoutFor) {
    const r = await startRequestCheckout(checkoutFor);
    return { ok: false, message: r?.message ?? 'We could not open checkout.' };
  }
  revalidatePath('/app/documents');
  redirect(signNow ? `/app/documents/${documentId}/sign-now` : `/app/documents/${documentId}`);
}

/** Sends a request that is waiting for payment, using a credit the workspace already has. */
export async function sendWithCreditAction(
  documentId: string,
  requestId: string,
  _prev: ActionState,
): Promise<ActionState> {
  kickWebhooks();
  const user = await requireUser();
  try {
    const sent = await sendPaidRequest(
      db(),
      { userId: user.id },
      requestId,
      { liveSendingEnabled: await liveSendingEnabled() },
      await requestMeta(),
    );
    await sendInvitations(sent.invitations, {
      title: sent.title,
      senderName: sent.senderName,
      workspaceName: sent.workspaceName,
      message: sent.emailMessage,
      isTest: false,
      workspaceId: sent.workspaceId,
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/app/documents/${documentId}`);
  return { ok: true, message: 'Sent. Recipients have been emailed their links.' };
}

export async function cancelRequestAction(
  documentId: string,
  requestId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  kickWebhooks();
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
  kickWebhooks();
  const user = await requireUser();
  try {
    await finalizeRequest(db(), storage(), { actor: { userId: user.id } }, requestId, {
      appUrl: env().BETTER_AUTH_URL,
    });
    dispatchAfterResponse(requestId);
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
