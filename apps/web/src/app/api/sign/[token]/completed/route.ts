import { readCompletedFileForSigner } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { completionKind, readCompletion } from '@/lib/completion-files';
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
    const kind = completionKind(q.get('kind'));
    const view = q.get('view') === '1';
    const meta = await requestMeta();
    const signSession = await readSignSession(token);
    const retrieveSession = await readRetrieveSession();
    const { bytes, filename } = await readCompletion(kind, (k) =>
      readCompletedFileForSigner(
        db(),
        storage(),
        token,
        signSession,
        retrieveSession,
        k,
        view ? 'view' : 'download',
        meta,
      ),
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
