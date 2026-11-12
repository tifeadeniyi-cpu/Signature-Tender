import { readSignerSignedFile } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** The completed, signed copy for a recipient, when the sender allows downloads. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const { bytes, filename } = await readSignerSignedFile(
      db(),
      storage(),
      token,
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
