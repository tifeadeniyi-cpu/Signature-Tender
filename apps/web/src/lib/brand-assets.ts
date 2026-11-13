/**
 * The Signature Tender logo family (Midnight Navy and Champagne Gold). Every page refers to these
 * entries instead of hard-coding file names. Sources are the @2x files; width and height are their
 * pixel sizes so Next.js keeps the aspect ratio and serves a smaller copy where it is shown small.
 *
 * Recoloured from the approved burgundy masters without changing any artwork. The approved files
 * are raster only, so there is no SVG: a traced vector would not be faithful to the original.
 */
const BASE = '/branding/signature-tender';

export type BrandImage = { src: string; width: number; height: number; alt: string };

const ALT = 'Signature Tender';

export const BRAND_ASSETS = {
  /** Two-colour logo (navy "Signature", gold "Tender") for light backgrounds. */
  primary: {
    src: `${BASE}/primary/signature-tender-primary@2x.png`,
    width: 1810,
    height: 652,
    alt: ALT,
  },
  /** One-colour navy logo for light headers. */
  horizontalLight: {
    src: `${BASE}/horizontal/signature-tender-horizontal-light@2x.png`,
    width: 1810,
    height: 652,
    alt: ALT,
  },
  /** White wordmark with a gold nib, transparent, for Midnight Navy backgrounds. Also the dark horizontal logo. */
  reversed: {
    src: `${BASE}/reversed/signature-tender-reversed@2x.png`,
    width: 1810,
    height: 652,
    alt: ALT,
  },
  /** Stacked logo for sign-in, registration and welcome screens. */
  stacked: {
    src: `${BASE}/stacked/signature-tender-stacked@2x.png`,
    width: 558,
    height: 474,
    alt: ALT,
  },
  /** The pen-nib mark on its own (gold), for a collapsed sidebar or other tight spaces on navy. */
  nibMark: {
    src: `${BASE}/mark/signature-tender-nib-gold@2x.png`,
    width: 612,
    height: 580,
    alt: ALT,
  },
  /** Opaque logo on navy, for link previews where a transparent logo would vanish. */
  socialCard: {
    src: `${BASE}/reversed/signature-tender-reversed-on-navy-preview.png`,
    width: 1890,
    height: 732,
    alt: ALT,
  },
} as const satisfies Record<string, BrandImage>;

export const BRAND_ICONS = {
  favicon: `${BASE}/favicon/favicon.ico`,
  favicon32: `${BASE}/favicon/favicon-32.png`,
  favicon16: `${BASE}/favicon/favicon-16.png`,
  apple: `${BASE}/app-icon/icon-180.png`,
  icon192: `${BASE}/app-icon/icon-192.png`,
  icon512: `${BASE}/app-icon/icon-512.png`,
  social: `${BASE}/social/social-profile-icon.png`,
} as const;
