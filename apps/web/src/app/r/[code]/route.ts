import { NextResponse, type NextRequest } from 'next/server';
import { checkReferralCode, getReferralProgram, recordReferralVisit } from '@st/core';
import { hitRateLimit } from '@st/core/studio/service';
import { db } from '@/lib/db';
import { setReferralCookie } from '@/lib/referrals';

export const dynamic = 'force-dynamic';

/**
 * A shared referral link (/r/CODE). Counts the visit, remembers the code in a signed httpOnly
 * cookie for the attribution window, and shows the invite page. Never reveals whose code it is.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const target = new URL('/invited', req.nextUrl.origin);
  // Slows down anyone trying codes in bulk; ordinary sharing never gets near this.
  if (!(await hitRateLimit(db(), `referral-visit:${ip}`, 60, 3600))) {
    target.searchParams.set('status', 'busy');
    return NextResponse.redirect(target, 303);
  }
  const check = await checkReferralCode(db(), raw);
  if (!check.ok) {
    target.searchParams.set('status', check.reason);
    return NextResponse.redirect(target, 303);
  }
  await recordReferralVisit(db(), check.code);
  const program = await getReferralProgram(db());
  await setReferralCookie(check.code, 'link', program.attributionWindowDays);
  return NextResponse.redirect(target, 303);
}
