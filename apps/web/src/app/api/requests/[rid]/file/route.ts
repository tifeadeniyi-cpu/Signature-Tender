import { headers } from 'next/headers';
import { readRequestFile, AppError } from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { completionKind, readCompletion } from '@/lib/completion-files';
import { requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Downloads the signed copy or completion certificate of a completed request (?kind=signed|certificate). */
export async function GET(req: Request, { params }: { params: Promise<{ rid: string }> }) {
  try {
    const session = await auth().api.getSession({ headers: await headers() });
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to download documents');
    const { rid } = await params;
    const kind = completionKind(new URL(req.url).searchParams.get('kind'));
    const meta = await requestMeta();
    const { bytes, filename } = await readCompletion(kind, (k) =>
      readRequestFile(db(), storage(), { userId: session.user.id }, rid, k, meta),
    );
    const safe = filename.replace(/[^\w.\-() ]+/g, '_');
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safe}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
