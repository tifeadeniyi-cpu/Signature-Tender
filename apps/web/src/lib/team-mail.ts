import 'server-only';
import type { InvitationMail } from '@st/core';
import { brandedEmail, sendEmail } from './email';
import { env } from './env';

export const inviteUrl = (token: string) => `${env().BETTER_AUTH_URL}/invite/${token}`;

const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

/** Emails a workspace invitation. The link holds the only copy of the token. */
export async function sendTeamInvitation(m: InvitationMail) {
  const { text, html } = brandedEmail({
    heading: `Join ${m.workspaceName} on Signature Tender`,
    body: `${m.inviterName} invited you to join ${m.workspaceName} as ${m.roleName}. Accept with the email address this message was sent to. The invitation expires on ${fmt.format(m.expiresAt)}.`,
    actionLabel: 'Accept invitation',
    actionUrl: inviteUrl(m.token),
    footer: `If you were not expecting this, you can ignore it. Nothing happens unless you accept.`,
  });
  await sendEmail({ to: m.email, subject: `You're invited to ${m.workspaceName}`, text, html });
}
