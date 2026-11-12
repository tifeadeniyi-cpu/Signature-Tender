import { assertRequestInWorkspace, listRequestEvents } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';

/** The request's evidence log, in order. Each event carries its hash in the tamper-evident chain. */
export const GET = apiRoute<{ id: string }>(
  { scope: 'documents:read' },
  async ({ principal, params }) => {
    await assertRequestInWorkspace(db(), principal, params.id);
    return {
      status: 200,
      body: { data: await listRequestEvents(db(), principal.actor, params.id) },
    };
  },
);
