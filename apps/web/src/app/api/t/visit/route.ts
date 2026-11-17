import { isSitePage, isTrafficSource, recordVisit } from '@st/core';
import { db } from '@/lib/db';
import { acceptMeasurement, noContent } from '@/lib/measure-guard';

export const dynamic = 'force-dynamic';

/** Counts one website visit: the page group it started on and a coarse source category. */
export async function POST(req: Request) {
  const body = await acceptMeasurement(req, 20);
  if (body && isSitePage(body.page) && isTrafficSource(body.source)) {
    await recordVisit(db(), body.page, body.source).catch(() => undefined);
  }
  return noContent();
}
