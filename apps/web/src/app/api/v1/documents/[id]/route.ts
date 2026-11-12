import { assertDocumentInWorkspace, getDocument, getRequestsForDocument } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';
import { documentOut } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

export const GET = apiRoute<{ id: string }>(
  { scope: 'documents:read' },
  async ({ principal, params }) => {
    await assertDocumentInWorkspace(db(), principal, params.id);
    const [d, reqs] = await Promise.all([
      getDocument(db(), principal.actor, params.id),
      getRequestsForDocument(db(), principal.actor, params.id),
    ]);
    return { status: 200, body: documentOut(d, reqs) };
  },
);
