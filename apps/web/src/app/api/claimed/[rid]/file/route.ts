import { AppError, readClaimedFile } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { completionKind, readCompletion } from '@/lib/completion-files';
import { getSession, requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Signed copy or certificate of a document the signed-in user claimed. Recorded as evidence. */
export async function GET(req: Request, { params }: { params: Promise<{ rid: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user.emailVerified) throw new AppError('unauthenticated', 'Sign in first.');
    const { rid } = await params;
    const q = new URL(req.url).searchParams;
    const kind = completionKind(q.get('kind'));
    const view = q.get('view') === '1';
    const meta = await requestMeta();
    const { bytes, filename } = await readCompletion(kind, (k) =>
      readClaimedFile(db(), storage(), session.user.id, rid, k, view ? 'view' : 'download', meta),
    );
    const name =
      kind === 'package'
        ? filename
        : filename.replace(/\.pdf$/i, '') + (kind === 'certificate' ? '-certificate' : '') + '.pdf';
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${view ? 'inline' : 'attachment'}; filename="${name.replace(/[^\w.\- ]+/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
