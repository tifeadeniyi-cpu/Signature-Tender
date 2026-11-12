'use server';
import { revalidatePath } from 'next/cache';
import { remindRecipients } from '@st/core';
import { db } from '@/lib/db';
import { sendInvitations } from '@/lib/signing-mail';
import { kickWebhooks } from '@/lib/webhooks';
import { requireUser, requestMeta } from '@/lib/session';
import { toActionError, type ActionState } from '@/lib/action-result';

/**
 * Emails a reminder with a fresh link to everyone whose turn it is. The core service checks
 * the sender's permission, that the request is still open, and allows one reminder an hour.
 */
export async function remindAction(documentId: string, requestId: string): Promise<ActionState> {
  const user = await requireUser();
  kickWebhooks();
  try {
    const r = await remindRecipients(db(), { userId: user.id }, requestId, await requestMeta());
    await sendInvitations(r.invitations, {
      title: r.title,
      senderName: r.senderName,
      workspaceName: r.workspaceName,
      message: r.emailMessage,
      isTest: r.isTest,
      workspaceId: r.workspaceId,
    });
    revalidatePath(`/app/documents/${documentId}`);
    const n = r.invitations.length;
    return {
      ok: true,
      message: `Reminder sent to ${n === 1 ? r.invitations[0]!.name : `${n} recipients`}.`,
    };
  } catch (err) {
    return toActionError(err);
  }
}
