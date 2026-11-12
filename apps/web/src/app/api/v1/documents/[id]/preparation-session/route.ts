import { assertDocumentInWorkspace } from '@st/core';
import { db } from '@/lib/db';
import { appUrl } from '@/lib/billing';
import { apiRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';

/**
 * A link to the Signature Tender editor for this document, for placing fields by hand. The person
 * opening it must sign in as a member of the workspace; the link grants no access by itself.
 */
export const POST = apiRoute<{ id: string }>(
  { scope: 'documents:write' },
  async ({ principal, params }) => {
    await assertDocumentInWorkspace(db(), principal, params.id);
    return {
      status: 201,
      body: { url: appUrl(`/app/documents/${params.id}/fields`), requires_sign_in: true },
    };
  },
);
