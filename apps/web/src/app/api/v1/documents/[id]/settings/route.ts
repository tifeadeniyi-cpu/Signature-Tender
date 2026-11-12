import { z } from 'zod';
import { assertDocumentInWorkspace, getDocument, saveSettings } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';
import { documentOut } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

const body = z.object({
  settings: z
    .object({
      signing_method: z.enum(['electronic_signature', 'initials_only', 'acknowledge']).optional(),
      allow_download: z.boolean().optional(),
      allow_print: z.boolean().optional(),
      require_signer_auth: z.boolean().optional(),
      reminder_enabled: z.boolean().optional(),
      reminder_every_days: z.number().int().optional(),
      expires_at: z.string().nullable().optional(),
      show_signing_date: z.boolean().optional(),
    })
    .default({}),
  email_message: z.string().max(2000).optional(),
});

export const PUT = apiRoute<{ id: string }>(
  { scope: 'documents:write', body: 'json' },
  async ({ principal, params, json, meta }) => {
    await assertDocumentInWorkspace(db(), principal, params.id);
    const { settings: s, email_message } = body.parse(json());
    const current = (await getDocument(db(), principal.actor, params.id)).document.settings;
    await saveSettings(
      db(),
      principal.actor,
      params.id,
      {
        settings: {
          ...current,
          ...(s.signing_method !== undefined && { signingMethod: s.signing_method }),
          ...(s.allow_download !== undefined && { allowDownload: s.allow_download }),
          ...(s.allow_print !== undefined && { allowPrint: s.allow_print }),
          ...(s.require_signer_auth !== undefined && { requireSignerAuth: s.require_signer_auth }),
          ...(s.reminder_enabled !== undefined && { reminderEnabled: s.reminder_enabled }),
          ...(s.reminder_every_days !== undefined && { reminderEveryDays: s.reminder_every_days }),
          ...(s.expires_at !== undefined && { expiresAt: s.expires_at }),
          ...(s.show_signing_date !== undefined && { showSigningDate: s.show_signing_date }),
        },
        emailMessage: email_message,
      },
      meta,
    );
    return { status: 200, body: documentOut(await getDocument(db(), principal.actor, params.id)) };
  },
);
