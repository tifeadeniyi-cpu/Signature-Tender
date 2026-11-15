import { recordActiveTime } from '@st/core';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { acceptMeasurement, noContent } from '@/lib/measure-guard';

export const dynamic = 'force-dynamic';

/** Adds active time in the app for the signed-in person (aggregated per day). */
export async function POST(req: Request) {
  const body = await acceptMeasurement(req, 12);
  const seconds = typeof body?.seconds === 'number' ? body.seconds : 0;
  if (!seconds || !Number.isFinite(seconds)) return noContent();
  const session = await getSession();
  if (session?.user.emailVerified) {
    await recordActiveTime(db(), { userId: session.user.id }, seconds).catch(() => undefined);
  }
  return noContent();
}
