'use server';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { retryStudioAssets, saveStudioSettings, studioSettingsSchema } from '@st/core/studio/server';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { studioDeps, studioSettings } from '@/lib/studio';

export async function saveStudioSettingsAction(_prev: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const staff = await requireStaff();
  const current = await studioSettings();
  const list = (k: string) => form.getAll(k).map(String);
  const num = (k: string, fallback: number) => {
    const v = Number(form.get(k));
    return Number.isFinite(v) ? v : fallback;
  };
  const priceDollars = num('price', current.priceCents / 100);
  const next = {
    ...current,
    enabled: form.get('enabled') === 'on',
    freePreview: form.get('freePreview') === 'on',
    purchasesEnabled: form.get('purchasesEnabled') === 'on',
    priceCents: Math.round(priceDollars * 100),
    disabledFonts: list('disabledFonts'),
    featuredFonts: list('featuredFonts').slice(0, 30),
    disabledPens: list('disabledPens'),
    disabledElements: list('disabledElements'),
    inks: list('inks').filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c)),
    customInk: form.get('customInk') === 'on',
    formats: { png: form.get('fmt_png') === 'on', svg: form.get('fmt_svg') === 'on', jpeg: form.get('fmt_jpeg') === 'on' },
    exportWidth: num('exportWidth', current.exportWidth),
    initialsEnabled: form.get('initialsEnabled') === 'on',
    retentionDays: num('retentionDays', current.retentionDays),
    guestDraftDays: num('guestDraftDays', current.guestDraftDays),
    downloadLinkSeconds: num('downloadLinkSeconds', current.downloadLinkSeconds),
    crossSell: form.get('crossSell') === 'on',
    promoMessage: String(form.get('promoMessage') ?? '').slice(0, 240),
  };
  if (!next.formats.png) return { ok: false, message: 'PNG must stay on: it is the main download.' };
  try {
    await saveStudioSettings(db(), staff.id, studioSettingsSchema.parse(next));
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, message: err.issues[0]?.message ?? 'Check the settings.' };
    throw err;
  }
  revalidatePath('/admin/signature-studio');
  return { ok: true, message: 'Settings saved. They apply immediately.' };
}

export async function retryAssetsAction(purchaseId: string) {
  const staff = await requireStaff();
  await retryStudioAssets(db(), studioDeps(), staff.id, purchaseId, await studioSettings());
  revalidatePath('/admin/signature-studio');
}
