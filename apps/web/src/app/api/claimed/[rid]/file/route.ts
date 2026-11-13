import { AppError, readClaimedFile } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { getSession, requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Signed copy or certificate of a document the signed-in user claimed. Recorded as evidence. */
export async function GET(req: Request, { params }: { params: Promise<{ rid: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user.emailVerified) throw new AppError('unauthenticated', 'Sign in first.');
    const { rid } = await params;
    const q = new URL(req.url).searchParams;
    const kind = q.get('kind') === 'certificate' ? 'certificate' : 'signed';
    const view = q.get('view') === '1';
    const { bytes, filename } = await readClaimedFile(
      db(),
      storage(),
      session.user.id,
      rid,
      kind,
      view ? 'view' : 'download',
      await requestMeta(),
    );
    const name =
      filename.replace(/\.pdf$/i, '') + (kind === 'certificate' ? '-certificate' : '') + '.pdf';
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
