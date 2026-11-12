import 'server-only';
import type { Invitation } from '@st/core';
import { brandedEmail, sendEmail } from './email';
import { env } from './env';

export interface RequestContext {
  title: string;
  senderName: string;
  workspaceName: string;
  message: string | null;
  isTest: boolean;
}

const prefix = (c: RequestContext) => (c.isTest ? '[TEST] ' : '');
export const signUrl = (token: string) => `${env().BETTER_AUTH_URL}/sign/${token}`;

/** Emails each recipient their personal link. Each link is the only copy of its token. */
export async function sendInvitations(invitations: Invitation[], c: RequestContext) {
  for (const inv of invitations) {
    const from = c.workspaceName ? `${c.senderName} (${c.workspaceName})` : c.senderName;
    const isCopy = inv.kind === 'completed_copy';
    const { text, html } = brandedEmail({
      heading: isCopy ? `"${c.title}" is complete` : `${from} sent you a document to sign`,
      body: isCopy
        ? `Everyone has finished signing "${c.title}". Use your personal link to view the status and, if the sender allows it, download the signed copy.`
        : `Please review and sign "${c.title}".${c.message ? `\n\nMessage from ${c.senderName}: ${c.message}` : ''}`,
      actionLabel: isCopy ? 'View completed document' : 'Review and sign',
      actionUrl: signUrl(inv.token),
      footer: `${c.isTest ? 'This is a TEST request from a non-production environment. ' : ''}This link is personal to ${inv.email}. Do not forward it.`,
    });
    await sendEmail({
      to: inv.email,
      subject: `${prefix(c)}${isCopy ? `Completed: ${c.title}` : `Please sign: ${c.title}`}`,
      text,
      html,
    });
  }
}

export async function sendSigningCode(to: string, name: string, code: string, c: RequestContext) {
  const { text, html } = brandedEmail({
    heading: 'Your signing code',
    body: `Hi ${name}, your code to open "${c.title}" is ${code}. It expires in 10 minutes and works once. If you did not request it, you can ignore this email.`,
    actionLabel: 'Return to the document',
    actionUrl: env().BETTER_AUTH_URL,
  });
  await sendEmail({ to, subject: `${prefix(c)}Your signing code: ${code}`, text, html });
}

export async function sendSenderNotice(
  to: string,
  kind: 'declined' | 'completed',
  c: RequestContext & { documentId: string; recipientName?: string; reason?: string },
) {
  const url = `${env().BETTER_AUTH_URL}/app/documents/${c.documentId}`;
  const { text, html } = brandedEmail({
    heading:
      kind === 'completed' ? `"${c.title}" is complete` : `${c.recipientName} declined to sign`,
    body:
      kind === 'completed'
        ? 'Everyone has finished. The signed copy and completion certificate are ready in your workspace.'
        : `${c.recipientName} declined to sign "${c.title}".${c.reason ? ` Reason given: ${c.reason}` : ''}`,
    actionLabel: 'Open document',
    actionUrl: url,
  });
  await sendEmail({
    to,
    subject: `${prefix(c)}${kind === 'completed' ? 'Completed' : 'Declined'}: ${c.title}`,
    text,
    html,
  });
}
