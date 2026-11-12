import 'server-only';
import { after } from 'next/server';
import {
  COMPLETED_TEMPLATE,
  dispatchDueNotifications,
  type ClaimedNotification,
  type CompletedPayload,
  type DispatchResult,
  type NotificationTransport,
  type OutgoingNotificationEmail,
} from '@st/core';
import { db } from './db';
import { sendEmail } from './email';
import { emailConfig, emailLinkSecret, type EmailConfig } from './email/config';
import { renderDocumentCompleted } from './email/templates/document-completed';

export type LinkTarget = 'download' | 'view' | 'evidence';
export const LINK_TARGETS: LinkTarget[] = ['download', 'view', 'evidence'];

/** Links in a completion email. Recipients go through the verified link page; senders sign in. */
export function completionLinks(
  appUrl: string,
  n: ClaimedNotification,
  p: CompletedPayload,
): Record<LinkTarget, string | null> {
  if (n.row.audience === 'sender') {
    const doc = `${appUrl}/app/documents/${p.documentId}`;
    return {
      download: `${appUrl}/api/documents/${p.documentId}/versions/${p.signedFileId}`,
      view: doc,
      evidence: p.certificateFileId ? `${doc}?tab=versions` : null,
    };
  }
  if (!n.linkToken) return { download: null, view: null, evidence: null };
  const base = `${appUrl}/retrieve/link/${n.linkToken}`;
  return {
    download: `${base}?to=download`,
    view: `${base}?to=view`,
    evidence: p.certificateFileId ? `${base}?to=evidence` : null,
  };
}

export function renderNotification(
  n: ClaimedNotification,
  cfg: EmailConfig,
): OutgoingNotificationEmail {
  if (n.row.template !== COMPLETED_TEMPLATE)
    throw new Error(`No renderer for notification template ${n.row.template}`);
  const p = n.row.payload as unknown as CompletedPayload;
  if (!p.certificateFileId)
    console.error(
      `[ops-alert] Completion email ${n.row.id} for request ${p.requestId} has no evidence certificate; the certificate button is left out.`,
    );
  const r = renderDocumentCompleted({
    payload: p,
    audience: n.row.audience as 'sender' | 'recipient',
    links: completionLinks(cfg.appUrl, n, p),
    linkExpiresAt: n.linkExpiresAt,
    config: cfg,
  });
  return {
    to: n.row.toEmail,
    subject: r.subject,
    text: r.text,
    html: r.html,
    attachments: r.attachments,
    tags: [
      { name: 'template', value: COMPLETED_TEMPLATE },
      { name: 'notification', value: n.row.id },
    ],
  };
}

const transport: NotificationTransport = {
  async send(msg, opts) {
    const { id } = await sendEmail(msg, { idempotencyKey: opts.idempotencyKey });
    return { providerMessageId: id };
  },
};

/** Sends due notifications now. Failures are retried later; permanent ones raise an ops alert. */
export async function dispatchNotifications(
  opts: { requestId?: string; limit?: number } = {},
): Promise<DispatchResult[]> {
  const cfg = await emailConfig();
  const results = await dispatchDueNotifications(
    db(),
    { transport, render: (n) => renderNotification(n, cfg), linkSecret: emailLinkSecret() },
    opts,
  );
  for (const r of results) {
    if (r.status === 'failed')
      console.error(`[ops-alert] Notification ${r.id} failed permanently: ${r.error}`);
    else if (r.status === 'retrying')
      console.warn(`Notification ${r.id} will be retried: ${r.error}`);
  }
  return results;
}

/**
 * Sends a request's queued notifications after the response is returned, so signing never waits
 * on the email provider. Anything that fails is retried with backoff by the scheduled sweep
 * (/api/cron/notifications) and whenever the sender opens the document.
 */
export function dispatchAfterResponse(requestId?: string) {
  after(async () => {
    try {
      await dispatchNotifications({ requestId });
    } catch (err) {
      console.error('[ops-alert] Notification dispatch crashed', err);
    }
  });
}
