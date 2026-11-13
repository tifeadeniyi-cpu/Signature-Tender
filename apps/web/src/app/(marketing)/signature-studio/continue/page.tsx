import { redirect } from 'next/navigation';
import { claimGuestDrafts, listLibrary, recordStudioEvent } from '@st/core/studio/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { readGuestHash } from '@/lib/studio';

export const dynamic = 'force-dynamic';

/**
 * After sign-in or registration from the Studio: moves this browser's guest drafts into the
 * account, then opens checkout for the design the visitor was working on.
 */
export default async function ContinuePage() {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent('/signature-studio/continue')}`);
  if (!session.user.emailVerified) redirect('/verify-email');
  const userId = session.user.id;
  const guest = await readGuestHash();
  if (guest) {
    const moved = await claimGuestDrafts(db(), userId, guest);
    if (moved > 0) await recordStudioEvent(db(), 'draft_claimed', { userId, props: { count: moved } }).catch(() => undefined);
  }
  const latest = (await listLibrary(db(), userId)).find((d) => d.status === 'draft');
  redirect(latest ? `/signature-studio/checkout/${latest.id}` : '/signature-studio#studio');
}
