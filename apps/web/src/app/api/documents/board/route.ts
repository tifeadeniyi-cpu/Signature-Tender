import { NextResponse } from 'next/server';
import { AppError, type LibraryQuery } from '@st/core';
import { apiError } from '@/lib/api';
import { getSession, requireWorkspace } from '@/lib/session';
import { getBoard } from '@/lib/board';

export const dynamic = 'force-dynamic';

/**
 * Board data for the Documents page: one column's next page (?column=&offset=) for "Load more",
 * or every column (?limit=) for live refreshes. Same filters as the page; visibility is RLS.
 */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to view documents');
    const { user, membership } = await requireWorkspace();
    const sp = new URL(req.url).searchParams;
    const query = Object.fromEntries(sp.entries()) as unknown as LibraryQuery;
    const data = await getBoard(user.id, membership, query, {
      column: (sp.get('column') ?? undefined) as never,
      offset: sp.get('offset') ?? undefined,
      limit: sp.get('limit') ?? undefined,
    });
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (err) {
    return apiError(err);
  }
}
