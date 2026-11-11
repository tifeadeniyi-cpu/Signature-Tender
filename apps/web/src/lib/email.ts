import 'server-only';
import { Resend } from 'resend';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from './env';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends transactional email via Resend. Without an API key (development and tests), the message is
 * written to DEV_MAIL_DIR as JSON instead, and never reported as delivered to a real inbox.
 */
export async function sendEmail(msg: OutgoingEmail): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM, APP_ENV, DEV_MAIL_DIR } = env();
  if (RESEND_API_KEY) {
    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({ from: EMAIL_FROM, ...msg });
    if (error) throw new Error(`Email send failed: ${error.message}`);
    return;
  }
  if (APP_ENV === 'production') throw new Error('RESEND_API_KEY is required in production');
  const dir = DEV_MAIL_DIR ?? path.join(process.cwd(), '.mail');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${crypto.randomUUID()}.json`);
  await fs.writeFile(file, JSON.stringify({ ...msg, sentAt: new Date().toISOString() }, null, 2));
  console.info(`[dev-mail] ${msg.subject} -> ${msg.to} (${file})`);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Minimal branded email layout. Content is escaped; only the action URL is linked. */
export function brandedEmail(opts: {
  heading: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
  footer?: string;
}) {
  const { heading, body, actionLabel, actionUrl, footer } = opts;
  const text = `${heading}\n\n${body}\n\n${actionLabel}: ${actionUrl}\n\n${footer ?? ''}`.trim();
  const html = `<!doctype html><html><body style="margin:0;background:#FFF9F7;font-family:Inter,Arial,sans-serif;color:#270F17">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E9DDE0;border-radius:12px">
<tr><td style="background:#5B0A1C;color:#fff;padding:20px 28px;border-radius:12px 12px 0 0;font-family:Georgia,serif;font-size:22px">Signature Tender</td></tr>
<tr><td style="padding:28px">
<h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 12px">${escapeHtml(heading)}</h1>
<p style="font-size:15px;line-height:1.6;color:#4B5563;margin:0 0 24px">${escapeHtml(body)}</p>
<a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#5B0A1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(actionLabel)}</a>
<p style="font-size:12px;color:#6B7280;margin:24px 0 0">If the button does not work, copy this link into your browser:<br>${escapeHtml(actionUrl)}</p>
${footer ? `<p style="font-size:12px;color:#6B7280;margin:16px 0 0">${escapeHtml(footer)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}
