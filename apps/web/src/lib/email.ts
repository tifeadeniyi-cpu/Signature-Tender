import 'server-only';
import { Resend } from 'resend';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TransientEmailError } from '@st/core';
import { env } from './env';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Inline images referenced from the HTML as cid:<contentId>. */
  attachments?: { filename: string; content: Buffer; contentType: string; contentId: string }[];
  tags?: { name: string; value: string }[];
}

/** Provider errors worth retrying: rate limits, timeouts and provider-side failures. */
function isTransient(error: { name?: string; statusCode?: number | null }) {
  const code = error.statusCode ?? 0;
  return (
    code === 429 ||
    code >= 500 ||
    [
      'rate_limit_exceeded',
      'application_error',
      'internal_server_error',
      'concurrent_idempotent_requests',
    ].includes(error.name ?? '')
  );
}

/**
 * Sends transactional email via Resend and returns the provider's message id. Without an API key
 * (development and tests), the message is written to DEV_MAIL_DIR as JSON instead, and never
 * reported as delivered to a real inbox. Throws TransientEmailError for errors worth retrying.
 */
export async function sendEmail(
  msg: OutgoingEmail,
  opts: { idempotencyKey?: string } = {},
): Promise<{ id: string | null }> {
  const { RESEND_API_KEY, EMAIL_FROM, APP_ENV, DEV_MAIL_DIR } = env();
  if (RESEND_API_KEY) {
    const resend = new Resend(RESEND_API_KEY);
    let result: Awaited<ReturnType<typeof resend.emails.send>>;
    try {
      result = await resend.emails.send(
        {
          from: EMAIL_FROM,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
          ...(msg.tags?.length ? { tags: msg.tags } : {}),
        },
        opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
      );
    } catch (err) {
      // Network failures and timeouts: safe to retry because of the idempotency key.
      throw new TransientEmailError(`Email provider unreachable: ${(err as Error).message}`);
    }
    if (result.error) {
      const e = result.error as { name?: string; message: string; statusCode?: number | null };
      if (isTransient(e)) throw new TransientEmailError(`Email send failed: ${e.message}`);
      throw new Error(`Email send failed: ${e.message}`);
    }
    return { id: result.data?.id ?? null };
  }
  if (APP_ENV === 'production') throw new Error('RESEND_API_KEY is required in production');
  const dir = DEV_MAIL_DIR ?? path.join(process.cwd(), '.mail');
  await fs.mkdir(dir, { recursive: true });
  const id = `dev-${Date.now()}-${crypto.randomUUID()}`;
  const file = path.join(dir, `${id}.json`);
  const { attachments, ...rest } = msg;
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        ...rest,
        attachments: (attachments ?? []).map((a) => a.contentId),
        sentAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.info(`[dev-mail] ${msg.subject} -> ${msg.to} (${file})`);
  return { id };
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
  /** Workspace branding: name and accent colour (already checked for contrast with white). */
  brand?: { name: string | null; color: string | null } | null;
}) {
  const { heading, body, actionLabel, actionUrl, footer } = opts;
  const accent =
    opts.brand?.color && /^#[0-9a-f]{6}$/i.test(opts.brand.color) ? opts.brand.color : '#0D1B33';
  const title = opts.brand?.name
    ? `${escapeHtml(opts.brand.name)}<span style="font-family:Inter,Arial,sans-serif;font-size:12px;opacity:.85"> via Signature Tender</span>`
    : 'Signature Tender';
  const text = `${heading}\n\n${body}\n\n${actionLabel}: ${actionUrl}\n\n${footer ?? ''}`.trim();
  const html = `<!doctype html><html><body style="margin:0;background:#FFF9F2;font-family:Inter,Arial,sans-serif;color:#1E293B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E7E1D6;border-radius:12px">
<tr><td style="background:${accent};color:#fff;padding:20px 28px;border-radius:12px 12px 0 0;font-family:Georgia,serif;font-size:22px">${title}</td></tr>
<tr><td style="padding:28px">
<h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 12px">${escapeHtml(heading)}</h1>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 24px">${escapeHtml(body)}</p>
<a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(actionLabel)}</a>
<p style="font-size:12px;color:#6B7280;margin:24px 0 0">If the button does not work, copy this link into your browser:<br>${escapeHtml(actionUrl)}</p>
${footer ? `<p style="font-size:12px;color:#6B7280;margin:16px 0 0">${escapeHtml(footer)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}
