import { exportContactsCsv } from '@st/core';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api';
import { requireWorkspace, requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Downloads the contacts the viewer can see as CSV. Cells are escaped against formula injection. */
export async function GET() {
  try {
    const { user, membership } = await requireWorkspace();
    const csv = await exportContactsCsv(
      db(),
      { userId: user.id },
      membership.workspace.id,
      await requestMeta(),
    );
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
