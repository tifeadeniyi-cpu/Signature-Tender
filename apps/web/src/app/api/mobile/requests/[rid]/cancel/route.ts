import { cancelRequest } from '@st/core';
import { apiError } from '@/lib/api';
import { db } from '@/lib/db';
import { json, readJson, requireApiUser } from '@/lib/mobile-api';
import { requestMeta } from '@/lib/session';
import { kickWebhooks } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

/** Cancels an open signing request from the mobile app. The reason is recorded in the evidence. */
export async function POST(req: Request, { params }: { params: Promise<{ rid: string }> }) {
  try {
    const user = await requireApiUser();
    const body = await readJson(req);
    const { rid } = await params;
    kickWebhooks();
    await cancelRequest(
      db(),
      { userId: user.id },
      rid,
      typeof body.reason === 'string' ? body.reason : '',
      await requestMeta(),
    );
    return json({ ok: true, message: 'Request cancelled. The signing links no longer work.' });
  } catch (err) {
    return apiError(err);
  }
}
