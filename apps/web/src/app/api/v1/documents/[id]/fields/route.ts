import { z } from 'zod';
import { assertDocumentInWorkspace, getDocument, saveFields } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';
import { documentOut } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

const body = z.object({
  fields: z
    .array(
      z.object({
        recipient_id: z.string(),
        type: z.string(),
        page: z.number(),
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
        required: z.boolean().optional(),
        label: z.string().nullable().optional(),
        options: z.array(z.string()).nullable().optional(),
      }),
    )
    .max(500),
});

/** Replaces all fields. Coordinates are fractions of the page (0 to 1) from the top left. */
export const PUT = apiRoute<{ id: string }>(
  { scope: 'documents:write', body: 'json' },
  async ({ principal, params, json, meta }) => {
    await assertDocumentInWorkspace(db(), principal, params.id);
    const input = body.parse(json());
    await saveFields(
      db(),
      principal.actor,
      params.id,
      input.fields.map((f) => ({
        recipientId: f.recipient_id,
        type: f.type as never,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        required: f.required,
        label: f.label,
        options: f.options,
      })),
      meta,
    );
    return { status: 200, body: documentOut(await getDocument(db(), principal.actor, params.id)) };
  },
);
