import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  schema,
  withBillingSystem,
  withStudio,
  withStudioSystem,
  type Database,
  type StudioActor,
  type Tx,
} from '@st/db';
import { PDFDocument } from 'pdf-lib';
import { AppError } from '../errors';
import { getConfigValue } from '../config';
import type { ObjectStorage } from '../storage';
import { sanitizePng, sha256Hex } from '../signing-crypto';
import {
  RENDERER_VERSION,
  availableFormats,
  canonicalJson,
  hasContent,
  normalizeDesign,
  styleLabel,
  type Design,
} from './design';
import { FONT_BY_ID } from './families';
import { renderDesign, toSvg, type FontProvider } from './render';
import { assertSafeSvg, svgToJpeg, svgToPng } from './raster';
import { resolveStudioSettings, type StudioSettings } from './settings';

export const STUDIO_SETTINGS_KEY = 'signature_studio.settings';

export async function getStudioSettings(db: Database): Promise<StudioSettings> {
  return resolveStudioSettings(await getConfigValue<unknown>(db, STUDIO_SETTINGS_KEY, null));
}

const uuid = z.string().uuid();
const hashOf = (d: Design) => sha256Hex(`${RENDERER_VERSION}|${canonicalJson(d)}`);

export type StudioFormat = 'png' | 'svg' | 'jpeg';

// ---------------------------------------------------------------------------------------------
// Rate limits and funnel events

/** Fixed-window counter. Returns false when `key` has used `limit` hits in the current window. */
export async function hitRateLimit(db: Database, key: string, limit: number, windowSeconds = 3600) {
  return withStudioSystem(db, async (tx) => {
    const [row] = (await tx.execute(sql`
      insert into signature_studio_rate_limits (key, window_start, count)
      values (${key}, now(), 1)
      on conflict (key) do update set
        count = case when signature_studio_rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                     then 1 else signature_studio_rate_limits.count + 1 end,
        window_start = case when signature_studio_rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                     then now() else signature_studio_rate_limits.window_start end
      returning count`)) as unknown as { count: number }[];
    return (row?.count ?? 0) <= limit;
  });
}

export const STUDIO_EVENTS = [
  'studio_visited',
  'design_started',
  'method_selected',
  'font_previewed',
  'font_selected',
  'smart_stroke_used',
  'custom_stroke_added',
  'variation_generated',
  'download_clicked',
  'auth_started',
  'registration_completed',
  'checkout_started',
  'purchase_completed',
  'purchase_failed',
  'asset_downloaded',
  'draft_claimed',
  'document_signing_started',
  'first_paid_request_sent',
] as const;
export type StudioEvent = (typeof STUDIO_EVENTS)[number];

/** First-party funnel event. Ids only: never names, artwork, emails or payment details. */
export async function recordStudioEvent(
  db: Database,
  event: StudioEvent,
  ctx: { userId?: string | null; guestHash?: string | null; designId?: string | null; props?: Record<string, string | number | boolean> } = {},
) {
  const props = Object.fromEntries(
    Object.entries(ctx.props ?? {})
      .filter(([k, v]) => /^[a-z_]{1,32}$/.test(k) && (typeof v !== 'string' || v.length <= 40))
      .slice(0, 8),
  );
  await db.insert(schema.signatureStudioEvents).values({
    event,
    userId: ctx.userId ?? null,
    sessionHash: ctx.guestHash ?? null,
    designId: ctx.designId && uuid.safeParse(ctx.designId).success ? ctx.designId : null,
    props,
  });
}

// ---------------------------------------------------------------------------------------------
// Drafts

function checkAllowed(d: Design, settings: StudioSettings) {
  if (d.text?.value && settings.disabledFonts.includes(d.text.font))
    throw new AppError('invalid', 'That font is not available right now. Choose another one.');
  if (settings.disabledPens.includes(d.pen)) throw new AppError('invalid', 'That pen style is not available.');
  for (const e of d.elements)
    if (settings.disabledElements.includes(e.type))
      throw new AppError('invalid', 'One of the signature elements is not available.');
  if (!settings.customInk) {
    const inks = new Set(settings.inks.map((i) => i.toUpperCase()));
    if (!inks.has(d.ink) || d.elements.some((e) => e.color && !inks.has(e.color)))
      throw new AppError('invalid', 'Choose one of the available ink colours.');
  }
  if (d.kind === 'initials' && !settings.initialsEnabled)
    throw new AppError('invalid', 'The initials designer is not available right now.');
  if (d.kind === 'initials' && d.text && d.text.value.replace(/[^\p{L}]/gu, '').length > 3)
    throw new AppError('invalid', 'Initials can have up to three letters.');
}

export interface DraftInput {
  id?: string | null;
  design: unknown;
  displayName?: string;
}

