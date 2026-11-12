import { z } from 'zod';
import { assertRequestInWorkspace, createEmbeddedSigningSession, getConfigValue } from '@st/core';
import { db } from '@/lib/db';
import { signUrl } from '@/lib/signing-mail';
import { apiRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';

const body = z.object({ recipient_id: z.string().uuid('recipient_id must be a recipient id') });

/**
 * A short-lived signing link for one recipient, to open from your app (redirect or new window;
 * framing is blocked). It replaces the recipient's emailed link. Never send it to anyone else.
 */
export const POST = apiRoute<{ id: string }>(
  { scope: 'embedded:sign', body: 'json' },
  async ({ principal, params, json, meta }) => {
    await assertRequestInWorkspace(db(), principal, params.id);
    const { recipient_id } = body.parse(json());
    const ttl = await getConfigValue(db(), 'api.embedded_session_minutes', 15);
    const s = await createEmbeddedSigningSession(
      db(),
      principal.actor,
      params.id,
      recipient_id,
      { ttlMinutes: ttl },
      meta,
    );
    return { status: 201, body: { url: signUrl(s.token), expires_at: s.expiresAt } };
  },
);
