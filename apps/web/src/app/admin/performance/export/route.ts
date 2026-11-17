import {
  buildInsights,
  commandCenterCsv,
  csvCell,
  getCommandCenter,
  getPerfConversion,
  getPerfDelivery,
  getPerfEngagement,
  getPerfFeatures,
  getPerfGrowth,
  getPerfMeasurement,
  measurementCsv,
  parsePerfTab,
  perfCsv,
  recordAdminExport,
  resolvePeriod,
} from '@st/core';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

const LOADERS = {
  growth: getPerfGrowth,
  engagement: getPerfEngagement,
  features: getPerfFeatures,
  conversion: getPerfConversion,
  delivery: getPerfDelivery,
} as const;

/**
 * Platform Performance as CSV (the "Excel" option is the same file, which Excel opens directly).
 * Authorized on the server with the viewer's role: the SQL functions withhold revenue and the
 * failure list from roles that may not see them. Aggregates only, logged as
 * admin.report_exported, and every cell is escaped against spreadsheet formula injection.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tab = parsePerfTab(url.searchParams.get('tab'));
  const { user } = await requireAdmin('analytics.view', `performance_${tab}_export`);
  const p = resolvePeriod(Object.fromEntries(url.searchParams));
  const actor = { userId: user.id };
  let rows: string[][];
  if (tab === 'overview') {
    const c = await getCommandCenter(db(), actor, p);
    rows = commandCenterCsv(c, p);
    const insights = buildInsights(c, p, () => '');
    rows.push([], ['Key trends and insights', 'Detail', 'Definition']);
    for (const i of insights) rows.push([i.title, i.detail, i.definition]);
  } else {
    rows = perfCsv(tab, await LOADERS[tab](db(), actor, p), p);
    if (tab === 'growth' || tab === 'engagement' || tab === 'conversion')
      rows.push(...measurementCsv(tab, await getPerfMeasurement(db(), actor, p)));
  }
  await recordAdminExport(db(), actor, `performance_${tab}`, p);
  const csv = rows.map((r) => r.map((v) => csvCell(v)).join(',')).join('\r\n');
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return new Response(`﻿${csv}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="platform-performance-${tab}-${day(p.from)}-to-${day(new Date(p.to.getTime() - 1))}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
