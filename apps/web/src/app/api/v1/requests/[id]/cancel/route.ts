import { z } from 'zod';
import { assertRequestInWorkspace, cancelRequest, getRequestStatus } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';

const body = z.object({ reason: z.string().trim().max(500).default('') });

export const POST = apiRoute<{ id: string }>(
  { scope: 'requests:send', body: 'json', emits: true },
  async ({ principal, params, json, meta }) => {
    await assertRequestInWorkspace(db(), principal, params.id);
    const { reason } = body.parse(json());
    await cancelRequest(
      db(),
      principal.actor,
      params.id,
      reason || 'Cancelled through the API',
      meta,
    );
    return { status: 200, body: await getRequestStatus(db(), principal.actor, params.id) };
  },
);
