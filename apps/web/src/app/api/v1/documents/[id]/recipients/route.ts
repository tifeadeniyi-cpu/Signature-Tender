import { z } from 'zod';
import { assertDocumentInWorkspace, getConfigValue, getDocument, saveRecipients } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';
import { documentOut } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

const body = z.object({
  signing_order: z.boolean().default(false),
  recipients: z
    .array(
      z.object({
        name: z.string(),
        email: z.string(),
        role: z.enum(['signer', 'reviewer', 'approver', 'cc', 'viewer']).default('signer'),
        signing_order: z.number().int().default(1),
        auth_method: z.enum(['email_link', 'email_code']).default('email_link'),
      }),
    )
    .max(50),
});

/** Replaces the recipient list. Fields of removed recipients are removed with them. */
export const PUT = apiRoute<{ id: string }>(
  { scope: 'documents:write', body: 'json' },
  async ({ principal, params, json, meta }) => {
    await assertDocumentInWorkspace(db(), principal, params.id);
    const input = body.parse(json());
    const before = await getDocument(db(), principal.actor, params.id);
    const maxSigners = await getConfigValue(db(), 'limits.max_signers_per_request', 5);
    await saveRecipients(
      db(),
      principal.actor,
      params.id,
      {
        signingOrderEnabled: input.signing_order,
        recipients: input.recipients.map((r) => ({
          // Keep ids for unchanged emails so placed fields survive.
          id: before.recipients.find((b) => b.email.toLowerCase() === r.email.trim().toLowerCase())
            ?.id,
          name: r.name,
          email: r.email,
          role: r.role,
          signingOrder: r.signing_order,
          authMethod: r.auth_method,
        })),
      },
      { maxSigners },
      meta,
    );
    return { status: 200, body: documentOut(await getDocument(db(), principal.actor, params.id)) };
  },
);
