import { checkReferralCode } from '@st/core';
import { hitRateLimit } from '@st/core/studio/service';
import { apiError } from '@/lib/api';
import { db } from '@/lib/db';
import { json, readJson } from '@/lib/mobile-api';
import { requestMeta } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Says whether a referral code can be used (and why not), without revealing whose it is.
 * Rate limited per network. Never attributes or rewards anything.
 */
export async function POST(req: Request) {
  try {
    const { ipAddress } = await requestMeta();
    if (!(await hitRateLimit(db(), `referral-code:${ipAddress ?? 'unknown'}`, 20, 3600)))
      return json({ ok: false, message: 'Too many attempts. Try again later.' }, 429);
    const body = await readJson(req);
    const res = await checkReferralCode(db(), String(body.code ?? ''), {
      email: typeof body.email === 'string' ? body.email : null,
    });
    return json(res);
  } catch (err) {
    return apiError(err);
  }
}
