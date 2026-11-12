import { assertRequestInWorkspace, getRequestStatus } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';

export const GET = apiRoute<{ id: string }>(
  { scope: 'documents:read' },
  async ({ principal, params }) => {
    await assertRequestInWorkspace(db(), principal, params.id);
    return { status: 200, body: await getRequestStatus(db(), principal.actor, params.id) };
  },
);
