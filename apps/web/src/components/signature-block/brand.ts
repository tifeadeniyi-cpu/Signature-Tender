import type { CSSProperties } from 'react';

/**
 * Theme tokens for the signature block, seal and their panels: the site's Midnight Navy, Champagne
 * Gold and Warm Ivory, matching the stamp drawn into signed PDFs. Spreading this on a wrapper
 * redefines the tokens for everything inside it, so Tailwind classes such as `bg-primary` follow.
 */
export const SIGNATURE_BRAND_STYLE = {
  '--color-primary': '#0d1b33',
  '--color-primary-hover': '#172d4d',
  '--color-primary-dark': '#081226',
  '--color-primary-surface': '#eaeef5',
  '--color-rose-gold': '#d8af68',
  '--color-blush': '#f6f0e7',
  '--color-ivory': '#fff9f2',
  '--color-slate-text': '#475569',
  '--color-heading': '#0d1b33',
  '--color-border': '#e7e1d6',
} as CSSProperties;
