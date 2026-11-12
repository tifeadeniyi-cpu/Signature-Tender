import { assertRequestInWorkspace, remindRecipients } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';
import { sendInvitations } from '@/lib/signing-mail';

export const dynamic = 'force-dynamic';

/** Emails a reminder with a fresh link to everyone whose turn it is. At most once an hour. */
export const POST = apiRoute<{ id: string }>(
  { scope: 'requests:send' },
  async ({ principal, params, meta }) => {
    await assertRequestInWorkspace(db(), principal, params.id);
    const r = await remindRecipients(db(), principal.actor, params.id, meta);
    await sendInvitations(r.invitations, {
      title: r.title,
      senderName: r.senderName,
      workspaceName: r.workspaceName,
      message: r.emailMessage,
      isTest: r.isTest,
      workspaceId: r.workspaceId,
    });
    return {
      status: 200,
      body: {
        reminded: r.invitations.map((i) => ({ recipient_id: i.recipientId, email: i.email })),
      },
    };
  },
);
