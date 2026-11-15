import {
  commandCenterCsv,
  csvCell,
  getCommandCenter,
  recordAdminExport,
  resolvePeriod,
} from '@st/core';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The Command Center as CSV. Authorized on the server (analytics.view, and revenue rows only for
 * roles that may see revenue), logged as admin.report_exported, aggregates only, and every cell
 * is escaped against spreadsheet formula injection.
 */
export async function GET(req: Request) {
  const { user } = await requireAdmin('analytics.view', 'command_center_export');
  const url = new URL(req.url);
  const p = resolvePeriod(Object.fromEntries(url.searchParams));
  const actor = { userId: user.id };
  const c = await getCommandCenter(db(), actor, p);
  await recordAdminExport(db(), actor, 'command_center', p);
  const csv = commandCenterCsv(c, p)
    .map((r) => r.map((v) => csvCell(v)).join(','))
    .join('\r\n');
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return new Response(`﻿${csv}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="command-center-${day(p.from)}-to-${day(new Date(p.to.getTime() - 1))}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
