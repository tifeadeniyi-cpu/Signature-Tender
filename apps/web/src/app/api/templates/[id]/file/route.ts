import { headers } from 'next/headers';
import { readTemplateFile, AppError } from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Streams a template's PDF (the draft by default, or ?version=<id>) after an RLS-checked lookup and integrity check. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth().api.getSession({ headers: await headers() });
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to view templates');
    const { id } = await params;
    const version = new URL(req.url).searchParams.get('version') ?? undefined;
    const { bytes, filename } = await readTemplateFile(
      db(),
      storage(),
      { userId: session.user.id },
      id,
      version,
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
