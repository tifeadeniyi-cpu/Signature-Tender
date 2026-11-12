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
