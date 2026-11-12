import 'server-only';
import { getBrand, type Invitation } from '@st/core';
import { sendEmail } from './email';
import { db } from './db';
import { env } from './env';
import { emailConfig } from './email/config';
import {
  renderCodeEmail,
  renderCompletedCopy,
  renderDeclinedNotice,
  renderSigningRequest,
} from './email/templates/transactional';
import type { RenderedEmail } from './email/templates/document-completed';

export interface RequestContext {
  title: string;
  senderName: string;
  workspaceName: string;
  message: string | null;
  isTest: boolean;
  /** When set, recipient-facing emails use the workspace's brand name. */
  workspaceId?: string;
  /** A reminder rather than the first invitation. */
  reminder?: boolean;
}

async function brandName(c: RequestContext) {
  if (!c.workspaceId) return null;
  const b = await getBrand(db(), c.workspaceId).catch(() => null);
  return b?.brandName || null;
}

export const signUrl = (token: string) => `${env().BETTER_AUTH_URL}/sign/${token}`;
const retrieveUrl = () => `${env().BETTER_AUTH_URL}/retrieve`;

const send = (to: string, r: RenderedEmail, tag: string) =>
  sendEmail({
    to,
    subject: r.subject,
    text: r.text,
    html: r.html,
    attachments: r.attachments,
    tags: [{ name: 'template', value: tag }],
  });

/** Emails each recipient their personal link. Each link is the only copy of its token. */
export async function sendInvitations(invitations: Invitation[], c: RequestContext) {
  if (!invitations.length) return;
  const [config, brand] = await Promise.all([emailConfig(), brandName(c)]);
  for (const inv of invitations) {
    const common = {
      config,
      recipientName: inv.name,
      recipientEmail: inv.email,
      title: c.title,
      url: signUrl(inv.token),
      retrieveUrl: retrieveUrl(),
      isTest: c.isTest,
    };
    const r =
      inv.kind === 'completed_copy'
        ? renderCompletedCopy(common)
        : renderSigningRequest({
            ...common,
            senderName: c.senderName,
            workspaceName: brand ?? c.workspaceName,
            message: c.message,
            reminder: c.reminder,
          });
    await send(
      inv.email,
      r,
      inv.kind === 'completed_copy' ? 'completed_copy' : c.reminder ? 'reminder' : 'invitation',
    );
  }
}

export async function sendSigningCode(to: string, name: string, code: string, c: RequestContext) {
  const r = renderCodeEmail({
    config: await emailConfig(),
    purpose: 'signing',
    code,
    name,
    title: c.title,
    isTest: c.isTest,
  });
  await send(to, r, 'signing_code');
}

export async function sendSenderNotice(
  to: string,
  _kind: 'declined',
  c: RequestContext & { documentId: string; recipientName?: string; reason?: string },
) {
  const r = renderDeclinedNotice({
    config: await emailConfig(),
    title: c.title,
    recipientName: c.recipientName ?? '',
    reason: c.reason ?? null,
    url: `${env().BETTER_AUTH_URL}/app/documents/${c.documentId}`,
    isTest: c.isTest,
  });
  await send(to, r, 'declined');
}

export async function sendRetrievalCode(to: string, code: string) {
  const r = renderCodeEmail({
    config: await emailConfig(),
    purpose: 'retrieval',
    code,
    returnUrl: retrieveUrl(),
  });
  await send(to, r, 'retrieval_code');
}
