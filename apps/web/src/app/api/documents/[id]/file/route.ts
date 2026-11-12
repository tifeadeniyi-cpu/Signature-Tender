import { headers } from 'next/headers';
import { readDocumentFile, AppError } from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Streams the original PDF after a row-level-security checked lookup and integrity check. Never cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth().api.getSession({ headers: await headers() });
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to view documents');
    const { id } = await params;
    const { bytes, filename } = await readDocumentFile(
      db(),
      storage(),
      { userId: session.user.id },
      id,
      await requestMeta(),
    );
    const safe = filename.replace(/[^\w.\- ]+/g, '_');
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safe}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
