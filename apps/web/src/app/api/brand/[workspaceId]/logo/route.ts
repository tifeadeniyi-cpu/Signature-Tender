import { readLogo, AppError } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Public workspace logo, shown to recipients on signing pages. Only PNG or JPEG bytes that were
 * sniffed on upload are served, with nosniff and a sandboxing CSP so the file can never run as a page.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const { bytes, type, sha256 } = await readLogo(db(), storage(), workspaceId);
    if (type !== 'image/png' && type !== 'image/jpeg') throw new AppError('not_found', 'No logo');
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=300',
        ETag: `"${sha256}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
