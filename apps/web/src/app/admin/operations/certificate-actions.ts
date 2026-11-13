'use server';
import { revalidatePath } from 'next/cache';
import { reissueCertificates } from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { env } from '@/lib/env';
import { requireStaff } from '@/lib/session';
import { toActionError, type ActionState } from '@/lib/action-result';

/**
 * Re-issues the Certificate of Completion, in the current design, for up to 25 completed requests
 * that still have an old-design certificate. Signed agreements are not touched.
 */
export async function reissueCertificatesAction(): Promise<ActionState> {
  const user = await requireStaff();
  try {
    const r = await reissueCertificates(
      db(),
      storage(),
      { userId: user.id },
      {
        appUrl: env().BETTER_AUTH_URL,
        limit: 25,
      },
    );
    revalidatePath('/admin/operations');
    const parts = [`${r.reissued} certificate${r.reissued === 1 ? '' : 's'} re-issued`];
    if (r.skippedPurged) parts.push(`${r.skippedPurged} skipped (files deleted after retention)`);
    if (r.failed.length)
      parts.push(
        `${r.failed.length} failed: ${r.failed.map((f) => `${f.requestId} (${f.error})`).join('; ')}`,
      );
    parts.push(`${r.remaining} remaining`);
    return { ok: r.reissued > 0 || r.failed.length === 0, message: `${parts.join(', ')}.` };
  } catch (err) {
    return toActionError(err);
  }
}
