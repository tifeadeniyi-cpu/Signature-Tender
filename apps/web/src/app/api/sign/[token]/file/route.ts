import { readSignerSourceFile } from '@st/core';
import { readSignSession } from '@/lib/sign-session';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The exact PDF that was sent, for an active signing session. `?download=1` returns it as an
 * attachment, only when the sender allows downloads, and records the download as evidence.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const download = new URL(req.url).searchParams.get('download') === '1';
    const session = await readSignSession(token);
    const { bytes, filename } = await readSignerSourceFile(db(), storage(), token, session, {
      download,
      meta: download ? await requestMeta() : undefined,
    });
    const safe = (filename || 'document.pdf').replace(/[^\w.\- ]+/g, '_');
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': download ? `attachment; filename="${safe}"` : 'inline',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
