import { assertRequestInWorkspace, readRequestFile } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';

/** The signed PDF of a completed request. Its integrity hash is checked before it is sent. */
export const GET = apiRoute<{ id: string }>(
  { scope: 'files:read' },
  async ({ principal, params, meta }) => {
    await assertRequestInWorkspace(db(), principal, params.id);
    const f = await readRequestFile(db(), storage(), principal.actor, params.id, 'signed', meta);
    const name = f.filename.replace(/[^\w.-]+/g, '_').replace(/\.pdf$/i, '');
    return new Response(f.bytes as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${name}-signed.pdf"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  },
);
