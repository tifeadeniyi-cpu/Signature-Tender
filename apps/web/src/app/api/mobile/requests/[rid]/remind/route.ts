import { remindRecipients } from '@st/core';
import { apiError } from '@/lib/api';
import { db } from '@/lib/db';
import { json, readJson, requireApiUser } from '@/lib/mobile-api';
import { requestMeta } from '@/lib/session';
import { sendInvitations } from '@/lib/signing-mail';
import { kickWebhooks } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

/**
 * "Send reminder" from the mobile app: the same service as the website's drawer, which checks
 * the sender's permission, that the request is open, and the one-an-hour limit.
 */
export async function POST(req: Request, { params }: { params: Promise<{ rid: string }> }) {
  try {
    const user = await requireApiUser();
    await readJson(req);
    const { rid } = await params;
    kickWebhooks();
    const r = await remindRecipients(db(), { userId: user.id }, rid, await requestMeta());
    await sendInvitations(r.invitations, {
      title: r.title,
      senderName: r.senderName,
      workspaceName: r.workspaceName,
      message: r.emailMessage,
      isTest: r.isTest,
      workspaceId: r.workspaceId,
      reminder: true,
    });
    const n = r.invitations.length;
    return json({
      ok: true,
      message: `Reminder sent to ${n === 1 ? r.invitations[0]!.name : `${n} recipients`}.`,
    });
  } catch (err) {
    return apiError(err);
  }
}
