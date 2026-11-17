'use server';
import { checkReferralCode, getReferralProgram } from '@st/core';
import { hitRateLimit } from '@st/core/studio/service';
import { db } from '@/lib/db';
import { requestMeta } from '@/lib/session';
import { clearReferralCookie, readReferralCookie, setReferralCookie } from '@/lib/referrals';

/**
 * Checks the optional referral code on the sign-up form just before the account is created, and
 * remembers it for the sign-up hook. An empty code clears any remembered one.
 */
export async function applyReferralCodeAction(
  code: string,
  email: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const raw = code.trim();
  if (!raw) {
    await clearReferralCookie();
    return { ok: true };
  }
  const { ipAddress } = await requestMeta();
  if (!(await hitRateLimit(db(), `referral-code:${ipAddress ?? 'unknown'}`, 20, 3600)))
    return { ok: false, message: 'Too many attempts. Try again later, or leave the code empty.' };
  const check = await checkReferralCode(db(), raw, { email });
  if (!check.ok) return { ok: false, message: check.message };
  const prior = await readReferralCookie();
  const program = await getReferralProgram(db());
  await setReferralCookie(
    check.code,
    prior?.code === check.code ? prior.source : 'code',
    program.attributionWindowDays,
  );
  return { ok: true };
}
