import { headers, cookies } from 'next/headers';
import { exportReportCsv, defaultRange, listMyWorkspaces, AppError } from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api';
import { WORKSPACE_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** CSV of requests in the chosen range, for the current workspace. */
export async function GET(req: Request) {
  try {
    const session = await auth().api.getSession({ headers: await headers() });
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in first');
    const actor = { userId: session.user.id };
    const workspaces = await listMyWorkspaces(db(), actor);
    const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
    const ws = workspaces.find((w) => w.id === preferred) ?? workspaces[0];
    if (!ws) throw new AppError('forbidden', 'Create a workspace first');
    const url = new URL(req.url);
    const fb = defaultRange(90);
    const range = {
      from: url.searchParams.get('from') ?? fb.from,
      to: url.searchParams.get('to') ?? fb.to,
    };
    const csv = await exportReportCsv(db(), actor, ws.id, range, {
      includeTests: url.searchParams.get('tests') === '1',
    });
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="signature-tender-report-${range.from}-to-${range.to}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
