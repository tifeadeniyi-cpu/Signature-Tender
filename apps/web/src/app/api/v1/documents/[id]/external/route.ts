import { assertDocumentInWorkspace, getDocument, setExternalRef } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';
import { documentOut } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

/** Links the document to a partner record: { source, id, metadata }. */
export const PUT = apiRoute<{ id: string }>(
  { scope: 'documents:write', body: 'json' },
  async ({ principal, params, json }) => {
    await assertDocumentInWorkspace(db(), principal, params.id);
    await setExternalRef(db(), principal.actor, params.id, json() as never);
    return { status: 200, body: documentOut(await getDocument(db(), principal.actor, params.id)) };
  },
);
