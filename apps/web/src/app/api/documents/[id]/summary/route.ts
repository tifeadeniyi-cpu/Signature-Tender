import { NextResponse } from 'next/server';
import { AppError } from '@st/core';
import { apiError } from '@/lib/api';
import { getSession, requireWorkspace } from '@/lib/session';
import { loadDocumentSummary } from '@/lib/document-summary';

export const dynamic = 'force-dynamic';

/**
 * Details for the Documents page drawer. Signed-in members only; the document must be visible
 * to them under row-level security and belong to their current workspace, or it is a 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to view documents');
    const { user, membership } = await requireWorkspace();
    const { id } = await params;
    const summary = await loadDocumentSummary(user.id, membership, id);
    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (err) {
    return apiError(err);
  }
}
