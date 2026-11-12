import { readCompletedFileForSigner } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { requestMeta } from '@/lib/session';
import { readSignSession } from '@/lib/sign-session';
import { readRetrieveSession } from '@/lib/retrieve-session';

export const dynamic = 'force-dynamic';

/**
 * The finalized PDF or evidence certificate for the completed-document page, streamed through the
 * app (no public or long-lived file URLs). Same access checks as the page, integrity-checked, and
 * recorded in the evidence chain as a view or a download.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const q = new URL(req.url).searchParams;
    const kind = q.get('kind') === 'certificate' ? 'certificate' : 'signed';
    const view = q.get('view') === '1';
    const { bytes, filename } = await readCompletedFileForSigner(
      db(),
      storage(),
      token,
      await readSignSession(token),
      await readRetrieveSession(),
      kind,
      view ? 'view' : 'download',
      await requestMeta(),
    );
    const name =
      filename.replace(/\.pdf$/i, '') + (kind === 'certificate' ? '-certificate' : '') + '.pdf';
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${view ? 'inline' : 'attachment'}; filename="${name.replace(/[^\w.\- ]+/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
