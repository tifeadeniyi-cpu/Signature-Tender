import { getReferralAdmin, referralRowsToCsv } from '@st/core';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** CSV of referral records for staff (same filters as the page). */
export async function GET(req: Request) {
  const { user: staff } = await requireAdmin('revenue.view', 'referrals');
  const u = new URL(req.url);
  const parse = (v: string | null) =>
    v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  const days = Number(u.searchParams.get('range'));
  const from =
    parse(u.searchParams.get('from')) ??
    (Number.isFinite(days) && days > 0
      ? new Date(Date.now() - days * 86400_000)
      : new Date(Date.now() - 365 * 86400_000));
  const to = parse(u.searchParams.get('to')) ?? new Date();
  const data = await getReferralAdmin(db(), staff.id, {
    from,
    to,
    status: u.searchParams.get('status'),
    q: u.searchParams.get('q'),
  });
  return new Response(referralRowsToCsv(data.rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="referrals-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
