import 'server-only';
import type { InvitationMail } from '@st/core';
import { sendEmail } from './email';
import { env } from './env';
import { emailConfig } from './email/config';
import { renderTeamInvitation } from './email/templates/transactional';

export const inviteUrl = (token: string) => `${env().BETTER_AUTH_URL}/invite/${token}`;

const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

/** Emails a workspace invitation. The link holds the only copy of the token. */
export async function sendTeamInvitation(m: InvitationMail) {
  const r = renderTeamInvitation({
    config: await emailConfig(),
    workspaceName: m.workspaceName,
    inviterName: m.inviterName,
    roleName: m.roleName,
    expiresOn: fmt.format(m.expiresAt),
    url: inviteUrl(m.token),
  });
  await sendEmail({
    to: m.email,
    subject: r.subject,
    text: r.text,
    html: r.html,
    attachments: r.attachments,
    tags: [{ name: 'template', value: 'team_invitation' }],
  });
}
