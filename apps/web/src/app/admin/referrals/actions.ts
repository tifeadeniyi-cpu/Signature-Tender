'use server';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import {
  AppError,
  adjustReferralCredits,
  getReferralProgram,
  reviewReferral,
  saveReferralProgram,
  setReferralLinkStatus,
} from '@st/core';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { sendReferralNotices } from '@/lib/referrals';

type Result = { ok: boolean; message: string } | null;

async function run(fn: () => Promise<string>): Promise<Result> {
  try {
    const message = await fn();
    revalidatePath('/admin/referrals');
    return { ok: true, message };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    if (err instanceof ZodError)
      return { ok: false, message: err.issues[0]?.message ?? 'Check the values.' };
    throw err;
  }
}

export async function reviewReferralAction(_prev: Result, form: FormData): Promise<Result> {
  const { user: staff } = await requireAdmin('operations.manage', 'referrals');
  const decision = form.get('decision') === 'approve' ? 'approve' : 'reject';
  return run(async () => {
    const notices = await reviewReferral(
      db(),
      staff.id,
      String(form.get('id')),
      decision,
      String(form.get('note') ?? ''),
    );
    await sendReferralNotices(notices);
    return decision === 'approve' ? 'Approved. Any rewards due were paid.' : 'Rejected.';
  });
}

export async function linkStatusAction(_prev: Result, form: FormData): Promise<Result> {
  const { user: staff } = await requireAdmin('operations.manage', 'referrals');
  const status = form.get('status') === 'active' ? 'active' : 'revoked';
  return run(async () => {
    await setReferralLinkStatus(
      db(),
      staff.id,
      String(form.get('identityId')),
      status,
      String(form.get('reason') ?? ''),
    );
    return status === 'revoked' ? 'Link revoked.' : 'Link restored.';
  });
}

export async function adjustCreditsAction(_prev: Result, form: FormData): Promise<Result> {
  const { user: staff } = await requireAdmin('operations.manage', 'referrals');
  return run(async () => {
    await adjustReferralCredits(db(), staff.id, {
      workspaceId: String(form.get('workspaceId')),
      delta: Number(form.get('delta')),
      reason: String(form.get('reason') ?? ''),
      attributionId: (form.get('attributionId') as string) || null,
    });
    return 'Adjustment recorded in the credit ledger.';
  });
}

export async function saveProgramAction(_prev: Result, form: FormData): Promise<Result> {
  const { user: staff } = await requireAdmin('operations.manage', 'referrals');
  const current = await getReferralProgram(db());
  const num = (k: string, d: number) => {
    const v = Number(form.get(k));
    return Number.isFinite(v) ? Math.trunc(v) : d;
  };
  return run(async () => {
    await saveReferralProgram(db(), staff.id, {
      status:
        (['active', 'paused', 'ended'] as const).find((s) => s === form.get('status')) ??
        current.status,
      name: String(form.get('name') ?? current.name),
      referrerCredits: num('referrerCredits', current.referrerCredits),
      referredCredits: num('referredCredits', current.referredCredits),
      attributionWindowDays: num('attributionWindowDays', current.attributionWindowDays),
      qualificationDelayHours: num('qualificationDelayHours', current.qualificationDelayHours),
      settings: {
        signupRewardEnabled: form.get('signupRewardEnabled') === 'on',
        referrerRewardEnabled: form.get('referrerRewardEnabled') === 'on',
        fraudReviewEnabled: form.get('fraudReviewEnabled') === 'on',
        velocityPerDay: num('velocityPerDay', current.settings.velocityPerDay),
        extraDisposableDomains: String(form.get('extraDisposableDomains') ?? '')
          .split(/[\s,]+/)
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean),
        shareMessage: String(form.get('shareMessage') ?? current.settings.shareMessage),
        landingMessage: String(form.get('landingMessage') ?? current.settings.landingMessage),
        termsUrl: String(form.get('termsUrl') ?? current.settings.termsUrl),
      },
    });
    return 'Program saved. New amounts apply to rewards issued from now on.';
  });
}
