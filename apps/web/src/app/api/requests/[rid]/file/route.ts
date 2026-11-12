import { headers } from 'next/headers';
import { readRequestFile, AppError } from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Downloads the signed copy or completion certificate of a completed request (?kind=signed|certificate). */
export async function GET(req: Request, { params }: { params: Promise<{ rid: string }> }) {
  try {
    const session = await auth().api.getSession({ headers: await headers() });
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to download documents');
    const { rid } = await params;
    const kind =
      new URL(req.url).searchParams.get('kind') === 'certificate' ? 'certificate' : 'signed';
    const { bytes, filename } = await readRequestFile(
      db(),
      storage(),
      { userId: session.user.id },
      rid,
      kind,
      await requestMeta(),
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
