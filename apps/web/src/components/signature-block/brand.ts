import type { CSSProperties } from 'react';

/**
 * The signature block, seal and their panels keep the burgundy palette from the approved design
 * while the rest of the app uses the site-wide theme. Spreading this on a wrapper redefines the
 * theme tokens for everything inside it, so Tailwind classes such as `bg-primary` pick it up.
 */
export const SIGNATURE_BRAND_STYLE = {
  '--color-primary': '#5b0a1c',
  '--color-primary-hover': '#7f1d3a',
  '--color-primary-dark': '#430515',
  '--color-primary-surface': '#f6e8ec',
  '--color-rose-gold': '#e6b8a7',
  '--color-blush': '#f9e4e8',
  '--color-ivory': '#fff9f7',
  '--color-slate-text': '#4b5563',
  '--color-heading': '#270f17',
  '--color-border': '#e9dde0',
} as CSSProperties;
