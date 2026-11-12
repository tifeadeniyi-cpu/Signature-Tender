/**
 * Vector artwork for the Signature Tender verification seal and the timestamp icon. The same path
 * strings are drawn by the browser (SVG) and by pdf-lib, so the seal looks identical on screen, in
 * the signed PDF and in the completion certificate. Coordinates use a 32 x 32 box (icon: 16 x 16).
 *
 * The seal means "Signature Tender recorded this signing event and its evidence is available". It
 * is not a cryptographic signature and must never be labelled as identity verification,
 * notarization or a qualified electronic signature.
 */

export const SEAL_BOX = 32;
export const ICON_BOX = 16;

/** Brand palette: Midnight Navy, Royal Navy, Champagne Gold, Soft Gold, Warm Ivory. */
export const SEAL_COLORS = {
  outer: '#0D1B33',
  ring: '#172D4D',
  gold: '#D8AF68',
  goldLight: '#F3DEB4',
  ivory: '#FFF9F2',
} as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Scalloped circle: `lobes` rounded bumps between radius `inner` and `outer`, centred in the box. */
function scallop(lobes: number, inner: number, outer: number) {
  const c = SEAL_BOX / 2;
  const pt = (angle: number, r: number) =>
    `${r2(c + r * Math.cos(angle))} ${r2(c + r * Math.sin(angle))}`;
  const step = (Math.PI * 2) / lobes;
  let d = `M ${pt(-Math.PI / 2, inner)}`;
  for (let i = 0; i < lobes; i++) {
    const a0 = -Math.PI / 2 + i * step;
    // Control point pushed past the outer radius so each lobe reads as a rounded bump.
    d += ` Q ${pt(a0 + step / 2, outer + (outer - inner) * 0.9)} ${pt(a0 + step, inner)}`;
  }
  return `${d} Z`;
}

function circle(r: number, cx = SEAL_BOX / 2, cy = SEAL_BOX / 2) {
  return `M ${r2(cx - r)} ${cy} A ${r} ${r} 0 1 0 ${r2(cx + r)} ${cy} A ${r} ${r} 0 1 0 ${r2(cx - r)} ${cy} Z`;
}

export type SealVariant = 'full' | 'simple';

export interface SealLayer {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

const OUTER = scallop(16, 13.6, 15.2);

/** Full seal: navy scallop, fine gold ring, light gold interior, pen nib and a small check. */
const FULL: SealLayer[] = [
  { d: OUTER, fill: SEAL_COLORS.outer },
  { d: circle(12.4), fill: SEAL_COLORS.ring, stroke: SEAL_COLORS.gold, strokeWidth: 0.7 },
  { d: circle(10.6), fill: SEAL_COLORS.goldLight, stroke: SEAL_COLORS.gold, strokeWidth: 0.45 },
  // Pen nib.
  { d: 'M 16 7.2 L 19 11.6 L 17.3 16.4 L 14.7 16.4 L 13 11.6 Z', fill: SEAL_COLORS.outer },
  { d: 'M 16 11.4 L 16 15.6', stroke: SEAL_COLORS.goldLight, strokeWidth: 0.55 },
  { d: circle(0.8, 16, 11.2), fill: SEAL_COLORS.goldLight },
  // Check.
  {
    d: 'M 12.6 20.1 L 15.1 22.6 L 19.8 17.9',
    stroke: SEAL_COLORS.outer,
    strokeWidth: 1.7,
  },
];

/** Simplified seal for small sizes: scallop, gold ring and a bold check. Nothing fine to blur. */
const SIMPLE: SealLayer[] = [
  { d: OUTER, fill: SEAL_COLORS.outer },
  { d: circle(11.2), fill: SEAL_COLORS.outer, stroke: SEAL_COLORS.gold, strokeWidth: 1.4 },
  { d: 'M 10.6 16.4 L 14.4 20.2 L 21.6 13', stroke: SEAL_COLORS.goldLight, strokeWidth: 3 },
];

export function sealLayers(variant: SealVariant): SealLayer[] {
  return variant === 'full' ? FULL : SIMPLE;
}

/** Calendar with a check, drawn as strokes in a 16 x 16 box. */
export const CALENDAR_ICON: SealLayer[] = [
  {
    d: 'M 3.5 2.5 L 12.5 2.5 Q 14 2.5 14 4 L 14 13 Q 14 14.5 12.5 14.5 L 3.5 14.5 Q 2 14.5 2 13 L 2 4 Q 2 2.5 3.5 2.5 Z',
    stroke: '#172D4D',
    strokeWidth: 1.3,
  },
  { d: 'M 2 6 L 14 6', stroke: '#172D4D', strokeWidth: 1.3 },
  { d: 'M 5 1 L 5 4', stroke: '#172D4D', strokeWidth: 1.3 },
  { d: 'M 11 1 L 11 4', stroke: '#172D4D', strokeWidth: 1.3 },
  { d: 'M 5.6 10.2 L 7.3 11.9 L 10.6 8.6', stroke: '#172D4D', strokeWidth: 1.3 },
];

/** Smallest seal size (points) that still uses the detailed artwork. */
export const SEAL_DETAIL_MIN_PT = 13;