/** Saves a draft for a user or guest. Purchased designs cannot be overwritten. */
export async function saveDraft(db: Database, actor: StudioActor, input: DraftInput, settings: StudioSettings) {
  const design = normalizeDesign(input.design);
  checkAllowed(design, settings);
  if (design.upload) await requireUpload(db, design.upload.ref);
  const hash = hashOf(design);
  const name = (input.displayName ?? '').trim().slice(0, 60) || defaultName(design);
  return withStudio(db, actor, async (tx) => {
    if (input.id && uuid.safeParse(input.id).success) {
      const [row] = await tx
        .select({ id: schema.signatureDesigns.id, status: schema.signatureDesigns.status })
        .from(schema.signatureDesigns)
        .where(eq(schema.signatureDesigns.id, input.id));
      if (row && row.status === 'draft') {
        await tx
          .update(schema.signatureDesigns)
          .set({
            design: design as unknown as Record<string, unknown>,
            canonicalDesignHash: hash,
            creationMethod: design.method,
            styleFamily: design.text?.family ?? null,
            kind: design.kind,
            ...(input.displayName ? { displayName: name } : {}),
            version: sql`${schema.signatureDesigns.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.signatureDesigns.id, row.id));
        return { id: row.id, hash, created: false };
      }
      // A purchased (or missing) design is never changed: the edit becomes a new draft.
    }
    const [row] = await tx
      .insert(schema.signatureDesigns)
      .values({
        ownerUserId: actor.userId ?? null,
        creatorSessionHash: actor.userId ? null : (actor.guestHash ?? null),
        displayName: name,
        kind: design.kind,
        creationMethod: design.method,
        styleFamily: design.text?.family ?? null,
        design: design as unknown as Record<string, unknown>,
        canonicalDesignHash: hash,
        rendererVersion: RENDERER_VERSION,
        duplicatedFrom: input.id && uuid.safeParse(input.id).success ? input.id : null,
      })
      .returning({ id: schema.signatureDesigns.id });
    return { id: row!.id, hash, created: true };
  });
}

function defaultName(d: Design) {
  if (d.text?.value) return d.text.value.slice(0, 60);
  return d.kind === 'initials' ? 'My initials' : 'My signature';
}

export async function getDesign(db: Database, actor: StudioActor, id: string) {
  if (!uuid.safeParse(id).success) return null;
  return withStudio(db, actor, async (tx) => {
    const [row] = await tx.select().from(schema.signatureDesigns).where(eq(schema.signatureDesigns.id, id));
    return row ?? null;
  });
}

/** After sign-in: moves this browser's guest drafts to the account. Returns how many moved. */
export async function claimGuestDrafts(db: Database, userId: string, guestHash: string): Promise<number> {
  return withStudio(db, { userId, guestHash }, async (tx) => {
    const [r] = (await tx.execute(sql`select st_studio_claim(${guestHash}) as n`)) as unknown as { n: number }[];
    return Number(r?.n ?? 0);
  });
}

// ---------------------------------------------------------------------------------------------
// Uploads

/**
 * Stores an uploaded signature image after the browser has cropped it and removed the
 * background. Only PNG is accepted here; the file is rebuilt with drawing chunks only (no
 * metadata), decoded to prove it is a real image, and kept in private storage.
 */
export async function storeUpload(db: Database, storage: ObjectStorage, actor: StudioActor, bytes: Uint8Array) {
  let png: Buffer;
  try {
    png = sanitizePng(bytes, { maxBytes: 3_000_000, maxSide: 2400 });
    await (await PDFDocument.create()).embedPng(png);
  } catch {
    throw new AppError('invalid', 'That image could not be read. Upload a PNG or JPEG signature.');
  }
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const sha = sha256Hex(png);
  const key = `studio/uploads/${sha}.png`;
  await withStudioSystem(db, async (tx) => {
    const [existing] = await tx
      .select({ sha: schema.signatureUploads.sha256 })
      .from(schema.signatureUploads)
      .where(eq(schema.signatureUploads.sha256, sha));
    if (!existing) {
      await storage.put(key, png, 'image/png');
      await tx
        .insert(schema.signatureUploads)
        .values({
          sha256: sha,
          storageKey: key,
          width: w,
          height: h,
          bytes: png.length,
          ownerUserId: actor.userId ?? null,
          creatorSessionHash: actor.guestHash ?? null,
        })
        .onConflictDoNothing();
    }
  });
  return { ref: sha, w, h };
}

async function requireUpload(db: Database, ref: string) {
  const found = await withStudioSystem(db, async (tx) => {
    const [row] = await tx.select().from(schema.signatureUploads).where(eq(schema.signatureUploads.sha256, ref));
    return row;
  });
  if (!found) throw new AppError('invalid', 'Upload the signature image again.');
  return found;
}

/** Bytes of an upload, for previews of the visitor's own designs and for rendering exports. */
export async function readUpload(db: Database, storage: ObjectStorage, ref: string) {
  if (!/^[0-9a-f]{64}$/.test(ref)) return null;
  const row = await withStudioSystem(db, async (tx) => {
    const [r] = await tx.select().from(schema.signatureUploads).where(eq(schema.signatureUploads.sha256, ref));
    return r;
  });
  if (!row) return null;
  return Buffer.from(await storage.get(row.storageKey));
}

/** Whether this actor may see an upload: it is used by one of their own designs. */
export async function canSeeUpload(db: Database, actor: StudioActor, ref: string) {
  if (!/^[0-9a-f]{64}$/.test(ref)) return false;
  return withStudio(db, actor, async (tx) => {
    const rows = (await tx.execute(
      sql`select 1 from signature_designs where design->'upload'->>'ref' = ${ref} limit 1`,
    )) as unknown as unknown[];
    return rows.length > 0;
  });
}

// ---------------------------------------------------------------------------------------------
// Checkout

export interface StudioCheckoutPlan {
  purchaseId: string;
  designId: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  productName: string;
  description: string;
}

/**
 * Freezes the design exactly as the customer approved it and records a pending purchase with the
 * price fixed from settings. The webhook unlocks it only if Stripe's paid amount matches.
 */
export async function beginStudioCheckout(
  db: Database,
  userId: string,
  designId: string,
  settings: StudioSettings,
): Promise<StudioCheckoutPlan> {
  if (!settings.enabled || !settings.purchasesEnabled)
    throw new AppError('conflict', 'Signature purchases are paused right now. Your design is saved.');
  if (!uuid.safeParse(designId).success) throw new AppError('not_found', 'Design not found');
  return withStudio(db, { userId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.signatureDesigns)
      .where(eq(schema.signatureDesigns.id, designId))
      .for('update');
    if (!row || row.ownerUserId !== userId) throw new AppError('not_found', 'Design not found');
    if (row.status !== 'draft') throw new AppError('conflict', 'You already own this design. Download it from your library.');
    const design = normalizeDesign(row.design);
    if (!hasContent(design)) throw new AppError('invalid', 'Create your signature before checking out.');
    checkAllowed(design, settings);
    const [me] = await tx.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
    const [p] = await tx
      .insert(schema.signaturePurchases)
      .values({
        signatureDesignId: row.id,
        designSnapshot: design as unknown as Record<string, unknown>,
        designHash: hashOf(design),
        ownerUserId: userId,
        customerEmail: me?.email ?? null,
        amountCents: settings.priceCents,
        currency: settings.currency,
      })
      .returning({ id: schema.signaturePurchases.id });
    return {
      purchaseId: p!.id,
      designId: row.id,
      amountCents: settings.priceCents,
      currency: settings.currency,
      customerEmail: me?.email ?? '',
      productName: design.kind === 'initials' ? 'Custom Handwritten Initials' : 'Custom Handwritten Signature',
      description: `One finalized ${design.kind === 'initials' ? 'initials' : 'signature'} design (${styleLabel(design)}). One-time purchase with repeat downloads.`,
    };
  });
}

export async function attachStudioCheckout(db: Database, userId: string, purchaseId: string, sessionId: string) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Error('Invalid Checkout session id');
  await withStudio(db, { userId }, async (tx) => {
    const [p] = await tx
      .update(schema.signaturePurchases)
      .set({ stripeCheckoutSessionId: sessionId, updatedAt: new Date() })
      .where(and(eq(schema.signaturePurchases.id, purchaseId), eq(schema.signaturePurchases.paymentStatus, 'pending')))
      .returning({ id: schema.signaturePurchases.id });
    if (!p) throw new AppError('not_found', 'Purchase not found');
  });
}

export async function abandonStudioCheckout(db: Database, userId: string, purchaseId: string, reason: string) {
  await withStudio(db, { userId }, async (tx) => {
    await tx
      .update(schema.signaturePurchases)
      .set({ paymentStatus: 'failed', failureReason: reason.slice(0, 300), updatedAt: new Date() })
      .where(and(eq(schema.signaturePurchases.id, purchaseId), eq(schema.signaturePurchases.paymentStatus, 'pending')));
  });
}

export interface StudioCheckoutFacts {
  sessionId: string;
  paymentStatus: string;
  amountSubtotal: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  customerEmail: string | null;
}

export type StudioCheckoutOutcome =
  | { action: 'none'; reason: string }
  | { action: 'fulfil'; purchaseId: string; designId: string; userId: string }
  | { action: 'refund_duplicate'; purchaseId: string; paymentIntentId: string | null };

/**
 * Stripe says a Studio checkout finished. Grants exactly one entitlement for exactly the frozen
 * design, only when Stripe reports it paid and the amount and currency match the purchase row.
 * Safe to call any number of times. A second payment for an already-owned design is marked
 * `duplicate` and handed back so the caller refunds it.
 */
export async function applyStudioCheckoutCompleted(db: Database, f: StudioCheckoutFacts): Promise<StudioCheckoutOutcome> {
  return withBillingSystem(db, async (tx) => {
    const [p] = await tx
      .select()
      .from(schema.signaturePurchases)
      .where(eq(schema.signaturePurchases.stripeCheckoutSessionId, f.sessionId))
      .for('update');
    if (!p) return { action: 'none', reason: 'unknown_session' };
    if (f.paymentStatus !== 'paid') {
      await tx
        .update(schema.signaturePurchases)
        .set({ paymentStatus: 'processing', stripePaymentIntentId: f.paymentIntentId, updatedAt: new Date() })
        .where(and(eq(schema.signaturePurchases.id, p.id), eq(schema.signaturePurchases.paymentStatus, 'pending')));
      return { action: 'none', reason: 'awaiting_settlement' };
    }
    const amountOk =
      f.amountSubtotal === p.amountCents && (f.currency ?? '').toLowerCase() === p.currency.toLowerCase();
    if (!amountOk) {
      await tx
        .update(schema.signaturePurchases)
        .set({
          paymentStatus: 'failed',
          failureReason: `Amount mismatch: Stripe ${f.amountSubtotal} ${f.currency}, expected ${p.amountCents} ${p.currency}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.signaturePurchases.id, p.id));
      throw new Error(`Studio checkout ${f.sessionId} amount does not match purchase ${p.id}`);
    }
    if (p.paymentStatus === 'paid' || p.paymentStatus === 'duplicate')
      return p.paymentStatus === 'paid'
        ? { action: 'fulfil', purchaseId: p.id, designId: p.signatureDesignId, userId: p.ownerUserId }
        : { action: 'none', reason: 'already_handled' };

    const [active] = await tx
      .select({ id: schema.signatureEntitlements.id, purchaseId: schema.signatureEntitlements.purchaseId })
      .from(schema.signatureEntitlements)
      .where(
        and(
          eq(schema.signatureEntitlements.signatureDesignId, p.signatureDesignId),
          eq(schema.signatureEntitlements.accessStatus, 'active'),
        ),
      );
    if (active && active.purchaseId !== p.id) {
      await tx
        .update(schema.signaturePurchases)
        .set({
          paymentStatus: 'duplicate',
          stripePaymentIntentId: f.paymentIntentId,
          failureReason: 'This design was already paid for; the duplicate payment is refunded.',
          updatedAt: new Date(),
        })
        .where(eq(schema.signaturePurchases.id, p.id));
      return { action: 'refund_duplicate', purchaseId: p.id, paymentIntentId: f.paymentIntentId };
    }

    const now = new Date();
    await tx
      .update(schema.signaturePurchases)
      .set({
        paymentStatus: 'paid',
        purchasedAt: now,
        stripePaymentIntentId: f.paymentIntentId,
        customerEmail: f.customerEmail ?? p.customerEmail,
        failureReason: null,
        updatedAt: now,
      })
      .where(eq(schema.signaturePurchases.id, p.id));
    // Freeze the design as it was at checkout: the snapshot becomes the purchased artwork.
    await tx
      .update(schema.signatureDesigns)
      .set({
        design: p.designSnapshot,
        canonicalDesignHash: p.designHash,
        status: 'purchased',
        purchasedAt: now,
        updatedAt: now,
      })
      .where(and(eq(schema.signatureDesigns.id, p.signatureDesignId), eq(schema.signatureDesigns.status, 'draft')));
    await tx
      .insert(schema.signatureEntitlements)
      .values({ signatureDesignId: p.signatureDesignId, purchaseId: p.id, ownerUserId: p.ownerUserId })
      .onConflictDoNothing();
    await tx.insert(schema.auditEvents).values({
      workspaceId: null,
      actorUserId: p.ownerUserId,
      action: 'studio.purchase_completed',
      targetType: 'signature_purchase',
      targetId: p.id,
      metadata: { amountCents: p.amountCents, currency: p.currency, designId: p.signatureDesignId },
    });
    return { action: 'fulfil', purchaseId: p.id, designId: p.signatureDesignId, userId: p.ownerUserId };
  });
}

/** Checkout expired or an async payment failed: nothing is unlocked and the design stays a draft. */
export async function applyStudioCheckoutClosed(db: Database, sessionId: string, status: 'expired' | 'failed') {
  return withBillingSystem(db, async (tx) => {
    const [row] = await tx
      .update(schema.signaturePurchases)
      .set({ paymentStatus: status, updatedAt: new Date() })
      .where(
        and(
          eq(schema.signaturePurchases.stripeCheckoutSessionId, sessionId),
          inArray(schema.signaturePurchases.paymentStatus, ['pending', 'processing']),
        ),
      )
      .returning({ id: schema.signaturePurchases.id });
    return row ?? null;
  });
}

/**
 * A refund or dispute on a Studio payment. A full refund or a dispute revokes download access to
 * that design (files are kept for the record); a partial refund changes nothing for the customer.
 */
export async function applyStudioReversal(
  db: Database,
  f: { paymentIntentId: string; kind: 'refund' | 'dispute'; amountRefunded?: number },
) {
  return withBillingSystem(db, async (tx) => {
    const [p] = await tx
      .select()
      .from(schema.signaturePurchases)
      .where(eq(schema.signaturePurchases.stripePaymentIntentId, f.paymentIntentId))
      .for('update');
    if (!p) return { found: false };
    const refunded = Math.min(p.amountCents, f.amountRefunded ?? 0);
    const full = f.kind === 'dispute' || refunded >= p.amountCents;
    if (p.paymentStatus === 'duplicate') {
      await tx
        .update(schema.signaturePurchases)
        .set({ amountRefundedCents: refunded, refundedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.signaturePurchases.id, p.id));
      return { found: true, revoked: false };
    }
    await tx
      .update(schema.signaturePurchases)
      .set({
        paymentStatus: f.kind === 'dispute' ? 'disputed' : full ? 'refunded' : p.paymentStatus,
        amountRefundedCents: f.kind === 'refund' ? refunded : p.amountRefundedCents,
        refundedAt: full ? new Date() : p.refundedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.signaturePurchases.id, p.id));
    if (!full) return { found: true, revoked: false };
    await tx
      .update(schema.signatureEntitlements)
      .set({ accessStatus: 'revoked', revokedAt: new Date(), revokeReason: f.kind })
      .where(and(eq(schema.signatureEntitlements.purchaseId, p.id), eq(schema.signatureEntitlements.accessStatus, 'active')));
    await tx.insert(schema.auditEvents).values({
      workspaceId: null,
      actorUserId: null,
      action: `studio.purchase_${f.kind === 'dispute' ? 'disputed' : 'refunded'}`,
      targetType: 'signature_purchase',
      targetId: p.id,
      metadata: { amountRefunded: refunded },
    });
    return { found: true, revoked: true };
  });
}

/** What our records say about a checkout, for the page Stripe returns to. Never Stripe's redirect. */
export async function getStudioCheckoutStatus(db: Database, userId: string, purchaseId: string) {
  if (!uuid.safeParse(purchaseId).success) return null;
  return withStudio(db, { userId }, async (tx) => {
    const [p] = await tx.select().from(schema.signaturePurchases).where(eq(schema.signaturePurchases.id, purchaseId));
    if (!p) return null;
    return { status: p.paymentStatus, designId: p.signatureDesignId, amountCents: p.amountCents, currency: p.currency };
  });
}

// ---------------------------------------------------------------------------------------------
// Fulfilment: exports rendered from the frozen snapshot

export interface RenderDeps {
  fonts: (ids: string[]) => Promise<FontProvider>;
  storage: ObjectStorage;
}

async function renderSnapshot(db: Database, deps: RenderDeps, snapshot: Design) {
  const fonts = await deps.fonts(snapshot.text?.font ? [snapshot.text.font] : []);
  const r = renderDesign(snapshot, fonts);
  if (r.missingFonts.length) throw new Error(`Font not available on the server: ${r.missingFonts.join(', ')}`);
  let href: string | undefined;
  if (snapshot.upload) {
    const bytes = await readUpload(db, deps.storage, snapshot.upload.ref);
    if (!bytes) throw new Error('Uploaded image is missing from storage');
    href = `data:image/png;base64,${bytes.toString('base64')}`;
  }
  return { r, imageHref: () => href };
}

const JPEG_BACKGROUNDS = ['#FFFFFF', '#FFF9F2', '#F6F0E7'];

/**
 * Renders and stores the purchased files (PNG, SVG when the design is pure vector, JPEG on white)
 * from the frozen snapshot. Idempotent: existing ready files are kept; failures are recorded per
 * format and can be retried at any time without any new charge.
 */
export async function generateStudioAssets(
  db: Database,
  deps: RenderDeps,
  purchaseId: string,
  settings: StudioSettings,
  opts: { jpegBackground?: string; only?: StudioFormat } = {},
) {
  const p = await withStudioSystem(db, async (tx) => {
    const [row] = await tx.select().from(schema.signaturePurchases).where(eq(schema.signaturePurchases.id, purchaseId));
    return row;
  });
  if (!p || p.paymentStatus !== 'paid') throw new AppError('forbidden', 'This purchase is not paid.');
  const snapshot = normalizeDesign(p.designSnapshot);
  const formats = availableFormats(snapshot).filter((f) => !opts.only || f === opts.only);
  const bg = (opts.jpegBackground ?? '#FFFFFF').toUpperCase();
  if (!JPEG_BACKGROUNDS.includes(bg)) throw new AppError('invalid', 'Choose an available JPEG background.');
  const existing = await withStudioSystem(db, (tx) =>
    tx.select().from(schema.signatureAssets).where(eq(schema.signatureAssets.purchaseId, purchaseId)),
  );
  let rendered: Awaited<ReturnType<typeof renderSnapshot>> | null = null;
  const results: { format: StudioFormat; ok: boolean }[] = [];
  for (const format of formats) {
    const background = format === 'jpeg' ? bg : '';
    const have = existing.find((a) => a.format === format && a.background === background);
    if (have?.status === 'ready') {
      results.push({ format, ok: true });
      continue;
    }
    try {
      rendered ??= await renderSnapshot(db, deps, snapshot);
      const { r, imageHref } = rendered;
      let body: Buffer;
      let width: number;
      let height: number;
      let contentType: string;
      if (format === 'svg') {
        const svg = toSvg(r, { imageHref });
        assertSafeSvg(svg);
        body = Buffer.from(svg, 'utf8');
        const m = svg.match(/width="(\d+)" height="(\d+)"/);
        width = Number(m?.[1] ?? 0);
        height = Number(m?.[2] ?? 0);
        contentType = 'image/svg+xml';
      } else if (format === 'png') {
        const out = svgToPng(toSvg(r, { imageHref }), settings.exportWidth);
        body = out.png;
        width = out.width;
        height = out.height;
        contentType = 'image/png';
      } else {
        const out = svgToJpeg(toSvg(r, { imageHref }), settings.exportWidth, bg);
        body = out.jpeg;
        width = out.width;
        height = out.height;
        contentType = 'image/jpeg';
      }
      const hash = sha256Hex(body);
      const key = `studio/assets/${purchaseId}/${format}${background ? `-${background.slice(1).toLowerCase()}` : ''}-${hash.slice(0, 16)}.${format === 'jpeg' ? 'jpg' : format}`;
      await deps.storage.put(key, body, contentType);
      await withStudioSystem(db, (tx) =>
        tx
          .insert(schema.signatureAssets)
          .values({
            signatureDesignId: p.signatureDesignId,
            purchaseId,
            format,
            background,
            status: 'ready',
            storageReference: key,
            contentHash: hash,
            width,
            height,
            bytes: body.length,
            attempts: 1,
            generatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [schema.signatureAssets.purchaseId, schema.signatureAssets.format, schema.signatureAssets.background],
            set: {
              status: 'ready',
              storageReference: key,
              contentHash: hash,
              width,
              height,
              bytes: body.length,
              error: null,
              attempts: sql`${schema.signatureAssets.attempts} + 1`,
              generatedAt: new Date(),
              updatedAt: new Date(),
            },
          }),
      );
      results.push({ format, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : 'error';
      console.error(`Studio asset ${format} for ${purchaseId} failed`, err);
      await withStudioSystem(db, (tx) =>
        tx
          .insert(schema.signatureAssets)
          .values({ signatureDesignId: p.signatureDesignId, purchaseId, format, background, status: 'failed', error: message, attempts: 1 })
          .onConflictDoUpdate({
            target: [schema.signatureAssets.purchaseId, schema.signatureAssets.format, schema.signatureAssets.background],
            set: { status: 'failed', error: message, attempts: sql`${schema.signatureAssets.attempts} + 1`, updatedAt: new Date() },
          }),
      );
      results.push({ format, ok: false });
    }
  }
  return results;
}

/** The active entitlement this user holds for a design, or null. */
async function entitlementFor(tx: Tx, designId: string) {
  const [e] = await tx
    .select()
    .from(schema.signatureEntitlements)
    .where(and(eq(schema.signatureEntitlements.signatureDesignId, designId), eq(schema.signatureEntitlements.accessStatus, 'active')));
  return e ?? null;
}

function retentionOk(purchasedAt: Date | null, settings: StudioSettings) {
  if (!settings.retentionDays || !purchasedAt) return true;
  return Date.now() - purchasedAt.getTime() < settings.retentionDays * 86400_000;
}

/** Everything the download window needs for one purchased design. */
export async function getPurchasedDesign(db: Database, userId: string, designId: string, settings: StudioSettings) {
  if (!uuid.safeParse(designId).success) return null;
  return withStudio(db, { userId }, async (tx) => {
    const [d] = await tx.select().from(schema.signatureDesigns).where(eq(schema.signatureDesigns.id, designId));
    if (!d || d.ownerUserId !== userId) return null;
    const ent = await entitlementFor(tx, designId);
    const purchase = ent
      ? (await tx.select().from(schema.signaturePurchases).where(eq(schema.signaturePurchases.id, ent.purchaseId)))[0]
      : null;
    const assets = ent
      ? await tx.select().from(schema.signatureAssets).where(eq(schema.signatureAssets.purchaseId, ent.purchaseId))
      : [];
    const design = normalizeDesign(d.design);
    return {
      design: d,
      snapshot: design,
      entitlement: ent,
      purchase: purchase ?? null,
      assets,
      formats: availableFormats(design).filter((f) => settings.formats[f]),
      retained: retentionOk(purchase?.purchasedAt ?? null, settings),
    };
  });
}

/**
 * Checks the user may download this format now (active entitlement they own, format enabled,
 * within retention) and returns the stored file, generating it first if it is missing or failed.
 * Every attempt is logged. Never charges anything.
 */
export async function readStudioAsset(
  db: Database,
  deps: RenderDeps,
  userId: string,
  designId: string,
  format: StudioFormat,
  settings: StudioSettings,
  opts: { jpegBackground?: string; via?: string } = {},
) {
  const info = await getPurchasedDesign(db, userId, designId, settings);
  if (!info?.entitlement || !info.purchase) throw new AppError('forbidden', 'Buy this design to download it.');
  if (!info.formats.includes(format)) throw new AppError('invalid', 'That format is not available for this design.');
  if (!info.retained) throw new AppError('conflict', 'The download period for this design has ended.');
  const background = format === 'jpeg' ? (opts.jpegBackground ?? '#FFFFFF').toUpperCase() : '';
  const find = async () =>
    withStudioSystem(db, async (tx) => {
      const [a] = await tx
        .select()
        .from(schema.signatureAssets)
        .where(
          and(
            eq(schema.signatureAssets.purchaseId, info.purchase!.id),
            eq(schema.signatureAssets.format, format),
            eq(schema.signatureAssets.background, background),
          ),
        );
      return a ?? null;
    });
  let asset = await find();
  if (!asset || asset.status !== 'ready') {
    await generateStudioAssets(db, deps, info.purchase.id, settings, { only: format, jpegBackground: background || undefined });
    asset = await find();
  }
  const log = (result: string) =>
    withStudioSystem(db, (tx) =>
      tx.insert(schema.signatureDownloads).values({
        entitlementId: info.entitlement!.id,
        assetId: asset?.id ?? null,
        format,
        via: opts.via ?? 'download',
        result,
      }),
    );
  if (!asset || asset.status !== 'ready' || !asset.storageReference) {
    await log('failed');
    throw new AppError('conflict', 'We could not prepare this file just now. Please try again in a moment. You will not be charged again.');
  }
  const body = await deps.storage.get(asset.storageReference);
  if (sha256Hex(body) !== asset.contentHash) {
    await log('integrity_failed');
    throw new Error('Stored signature file failed its integrity check');
  }
  await log('ok');
  return {
    body: Buffer.from(body),
    contentType: format === 'svg' ? 'image/svg+xml' : format === 'png' ? 'image/png' : 'image/jpeg',
    filename: `${slug(info.design.displayName)}.${format === 'jpeg' ? 'jpg' : format}`,
  };
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'signature';
}

// ---------------------------------------------------------------------------------------------
// Signature Library

export async function listLibrary(db: Database, userId: string) {
  return withStudio(db, { userId }, async (tx) => {
    const designs = await tx
      .select()
      .from(schema.signatureDesigns)
      .where(and(eq(schema.signatureDesigns.ownerUserId, userId), ne(schema.signatureDesigns.status, 'archived')))
      .orderBy(desc(schema.signatureDesigns.updatedAt));
    const ents = designs.length
      ? await tx
          .select()
          .from(schema.signatureEntitlements)
          .where(inArray(schema.signatureEntitlements.signatureDesignId, designs.map((d) => d.id)))
      : [];
    const purchases = ents.length
      ? await tx
          .select()
          .from(schema.signaturePurchases)
          .where(inArray(schema.signaturePurchases.id, ents.map((e) => e.purchaseId)))
      : [];
    return designs.map((d) => {
      const ent = ents.find((e) => e.signatureDesignId === d.id && e.accessStatus === 'active') ?? ents.find((e) => e.signatureDesignId === d.id);
      const purchase = ent ? purchases.find((p) => p.id === ent.purchaseId) : undefined;
      const design = normalizeDesign(d.design);
      return {
        id: d.id,
        name: d.displayName,
        kind: d.kind as 'signature' | 'initials',
        status: d.status,
        isDefault: d.isDefault,
        style: styleLabel(design),
        design,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        purchasedAt: purchase?.purchasedAt ?? null,
        purchaseId: purchase?.id ?? null,
        access: ent?.accessStatus ?? null,
      };
    });
  });
}

const renameSchema = z.string().trim().min(1, 'Give your design a name.').max(60);

export async function renameDesign(db: Database, userId: string, id: string, name: string) {
  const n = renameSchema.parse(name);
  if (!uuid.safeParse(id).success) throw new AppError('not_found', 'Design not found');
  await withStudio(db, { userId }, (tx) =>
    tx
      .update(schema.signatureDesigns)
      .set({ displayName: n, updatedAt: new Date() })
      .where(and(eq(schema.signatureDesigns.id, id), eq(schema.signatureDesigns.ownerUserId, userId))),
  );
}

/** Only a purchased design with active access can be the default used when signing. */
export async function setDefaultDesign(db: Database, userId: string, id: string) {
  if (!uuid.safeParse(id).success) throw new AppError('not_found', 'Design not found');
  await withStudio(db, { userId }, async (tx) => {
    const [d] = await tx.select().from(schema.signatureDesigns).where(eq(schema.signatureDesigns.id, id));
    if (!d || d.ownerUserId !== userId) throw new AppError('not_found', 'Design not found');
    if (d.status !== 'purchased' || !(await entitlementFor(tx, id)))
      throw new AppError('conflict', 'Buy this design before making it your default.');
    await tx
      .update(schema.signatureDesigns)
      .set({ isDefault: false })
      .where(and(eq(schema.signatureDesigns.ownerUserId, userId), eq(schema.signatureDesigns.kind, d.kind), eq(schema.signatureDesigns.isDefault, true)));
    await tx.update(schema.signatureDesigns).set({ isDefault: true }).where(eq(schema.signatureDesigns.id, id));
  });
}

/** Copies a design into a new draft. The original (and its purchase) is untouched. */
export async function duplicateDesign(db: Database, userId: string, id: string, settings: StudioSettings) {
  const d = await getDesign(db, { userId }, id);
  if (!d || d.ownerUserId !== userId) throw new AppError('not_found', 'Design not found');
  const copy = await saveDraft(db, { userId }, { design: d.design, displayName: `${d.displayName} (copy)`.slice(0, 60) }, settings);
  await withStudio(db, { userId }, (tx) =>
    tx.update(schema.signatureDesigns).set({ duplicatedFrom: d.id }).where(eq(schema.signatureDesigns.id, copy.id)),
  );
  return copy;
}

/**
 * Drafts are deleted. A purchased design is archived instead: it leaves the library, but the
 * purchase record, receipt and files are kept as the billing record.
 */
export async function deleteDesign(db: Database, userId: string, id: string) {
  if (!uuid.safeParse(id).success) throw new AppError('not_found', 'Design not found');
  await withStudio(db, { userId }, async (tx) => {
    const [d] = await tx.select().from(schema.signatureDesigns).where(eq(schema.signatureDesigns.id, id));
    if (!d || d.ownerUserId !== userId) throw new AppError('not_found', 'Design not found');
    if (d.status === 'draft') {
      const [hasPurchase] = await tx
        .select({ id: schema.signaturePurchases.id })
        .from(schema.signaturePurchases)
        .where(eq(schema.signaturePurchases.signatureDesignId, id))
        .limit(1);
      if (!hasPurchase) {
        await tx.delete(schema.signatureDesigns).where(eq(schema.signatureDesigns.id, id));
        return;
      }
    }
    await tx
      .update(schema.signatureDesigns)
      .set({ status: d.status === 'draft' ? 'draft' : 'archived', isDefault: false, updatedAt: new Date() })
      .where(eq(schema.signatureDesigns.id, id));
    if (d.status === 'draft') {
      // A draft with an abandoned checkout keeps its row for the purchase record but leaves the list.
      await tx.execute(sql`update signature_designs set display_name = display_name where id = ${id}`);
    }
  });
}

export async function getReceipt(db: Database, userId: string, purchaseId: string) {
  if (!uuid.safeParse(purchaseId).success) return null;
  return withStudio(db, { userId }, async (tx) => {
    const [p] = await tx.select().from(schema.signaturePurchases).where(eq(schema.signaturePurchases.id, purchaseId));
    if (!p || p.ownerUserId !== userId) return null;
    const [d] = await tx.select().from(schema.signatureDesigns).where(eq(schema.signatureDesigns.id, p.signatureDesignId));
    return { purchase: p, designName: d?.displayName ?? 'Signature design', style: styleLabel(normalizeDesign(p.designSnapshot)) };
  });
}

export async function listPurchases(db: Database, userId: string) {
  return withStudio(db, { userId }, async (tx) =>
    tx
      .select({
        id: schema.signaturePurchases.id,
        designId: schema.signaturePurchases.signatureDesignId,
        status: schema.signaturePurchases.paymentStatus,
        amountCents: schema.signaturePurchases.amountCents,
        currency: schema.signaturePurchases.currency,
        purchasedAt: schema.signaturePurchases.purchasedAt,
        createdAt: schema.signaturePurchases.createdAt,
        name: schema.signatureDesigns.displayName,
      })
      .from(schema.signaturePurchases)
      .innerJoin(schema.signatureDesigns, eq(schema.signatureDesigns.id, schema.signaturePurchases.signatureDesignId))
      .where(and(eq(schema.signaturePurchases.ownerUserId, userId), inArray(schema.signaturePurchases.paymentStatus, ['paid', 'refunded', 'disputed', 'duplicate'])))
      .orderBy(desc(schema.signaturePurchases.createdAt)),
  );
}

/** Purchased designs with active access, for the document-signing studio. */
export async function listSignableDesigns(db: Database, userId: string, kind: 'signature' | 'initials') {
  const all = await listLibrary(db, userId);
  return all.filter((d) => d.status === 'purchased' && d.access === 'active' && d.kind === kind);
}

/**
 * The PNG of a purchased design for adopting in a document: rendered from the frozen snapshot,
 * only for the owner with active access. The caller still runs the normal adoption flow.
 */
export async function purchasedDesignPng(db: Database, deps: RenderDeps, userId: string, designId: string, settings: StudioSettings) {
  const file = await readStudioAsset(db, deps, userId, designId, 'png', settings, { via: 'document_signing' });
  return file.body;
}

// ---------------------------------------------------------------------------------------------
// Administration

async function requireStaffAudit(tx: Tx, view: string) {
  await tx.execute(sql`select st_admin_require(${view})`);
}

export async function saveStudioSettings(db: Database, staffUserId: string, settings: StudioSettings) {
  const parsed = (await import('./settings')).studioSettingsSchema.parse(settings);
  for (const f of parsed.disabledFonts) if (!(f in FONT_BY_ID)) throw new AppError('invalid', `Unknown font ${f}`);
  await withStudioSystem(
    db,
    async (tx) => {
      await tx.execute(sql`select st_studio_save_settings(${JSON.stringify(parsed)}::jsonb)`);
    },
    staffUserId,
  );
}

export async function getStudioAdminReport(db: Database, staffUserId: string) {
  return withStudioSystem(
    db,
    async (tx) => {
      await requireStaffAudit(tx, 'signature_studio');
      const funnel = (await tx.execute(sql`
        select event, count(*)::int as n, count(distinct coalesce(user_id, session_hash))::int as people
        from signature_studio_events where created_at > now() - interval '30 days'
        group by event`)) as unknown as { event: string; n: number; people: number }[];
      const totals = (await tx.execute(sql`
        select payment_status as status, count(*)::int as n, coalesce(sum(amount_cents), 0)::int as cents
        from signature_purchases group by payment_status`)) as unknown as { status: string; n: number; cents: number }[];
      const recent = await tx
        .select({
          id: schema.signaturePurchases.id,
          status: schema.signaturePurchases.paymentStatus,
          amountCents: schema.signaturePurchases.amountCents,
          currency: schema.signaturePurchases.currency,
          createdAt: schema.signaturePurchases.createdAt,
          purchasedAt: schema.signaturePurchases.purchasedAt,
          failureReason: schema.signaturePurchases.failureReason,
          refunded: schema.signaturePurchases.amountRefundedCents,
          designId: schema.signaturePurchases.signatureDesignId,
        })
        .from(schema.signaturePurchases)
        .orderBy(desc(schema.signaturePurchases.createdAt))
        .limit(40);
      const failedAssets = await tx
        .select({
          id: schema.signatureAssets.id,
          purchaseId: schema.signatureAssets.purchaseId,
          format: schema.signatureAssets.format,
          error: schema.signatureAssets.error,
          attempts: schema.signatureAssets.attempts,
          updatedAt: schema.signatureAssets.updatedAt,
        })
        .from(schema.signatureAssets)
        .where(eq(schema.signatureAssets.status, 'failed'))
        .orderBy(desc(schema.signatureAssets.updatedAt))
        .limit(40);
      const [conv] = (await tx.execute(sql`select * from st_studio_conversion()`)) as unknown as {
        buyers: number;
        buyers_sent: number;
        buyers_paid_request: number;
      }[];
      return { funnel, totals, recent, failedAssets, conversion: conv ?? null };
    },
    staffUserId,
  );
}

/** Staff: re-run file generation for a paid purchase (never charges the customer). */
export async function retryStudioAssets(db: Database, deps: RenderDeps, staffUserId: string, purchaseId: string, settings: StudioSettings) {
  await withStudioSystem(db, (tx) => requireStaffAudit(tx, `signature_studio.retry:${purchaseId}`), staffUserId);
  return generateStudioAssets(db, deps, purchaseId, settings);
}

/** Deletes unpurchased guest drafts older than the configured age (scheduled job). */
export async function purgeGuestDrafts(db: Database, days: number) {
  return withStudioSystem(db, async (tx) => {
    const rows = await tx
      .delete(schema.signatureDesigns)
      .where(
        and(
          isNull(schema.signatureDesigns.ownerUserId),
          eq(schema.signatureDesigns.status, 'draft'),
          sql`${schema.signatureDesigns.updatedAt} < now() - make_interval(days => ${days})`,
          sql`not exists (select 1 from signature_purchases p where p.signature_design_id = ${schema.signatureDesigns.id})`,
        ),
      )
      .returning({ id: schema.signatureDesigns.id });
    return rows.length;
  });
}
