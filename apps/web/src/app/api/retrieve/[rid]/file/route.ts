import { readRetrievedFile } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { completionKind, readCompletion } from '@/lib/completion-files';
import { requestMeta } from '@/lib/session';
import { readRetrieveSession } from '@/lib/retrieve-session';

export const dynamic = 'force-dynamic';

/**
 * Completed copy or certificate for a verified-email session, streamed through the app (no public
 * or long-lived file URLs). Integrity-checked and logged in the evidence chain.
 */
export async function GET(req: Request, { params }: { params: Promise<{ rid: string }> }) {
  try {
    const { rid } = await params;
    const q = new URL(req.url).searchParams;
    const kind = completionKind(q.get('kind'));
    // view=1 streams inline for the in-page viewer; it is logged as a view, not a download.
    const view = q.get('view') === '1';
    const meta = await requestMeta();
    const retrieveSession = await readRetrieveSession();
    const { bytes, filename } = await readCompletion(kind, (k) =>
      readRetrievedFile(db(), storage(), retrieveSession, rid, k, meta, view ? 'view' : 'download'),
    );
    const name =
      kind === 'package'
        ? filename
        : filename.replace(/\.pdf$/i, '') + (kind === 'certificate' ? '-certificate' : '') + '.pdf';
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
