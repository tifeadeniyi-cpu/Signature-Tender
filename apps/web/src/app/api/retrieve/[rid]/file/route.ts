import { readRetrievedFile } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { requestMeta } from '@/lib/session';
import { readRetrieveSession } from '@/lib/retrieve-session';

export const dynamic = 'force-dynamic';

/** Completed copy or certificate for a verified-email session. Logged in the evidence chain. */
export async function GET(req: Request, { params }: { params: Promise<{ rid: string }> }) {
  try {
    const { rid } = await params;
    const kind =
      new URL(req.url).searchParams.get('kind') === 'certificate' ? 'certificate' : 'signed';
    const { bytes, filename } = await readRetrievedFile(
      db(),
      storage(),
      await readRetrieveSession(),
      rid,
      kind,
      await requestMeta(),
    );
    const name =
      filename.replace(/\.pdf$/i, '') + (kind === 'certificate' ? '-certificate' : '') + '.pdf';
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name.replace(/[^\w.\- ]+/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
