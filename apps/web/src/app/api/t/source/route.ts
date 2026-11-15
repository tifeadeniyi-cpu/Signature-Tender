import { isTrafficSource, recordSignupSource } from '@st/core';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { acceptMeasurement, noContent } from '@/lib/measure-guard';

export const dynamic = 'force-dynamic';

/** Records the coarse source a new account came from (once, within 7 days of signing up). */
export async function POST(req: Request) {
  const body = await acceptMeasurement(req, 10);
  if (!body || !isTrafficSource(body.source)) return noContent();
  const session = await getSession();
  if (session?.user.emailVerified) {
    await recordSignupSource(db(), { userId: session.user.id }, body.source).catch(() => undefined);
  }
  return noContent();
}
