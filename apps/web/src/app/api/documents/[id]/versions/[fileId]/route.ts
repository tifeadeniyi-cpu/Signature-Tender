import { headers } from 'next/headers';
import { readDocumentVersion, AppError } from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * One stored version of a document (original, signed copy or certificate). Authorized by
 * row-level security, integrity-checked, logged, never cached. `?view=1` previews inline.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const session = await auth().api.getSession({ headers: await headers() });
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to view documents');
    const { id, fileId } = await params;
    const view = new URL(req.url).searchParams.get('view') === '1';
    const { bytes, filename } = await readDocumentVersion(
      db(),
      storage(),
      { userId: session.user.id },
      id,
      fileId,
      await requestMeta(),
      view ? 'view' : 'download',
    );
    const safe = filename.replace(/[^\w.\- ]+/g, '_');
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${view ? 'inline' : 'attachment'}; filename="${safe}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
