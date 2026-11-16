import { ensureReferralLink, getReferralCenter, listMyWorkspaces } from '@st/core';
import { apiError } from '@/lib/api';
import { db } from '@/lib/db';
import { json, requireApiUser } from '@/lib/mobile-api';
import { referralUrl } from '@/lib/referrals';
import { WORKSPACE_COOKIE, WORKSPACE_HEADER } from '@/lib/session';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * The signed-in person's referral link, summary, history (masked) and reward activity in the
 * current workspace. Read-only apart from creating their link on first use; never issues rewards.
 */
export async function GET(req: Request) {
  try {
    const user = await requireApiUser();
    const actor = { userId: user.id };
    const workspaces = await listMyWorkspaces(db(), actor);
    const wanted =
      req.headers.get(WORKSPACE_HEADER) ?? (await cookies()).get(WORKSPACE_COOKIE)?.value;
    const ws = workspaces.find((w) => w.id === wanted) ?? workspaces[0];
    if (!ws) return json({ error: 'Create a workspace first.' }, 409);
    let center = await getReferralCenter(db(), actor, ws.id);
    if (center.program.live && !center.link) {
      await ensureReferralLink(db(), actor, ws.id).catch(() => null);
      center = await getReferralCenter(db(), actor, ws.id);
    }
    return json({
      program: {
        name: center.program.name,
        live: center.program.live,
        referrerCredits: center.program.referrerCredits,
        referredCredits: center.program.referredCredits,
        termsUrl: center.program.settings.termsUrl,
      },
      link: center.link ? { ...center.link, url: referralUrl(center.link.code) } : null,
      summary: center.summary,
      history: center.history,
      activity: center.canSeeBalance ? center.activity : [],
    });
  } catch (err) {
    return apiError(err);
  }
}
