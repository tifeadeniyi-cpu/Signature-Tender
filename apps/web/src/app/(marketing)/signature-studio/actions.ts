'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { AppError } from '@st/core';
import {
  STUDIO_EVENTS,
  abandonStudioCheckout,
  attachStudioCheckout,
  beginStudioCheckout,
  deleteDesign,
  duplicateDesign,
  getPurchasedDesign,
  hitRateLimit,
  recordStudioEvent,
  renameDesign,
  saveDraft,
  setDefaultDesign,
  storeUpload,
  type StudioEvent,
} from '@st/core/studio/server';
import { db } from '@/lib/db';
import { appUrl, paymentsAvailable } from '@/lib/billing';
import { getSession } from '@/lib/session';
import { stripe } from '@/lib/stripe';
import { storage } from '@/lib/storage';
import {
  JPEG_BACKGROUNDS,
  signDownloadLink,
  studioActor,
  studioSettings,
  type DownloadFormat,
  type JpegBackground,
} from '@/lib/studio';

export type StudioResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const SLOW_DOWN = 'You are doing that a lot. Please wait a few minutes and try again.';

function fail(err: unknown): { ok: false; message: string } {
  if (err instanceof AppError) return { ok: false, message: err.message };
  if (err instanceof ZodError) return { ok: false, message: err.issues[0]?.message ?? 'Check your design and try again.' };
  console.error('Signature Studio action failed', err);
  return { ok: false, message: 'Something went wrong. Your design is still here; please try again.' };
}

async function signedInUser() {
  const s = await getSession();
  return s?.user.emailVerified ? s.user : null;
}

