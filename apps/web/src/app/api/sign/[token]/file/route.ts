import { readSignerSourceFile } from '@st/core';
import { readSignSession } from '@/lib/sign-session';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** The exact PDF that was sent, for an active signing session. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const session = await readSignSession(token);
    const { bytes } = await readSignerSourceFile(db(), storage(), token, session);
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
