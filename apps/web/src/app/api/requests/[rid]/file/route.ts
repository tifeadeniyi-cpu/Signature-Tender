import { headers } from 'next/headers';
import { readRequestFile, AppError } from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { completionKind, readCompletion } from '@/lib/completion-files';
import { requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Downloads the signed copy or completion certificate of a completed request (?kind=signed|certificate|package). */
export async function GET(req: Request, { params }: { params: Promise<{ rid: string }> }) {
  try {
    const session = await auth().api.getSession({ headers: await headers() });
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to download documents');
    const { rid } = await params;
    const sp = new URL(req.url).searchParams;
    const kind = completionKind(sp.get('kind'));
    // ?view=1 opens the PDF in the browser (the board's "View certificate"); default downloads.
    const disposition = sp.get('view') === '1' ? 'inline' : 'attachment';
    const meta = await requestMeta();
    const { bytes, filename } = await readCompletion(kind, (k) =>
      readRequestFile(db(), storage(), { userId: session.user.id }, rid, k, meta),
    );
    const safe = filename.replace(/[^\w.\-() ]+/g, '_');
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${safe}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
