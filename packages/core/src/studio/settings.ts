import { z } from 'zod';
import { ELEMENT_IDS, PENS, STUDIO_FONTS, STUDIO_INKS } from './families';

/**
 * Signature Studio settings, edited by staff in /admin and stored in app_config
 * (`signature_studio.settings`). Every rule here is enforced on the server.
 */
export const studioSettingsSchema = z.object({
  /** Product visibility: the public page, the in-app menu item and all Studio APIs. */
  enabled: z.boolean(),
  /** Visitors can design and preview without an account. */
  freePreview: z.boolean(),
  /** New purchases can be started. Existing purchases always stay downloadable. */
  purchasesEnabled: z.boolean(),
  /** Price per finalized custom design, in cents. */
  priceCents: z.number().int().min(50).max(10000),
  currency: z.enum(['USD']),
  /** Font ids switched off (kept for designs that already use them). */
  disabledFonts: z.array(z.string()).max(100),
  featuredFonts: z.array(z.string()).max(30),
  disabledPens: z.array(z.string()).max(20),
  disabledElements: z.array(z.string()).max(60),
  /** Hex colours customers can pick; custom colours are allowed when `customInk` is on. */
  inks: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(1).max(12),
  customInk: z.boolean(),
  formats: z.object({ png: z.boolean(), svg: z.boolean(), jpeg: z.boolean() }),
  /** Long edge of the PNG/JPEG export, in pixels. */
  exportWidth: z.number().int().min(800).max(4000),
  /** Initials are their own design. When true they are offered at the same per-design price. */
  initialsEnabled: z.boolean(),
  /** How long purchased files stay downloadable, in days. 0 = for as long as the account exists. */
  retentionDays: z.number().int().min(0).max(36500),
  /** Unpurchased guest drafts are deleted after this many days. */
  guestDraftDays: z.number().int().min(1).max(90),
  /** Expiry of each signed download link, in seconds. */
  downloadLinkSeconds: z.number().int().min(30).max(3600),
  crossSell: z.boolean(),
  promoMessage: z.string().max(240),
  limits: z.object({
    draftSavesPerHour: z.number().int().min(10).max(2000),
    uploadsPerHour: z.number().int().min(1).max(200),
    checkoutsPerHour: z.number().int().min(1).max(100),
    downloadsPerHour: z.number().int().min(10).max(2000),
  }),
});

export type StudioSettings = z.infer<typeof studioSettingsSchema>;

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  enabled: true,
  freePreview: true,
  purchasesEnabled: true,
  priceCents: 99,
  currency: 'USD',
  disabledFonts: [],
  featuredFonts: STUDIO_FONTS.filter((f) => f.featured).map((f) => f.id),
  disabledPens: [],
  disabledElements: [],
  inks: STUDIO_INKS.map((i) => i.color),
  customInk: true,
  formats: { png: true, svg: true, jpeg: true },
  exportWidth: 2400,
  initialsEnabled: true,
  retentionDays: 0,
  guestDraftDays: 30,
  downloadLinkSeconds: 300,
  crossSell: true,
  promoMessage: '',
  limits: { draftSavesPerHour: 240, uploadsPerHour: 20, checkoutsPerHour: 12, downloadsPerHour: 120 },
};

/** Reads stored settings over the defaults, ignoring anything invalid. */
export function resolveStudioSettings(stored: unknown): StudioSettings {
  const merged = {
    ...DEFAULT_STUDIO_SETTINGS,
    ...(stored && typeof stored === 'object' ? stored : {}),
  } as Record<string, unknown>;
  merged.limits = {
    ...DEFAULT_STUDIO_SETTINGS.limits,
    ...((stored as { limits?: object } | null)?.limits ?? {}),
  };
  const parsed = studioSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_STUDIO_SETTINGS;
}

/** The subset of settings the browser needs (no limits). */
export function publicStudioSettings(s: StudioSettings) {
  return {
    enabled: s.enabled,
    freePreview: s.freePreview,
    purchasesEnabled: s.purchasesEnabled,
    priceCents: s.priceCents,
    currency: s.currency,
    disabledFonts: s.disabledFonts,
    featuredFonts: s.featuredFonts,
    disabledPens: s.disabledPens.filter((p) => PENS.some((x) => x.id === p)),
    disabledElements: s.disabledElements.filter((e) => (ELEMENT_IDS as readonly string[]).includes(e)),
    inks: s.inks,
    customInk: s.customInk,
    formats: s.formats,
    initialsEnabled: s.initialsEnabled,
    retentionDays: s.retentionDays,
    crossSell: s.crossSell,
    promoMessage: s.promoMessage,
  };
}
export type PublicStudioSettings = ReturnType<typeof publicStudioSettings>;
