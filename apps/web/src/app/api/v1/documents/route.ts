import { z } from 'zod';
import {
  AppError,
  createDocumentFromUpload,
  findByExternalRef,
  getConfigValue,
  getDocument,
  listDocuments,
  setExternalRef,
} from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiRoute, withBody } from '@/lib/public-api';
import { documentOut } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

/** Upload a PDF (multipart/form-data: file, title, document_type, external_source, external_id). */
export const POST = apiRoute(
  { scope: 'documents:write', body: 'upload' },
  async ({ req, body, principal, meta }) => {
    const d = db();
    const form = await withBody(req, body)
      .formData()
      .catch(() => {
        throw new AppError(
          'invalid',
          'Send the document as multipart/form-data with a "file" field.',
        );
      });
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('invalid', 'file: attach a PDF.');
    const maxMb = await getConfigValue(d, 'limits.max_upload_mb', 25);
    const maxPages = await getConfigValue(d, 'limits.max_pages', 200);
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    };
    const extSource = str('external_source');
    const extId = str('external_id');
    if (Boolean(extSource) !== Boolean(extId))
      throw new AppError('invalid', 'external_source and external_id go together.');
    const { id } = await createDocumentFromUpload(
      d,
      storage(),
      principal.actor,
      {
        workspaceId: principal.workspaceId,
        title: str('title') ?? file.name.replace(/\.pdf$/i, ''),
        documentType: str('document_type') ?? 'agreement',
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
      { maxBytes: maxMb * 1024 * 1024, maxPages },
      meta,
    );
    if (extSource && extId)
      await setExternalRef(d, principal.actor, id, { source: extSource, id: extId });
    return { status: 201, body: documentOut(await getDocument(d, principal.actor, id)) };
  },
);

/** Recent documents in the key's workspace, or those linked to one partner record. */
export const GET = apiRoute({ scope: 'documents:read' }, async ({ req, principal }) => {
  const url = new URL(req.url);
  const source = url.searchParams.get('external_source');
  const id = url.searchParams.get('external_id');
  if (source || id) {
    const q = z
      .object({ source: z.string().min(1).max(40), id: z.string().min(1).max(200) })
      .parse({ source, id });
    const rows = await findByExternalRef(db(), principal, q.source, q.id);
    return { status: 200, body: { data: rows } };
  }
  const rows = await listDocuments(db(), principal.actor, principal.workspaceId);
  return {
    status: 200,
    body: {
      data: rows
        .slice(0, 100)
        .map((r) => ({ id: r.id, title: r.title, status: r.status, updated_at: r.updatedAt })),
    },
  };
});