/** Saves the design as a draft for this account or (before sign-in) this browser. */
export async function saveStudioDraftAction(input: {
  id?: string | null;
  design: unknown;
  name?: string;
}): Promise<StudioResult<{ id: string }>> {
  try {
    const settings = await studioSettings();
    const { actor, userId } = await studioActor(true);
    if (!settings.enabled || (!userId && !settings.freePreview))
      return { ok: false, message: 'Sign in to save your design.' };
    const key = `draft:${userId ?? actor.guestHash}`;
    if (!(await hitRateLimit(db(), key, settings.limits.draftSavesPerHour))) return { ok: false, message: SLOW_DOWN };
    const r = await saveDraft(db(), actor, { id: input.id, design: input.design, displayName: input.name }, settings);
    if (r.created) await recordStudioEvent(db(), 'design_started', { userId, guestHash: actor.guestHash, designId: r.id });
    return { ok: true, id: r.id };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Stores an uploaded signature. The browser has already cropped it, removed the background and
 * converted it to PNG; the server checks and rebuilds the PNG and keeps it private.
 */
export async function uploadStudioImageAction(form: FormData): Promise<StudioResult<{ ref: string; w: number; h: number }>> {
  try {
    const settings = await studioSettings();
    const { actor, userId } = await studioActor(true);
    if (!settings.enabled) return { ok: false, message: 'Signature Studio is not available right now.' };
    const file = form.get('file');
    if (!(file instanceof File)) return { ok: false, message: 'Choose an image to upload.' };
    if (file.size > 3_000_000) return { ok: false, message: 'That image is too large. Use one under 3 MB.' };
    if (!(await hitRateLimit(db(), `upload:${userId ?? actor.guestHash}`, settings.limits.uploadsPerHour)))
      return { ok: false, message: SLOW_DOWN };
    const r = await storeUpload(db(), storage(), actor, new Uint8Array(await file.arrayBuffer()));
    return { ok: true, ...r };
  } catch (err) {
    return fail(err);
  }
}

/** First-party funnel event. Only ids and short labels; never names or artwork. */
export async function studioEventAction(event: string, props: Record<string, string | number | boolean> = {}) {
  if (!(STUDIO_EVENTS as readonly string[]).includes(event)) return;
  try {
    const { actor, userId } = await studioActor(false);
    if (!(await hitRateLimit(db(), `event:${userId ?? actor.guestHash ?? 'anon'}`, 600))) return;
    await recordStudioEvent(db(), event as StudioEvent, {
      userId,
      guestHash: actor.guestHash,
      designId: typeof props.design === 'string' ? props.design : null,
      props: Object.fromEntries(Object.entries(props).filter(([k]) => k !== 'design')),
    });
  } catch (err) {
    console.warn('Studio event not recorded', err);
  }
}

/**
 * "Download" in the editor: saves the latest version and says where to go next. Guests are asked
 * to sign in first (their draft is kept and moves to the account after sign-in).
 */
export async function continueToCheckoutAction(input: {
  id?: string | null;
  design: unknown;
}): Promise<StudioResult<{ id: string; next: string; needsAuth: boolean }>> {
  const saved = await saveStudioDraftAction(input);
  if (!saved.ok) return saved;
  const user = await signedInUser();
  const { actor } = await studioActor(false);
  await recordStudioEvent(db(), user ? 'checkout_started' : 'auth_started', {
    userId: user?.id ?? null,
    guestHash: actor.guestHash,
    designId: saved.id,
  }).catch(() => undefined);
  return {
    ok: true,
    id: saved.id,
    needsAuth: !user,
    next: user ? `/signature-studio/checkout/${saved.id}` : '/signature-studio/continue',
  };
}

const STRIPE_DOWN = 'We could not reach our payment provider. You have not been charged. Please try again.';

/** "Pay $0.99 & Unlock": the amount comes from settings; payment is confirmed only by the webhook. */
export async function payForDesignAction(designId: string, _prev: unknown): Promise<StudioResult> {
  const user = await signedInUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent('/signature-studio/continue')}`);
  const settings = await studioSettings();
  if (!(await paymentsAvailable()))
    return { ok: false, message: 'Payments are not switched on yet. Your design is saved in your library.' };
  if (!(await hitRateLimit(db(), `checkout:${user.id}`, settings.limits.checkoutsPerHour)))
    return { ok: false, message: SLOW_DOWN };
  let url: string;
  try {
    const plan = await beginStudioCheckout(db(), user.id, designId, settings);
    try {
      const meta = { st_kind: 'signature_studio', st_purchase_id: plan.purchaseId };
      const session = await stripe().checkout.sessions.create(
        {
          mode: 'payment',
          customer_email: plan.customerEmail || undefined,
          client_reference_id: plan.purchaseId,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: plan.currency.toLowerCase(),
                unit_amount: plan.amountCents,
                product_data: { name: plan.productName, description: plan.description },
              },
            },
          ],
          metadata: meta,
          payment_intent_data: { metadata: meta },
          success_url: appUrl(`/signature-studio/return?p=${plan.purchaseId}`),
          cancel_url: appUrl(`/signature-studio/checkout/${plan.designId}?checkout=cancelled`),
        },
        { idempotencyKey: `studio-checkout:${plan.purchaseId}` },
      );
      if (!session.url) throw new Error('Stripe returned no checkout URL');
      await attachStudioCheckout(db(), user.id, plan.purchaseId, session.id);
      url = session.url;
    } catch (err) {
      console.error('Studio checkout failed', err);
      await abandonStudioCheckout(db(), user.id, plan.purchaseId, err instanceof Error ? err.message : 'error');
      return { ok: false, message: STRIPE_DOWN };
    }
  } catch (err) {
    return fail(err);
  }
  redirect(url);
}

/** A short-lived link to one purchased file. It only works for the signed-in owner. */
export async function studioDownloadLinkAction(
  designId: string,
  format: DownloadFormat,
  bg: JpegBackground = 'white',
): Promise<StudioResult<{ url: string }>> {
  try {
    const user = await signedInUser();
    if (!user) return { ok: false, message: 'Sign in to download your signature.' };
    if (!(bg in JPEG_BACKGROUNDS)) return { ok: false, message: 'Choose a background.' };
    const settings = await studioSettings();
    const info = await getPurchasedDesign(db(), user.id, designId, settings);
    if (!info?.entitlement) return { ok: false, message: 'Buy this design to download it.' };
    if (format !== 'zip' && !info.formats.includes(format))
      return { ok: false, message: 'That format is not available for this design.' };
    await recordStudioEvent(db(), 'download_clicked', { userId: user.id, designId, props: { format } }).catch(() => undefined);
    return { ok: true, url: signDownloadLink(user.id, designId, format, bg, settings.downloadLinkSeconds) };
  } catch (err) {
    return fail(err);
  }
}

async function libraryAction(fn: (userId: string) => Promise<unknown>): Promise<StudioResult> {
  try {
    const user = await signedInUser();
    if (!user) return { ok: false, message: 'Sign in to manage your signatures.' };
    await fn(user.id);
    revalidatePath('/signature-studio/library');
    revalidatePath('/app/signature-studio/library');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function renameDesignAction(id: string, name: string) {
  return libraryAction((u) => renameDesign(db(), u, id, name));
}
export async function setDefaultDesignAction(id: string) {
  return libraryAction((u) => setDefaultDesign(db(), u, id));
}
export async function duplicateDesignAction(id: string) {
  return libraryAction(async (u) => duplicateDesign(db(), u, id, await studioSettings()));
}
export async function deleteDesignAction(id: string) {
  return libraryAction((u) => deleteDesign(db(), u, id));
}
