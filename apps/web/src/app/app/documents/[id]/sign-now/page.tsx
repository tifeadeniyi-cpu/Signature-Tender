import { redirect } from 'next/navigation';
import { AppError, getRequestsForDocument, openSelfSigning } from '@st/core';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Opening your document' };

/**
 * "Sign it yourself": opens the signing page for the signed-in sender's own request with a fresh
 * link, instead of emailing them. Anything else goes back to the document page with a reason.
 * Linked with plain <a> tags only, since each visit issues a new link.
 */
export default async function SignNowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  let target: string;
  try {
    const requests = await getRequestsForDocument(db(), { userId: user.id }, id);
    const latest = requests[0]?.request;
    if (!latest) target = `/app/documents/${id}`;
    else {
      const { token } = await openSelfSigning(db(), { userId: user.id }, latest.id);
      target = `/sign/${token}`;
    }
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    target = `/app/documents/${id}?selfsign=${encodeURIComponent(err.code)}`;
  }
  redirect(target);
}
