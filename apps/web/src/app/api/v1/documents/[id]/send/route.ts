import { assertDocumentInWorkspace, markReadyToSend } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute, ApiFailure } from '@/lib/public-api';
import { sendSchema, sendViaApi } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

/**
 * Sends the document for signature. mode "test" creates a free, clearly marked test request where
 * test signing is enabled. mode "live" spends a credit; with no credits the request waits for
 * payment (status "awaiting_payment").
 */
export const POST = apiRoute<{ id: string }>(
  { scope: 'requests:send', body: 'json', emits: true },
  async ({ principal, params, json, meta }) => {
    await assertDocumentInWorkspace(db(), principal, params.id);
    const input = sendSchema.parse(json());
    const issues = await markReadyToSend(db(), principal.actor, params.id, meta);
    if (issues.length)
      throw new ApiFailure(
        'invalid',
        `The document is not ready: ${issues.map((i) => i.message).join(' ')}`,
      );
    return { status: 201, body: await sendViaApi(principal, params.id, input, meta) };
  },
);
