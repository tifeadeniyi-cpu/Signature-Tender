/**
 * The one layout engine for the Signature Tender signature block. It turns a field size and the
 * signer's details into a list of drawing primitives in field-local points (origin top-left, y
 * down). The browser renders them as SVG and pdf-lib draws them into the signed PDF, so the signing
 * preview, the completed viewer, the download and the certificate cannot drift apart.
 *
 * This file must stay free of pdf-lib and database imports: it is bundled into the browser.
 *
 * Layout, top to bottom:
 *   1. the adopted signature (exact image, aspect ratio kept)
 *   2. a thin signature line spanning the field
 *   3. signer name | role
 *   4. a blush strip with the server signing time and, at its right end, the small seal
 */
import { CODES, SANS, SERIF_BOLD } from './font-metrics';
import { SEAL_DETAIL_MIN_PT, type SealVariant } from './seal';

/** Option A..D from the spec. `full` (D) is the default. */
export const SIGNATURE_DISPLAY_FORMATS = [
  'signature',
  'signature_name',
  'signature_name_time',
  'full',
] as const;
export type SignatureDisplayFormat = (typeof SIGNATURE_DISPLAY_FORMATS)[number];
export const DEFAULT_SIGNATURE_DISPLAY: SignatureDisplayFormat = 'full';

export const SIGNATURE_DISPLAY_LABELS: Record<SignatureDisplayFormat, string> = {
  signature: 'Signature only',
  signature_name: 'Signature and name',
  signature_name_time: 'Signature, name and signing time',
  full: 'Signature, name, signing time and seal',
};

export const BLOCK_COLORS = {
  ink: '#111111',
  name: '#0D1B33',
  role: '#4B5563',
  divider: '#172D4D',
  line: '#1F1F1F',
  strip: '#F3DEB4',
  stripText: '#262626',
  pendingText: '#4B5563',
  separator: '#D8AF68',
} as const;

export type BlockFont = 'sans' | 'serifBold';

export type Primitive =
  | { kind: 'image'; x: number; y: number; width: number; height: number; align: 'left' | 'center' }
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      thickness: number;
      color: string;
    }
  | {
      kind: 'text';
      x: number;
      /** Baseline, measured from the top of the field. */
      y: number;
      size: number;
      font: BlockFont;
      color: string;
      text: string;
      /** Advance width from the shared metrics; renderers stretch or squeeze to exactly this. */
      width: number;
    }
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      color: string;
    }
  | { kind: 'icon'; x: number; y: number; size: number }
  | { kind: 'seal'; x: number; y: number; size: number; variant: SealVariant };

export type BlockTimestamp =
  | { state: 'pending'; timeZone?: string | null }
  | { state: 'completed'; signedAt: Date | string; timeZone?: string | null };

export interface BlockInput {
  /** Field size in PDF points. */
  width: number;
  height: number;
  format?: SignatureDisplayFormat;
  kind?: 'signature' | 'initials';
  name: string;
  /** Display label, for example "Signer". Leave empty to omit. */
  role?: string | null;
  timestamp: BlockTimestamp;
}

export interface BlockLayout {
  width: number;
  height: number;
  requested: SignatureDisplayFormat;
  /** What is actually drawn. Differs from `requested` only when the field is too small. */
  format: SignatureDisplayFormat;
  /** False when the requested format could not be drawn legibly in this field. */
  fits: boolean;
  /** True when the short date and no role were used to fit. */
  compact: boolean;
  scale: number;
  primitives: Primitive[];
  /** Where the seal sits (field-local points), for the viewer's click target. */
  sealBox: { x: number; y: number; size: number } | null;
}

// ---------------------------------------------------------------------------------------------
// Text

const widthTable = (() => {
  const sans = new Map<number, number>();
  const serif = new Map<number, number>();
  CODES.forEach((c, i) => {
    sans.set(c, SANS[i]!);
    serif.set(c, SERIF_BOLD[i]!);
  });
  return { sans, serifBold: serif };
})();

/** Letters with no Unicode decomposition that still have an obvious base letter. */
const EXTRA_FOLDS: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  ı: 'i',
  Ŀ: 'L',
  ŀ: 'l',
  Œ: 'OE',
  œ: 'oe',
};

/**
 * Keeps only characters the PDF standard fonts can encode, so both renderers draw the same string.
 * Accents that cannot be encoded fall back to their base letter; anything else becomes "?".
 */
export function blockSafeText(text: string): string {
  let out = '';
  for (const ch of text.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')) {
    const cp = ch.codePointAt(0)!;
    if (widthTable.sans.has(cp)) {
      out += ch;
      continue;
    }
    const base = (EXTRA_FOLDS[ch] ?? ch).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    out += [...base].every((b) => widthTable.sans.has(b.codePointAt(0)!)) && base ? base : '?';
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function textWidth(text: string, font: BlockFont, size: number): number {
  const table = widthTable[font];
  let w = 0;
  for (const ch of text) w += table.get(ch.codePointAt(0)!) ?? table.get(63)!;
  return (w * size) / 1000;
}

// ---------------------------------------------------------------------------------------------
// Time

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function zoneName(date: Date, timeZone: string) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? 'UTC';
}

/**
 * Formats the server's signing time in the document time zone, for example
 * "Signed on Nov 12, 2026 at 10:24 AM (EST)" or, compact, "Nov 12, 2026 10:24 AM EST".
 */
export function formatSigningTime(
  signedAt: Date | string,
  timeZone: string | null | undefined,
  compact = false,
): string {
  const d = new Date(signedAt);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid signing time');
  const tz = validTimeZone(timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const date = `${parts.month} ${parts.day}, ${parts.year}`;
  const time = `${parts.hour}:${parts.minute} ${(parts.dayPeriod ?? '').toUpperCase()}`;
  const zone = zoneName(d, tz);
  return blockSafeText(
    compact ? `${date} ${time} ${zone}` : `Signed on ${date} at ${time} (${zone})`,
  );
}

/**
 * The widest string `formatSigningTime` can produce for this zone. Layout is sized from it, so
 * the pending preview and the final block have identical geometry whatever the actual time.
 */
function widestTimeText(timeZone: string | null | undefined, compact: boolean) {
  const tz = validTimeZone(timeZone);
  const year = new Date().getUTCFullYear();
  const zones = [0, 6].map((m) => zoneName(new Date(Date.UTC(year, m, 1)), tz));
  const zone = zones.reduce((a, b) => (textWidth(a, 'sans', 1) >= textWidth(b, 'sans', 1) ? a : b));
  const month = MONTHS.reduce((a, b) =>
    textWidth(a, 'sans', 1) >= textWidth(b, 'sans', 1) ? a : b,
  );
  const date = `${month} 28, 2088`;
  const time = '12:58 PM';
  return blockSafeText(
    compact ? `${date} ${time} ${zone}` : `Signed on ${date} at ${time} (${zone})`,
  );
}

export const PENDING_TIME_TEXT = 'Signing time is added when you finish';
export const PENDING_TIME_TEXT_COMPACT = 'Time added when you finish';

// ---------------------------------------------------------------------------------------------
// Layout

/** Base metrics at scale 1, in points. */
const M = {
  name: 11,
  role: 9,
  dividerGap: 5,
  lineGap: 3,
  nameGap: 3,
  stripH: 16,
  stripText: 8,
  stripPadX: 5,
  icon: 9,
  iconGap: 4,
  sepGap: 4,
  seal: 19,
} as const;

/** Smallest text the block will draw (points). Below this the format is reduced instead. */
export const MIN_TEXT_PT = 5;
const MIN_SCALE = MIN_TEXT_PT / M.stripText;
/** Below this the full wording is traded for the compact one (timestamp text about 6pt). */
const COMFORT_SCALE = 0.75;
/** Share of the field height kept for the signature itself. */
const SIGNATURE_SHARE = 0.42;
const MIN_SIGNATURE_PT = 10;
const LINE_PT = 0.75;

const ORDER: SignatureDisplayFormat[] = [
  'signature',
  'signature_name',
  'signature_name_time',
  'full',
];
const rank = (f: SignatureDisplayFormat) => ORDER.indexOf(f);

function padding(w: number, h: number) {
  return Math.max(2, Math.min(6, Math.min(w, h) * 0.05));
}

interface Variant {
  format: SignatureDisplayFormat;
  compact: boolean;
  role: boolean;
}

/** Unscaled widths and heights of the metadata rows for one variant. */
function measure(v: Variant, name: string, role: string, timeZone: string | null | undefined) {
  const nameW = textWidth(name, 'serifBold', M.name);
  const roleBlock =
    v.role && role ? M.dividerGap * 2 + LINE_PT + textWidth(role, 'sans', M.role) : 0;
  const nameRowW = nameW + roleBlock;
  const nameRowH = M.name * 1.18;
  let stripW = 0;
  let stripTextW = 0;
  const seal = v.format === 'full';
  if (rank(v.format) >= rank('signature_name_time')) {
    stripTextW = textWidth(widestTimeText(timeZone, v.compact), 'sans', M.stripText);
    stripW =
      M.stripPadX +
      M.icon +
      M.iconGap +
      stripTextW +
      (seal ? M.sepGap * 2 + LINE_PT + M.seal * 0.92 : M.stripPadX);
  }
  let metaH = 0;
  if (rank(v.format) >= rank('signature_name')) metaH += M.lineGap + nameRowH;
  if (rank(v.format) >= rank('signature_name_time'))
    metaH += M.nameGap + (seal ? Math.max(M.stripH, M.seal) : M.stripH);
  return { nameRowW, nameRowH, stripW, stripTextW, metaH, width: Math.max(nameRowW, stripW) };
}

/** Variants to try for each format, richest first, from the requested format downwards. */
function variantGroups(format: SignatureDisplayFormat, hasRole: boolean): Variant[][] {
  const groups: Variant[][] = [];
  for (let i = rank(format); i >= 1; i--) {
    const f = ORDER[i]!;
    const g: Variant[] = [{ format: f, compact: false, role: hasRole }];
    if (f === 'signature_name_time' || f === 'full')
      g.push({ format: f, compact: true, role: hasRole });
    if (hasRole) g.push({ format: f, compact: true, role: false });
    groups.push(g);
  }
  return groups;
}

/** Computes the signature block for one field. Pure and deterministic. */
export function layoutSignatureBlock(input: BlockInput): BlockLayout {
  const W = input.width;
  const H = input.height;
  const requested: SignatureDisplayFormat =
    input.kind === 'initials' ? 'signature' : (input.format ?? DEFAULT_SIGNATURE_DISPLAY);
  const name = blockSafeText(input.name) || 'Signer';
  const role = blockSafeText(input.role ?? '');
  const tz = input.timestamp.timeZone;
  const P = padding(W, H);
  const innerW = Math.max(0, W - 2 * P);
  const innerH = Math.max(0, H - 2 * P);

  // Within a format, keep the full wording while it stays comfortable to read; otherwise take the
  // shorter variant that draws largest. Only when nothing is legible does the format step down.
  type Pick = { v: Variant; s: number; m: ReturnType<typeof measure> };
  let chosen: Pick | null = null;
  const heightRoom = Math.min(innerH * (1 - SIGNATURE_SHARE), innerH - MIN_SIGNATURE_PT);
  for (const group of variantGroups(requested, Boolean(role))) {
    const options: Pick[] = group.map((v) => {
      const m = measure(v, name, role, tz);
      return { v, m, s: Math.min(1, innerW / m.width, heightRoom / m.metaH) };
    });
    chosen =
      options.find((o) => o.s >= COMFORT_SCALE) ??
      options
        .filter((o) => o.s >= MIN_SCALE)
        .reduce<Pick | null>((best, o) => (!best || o.s > best.s + 1e-9 ? o : best), null);
    if (chosen) break;
  }

  const prims: Primitive[] = [];
  let sealBox: BlockLayout['sealBox'] = null;

  if (!chosen) {
    prims.push({ kind: 'image', x: P, y: P, width: innerW, height: innerH, align: 'center' });
    return {
      width: W,
      height: H,
      requested,
      format: 'signature',
      fits: requested === 'signature',
      compact: false,
      scale: 1,
      primitives: prims,
      sealBox,
    };
  }

  const { v, s, m } = chosen;
  const metaH = m.metaH * s;
  const lineY = H - P - metaH + LINE_PT / 2;
  const x0 = P;
  prims.push({
    kind: 'image',
    x: P,
    y: P,
    width: innerW,
    height: Math.max(0, lineY - P - LINE_PT / 2),
    align: 'left',
  });
  prims.push({
    kind: 'line',
    x1: P,
    y1: lineY,
    x2: W - P,
    y2: lineY,
    thickness: LINE_PT,
    color: BLOCK_COLORS.line,
  });

  // Name | Role
  const nameTop = lineY + LINE_PT / 2 + M.lineGap * s;
  const nameSize = M.name * s;
  const nameBaseline = nameTop + nameSize * 0.86;
  const nameW = textWidth(name, 'serifBold', nameSize);
  prims.push({
    kind: 'text',
    x: x0,
    y: nameBaseline,
    size: nameSize,
    font: 'serifBold',
    color: BLOCK_COLORS.name,
    text: name,
    width: nameW,
  });
  if (v.role && role) {
    const dx = x0 + nameW + M.dividerGap * s;
    prims.push({
      kind: 'line',
      x1: dx,
      y1: nameBaseline - nameSize * 0.74,
      x2: dx,
      y2: nameBaseline + nameSize * 0.1,
      thickness: LINE_PT * Math.max(s, 0.8),
      color: BLOCK_COLORS.divider,
    });
    const roleSize = M.role * s;
    prims.push({
      kind: 'text',
      x: dx + LINE_PT + M.dividerGap * s,
      y: nameBaseline,
      size: roleSize,
      font: 'sans',
      color: BLOCK_COLORS.role,
      text: role,
      width: textWidth(role, 'sans', roleSize),
    });
  }

  // Timestamp strip + seal
  if (rank(v.format) >= rank('signature_name_time')) {
    const withSeal = v.format === 'full';
    const rowTop = nameTop + m.nameRowH * s + M.nameGap * s;
    const rowH = (withSeal ? Math.max(M.stripH, M.seal) : M.stripH) * s;
    const stripH = M.stripH * s;
    const stripY = rowTop + (rowH - stripH) / 2;
    const cy = stripY + stripH / 2;
    const stripW = m.stripW * s;
    prims.push({
      kind: 'rect',
      x: x0,
      y: stripY,
      width: stripW,
      height: stripH,
      radius: stripH * 0.32,
      color: BLOCK_COLORS.strip,
    });
    const iconSize = M.icon * s;
    prims.push({ kind: 'icon', x: x0 + M.stripPadX * s, y: cy - iconSize / 2, size: iconSize });
    const textX = x0 + (M.stripPadX + M.icon + M.iconGap) * s;
    const room = m.stripTextW * s;
    const ts = input.timestamp;
    let text: string;
    let color: string = BLOCK_COLORS.stripText;
    if (ts.state === 'completed') {
      text = formatSigningTime(ts.signedAt, ts.timeZone, v.compact);
    } else {
      text = v.compact ? PENDING_TIME_TEXT_COMPACT : PENDING_TIME_TEXT;
      color = BLOCK_COLORS.pendingText;
    }
    let size = M.stripText * s;
    const natural = textWidth(text, 'sans', size);
    if (natural > room) size *= room / natural; // only ever trims the pending wording
    prims.push({
      kind: 'text',
      x: textX,
      y: cy + size * 0.36,
      size,
      font: 'sans',
      color,
      text,
      width: textWidth(text, 'sans', size),
    });
    if (withSeal) {
      const sepX = textX + room + M.sepGap * s;
      prims.push({
        kind: 'line',
        x1: sepX,
        y1: cy - stripH * 0.3,
        x2: sepX,
        y2: cy + stripH * 0.3,
        thickness: LINE_PT,
        color: BLOCK_COLORS.separator,
      });
      const sealSize = M.seal * s;
      const sealX = sepX + LINE_PT + M.sepGap * s * 0.6;
      const box = { x: sealX, y: cy - sealSize / 2, size: sealSize };
      // The seal is only drawn once the server has recorded the signing event.
      if (ts.state === 'completed') {
        prims.push({
          kind: 'seal',
          ...box,
          variant: sealSize >= SEAL_DETAIL_MIN_PT ? 'full' : 'simple',
        });
        sealBox = box;
      }
    }
  }

  return {
    width: W,
    height: H,
    requested,
    format: v.format,
    fits: v.format === requested,
    compact: v.compact || (Boolean(role) && !v.role),
    scale: s,
    primitives: prims,
    sealBox,
  };
}

/**
 * The smallest field (points) that draws `format` without the compact fallback, at a comfortable
 * scale. Used by the preparation step to offer "Enlarge field".
 */
export function recommendedFieldSize(input: {
  format: SignatureDisplayFormat;
  name: string;
  role?: string | null;
  timeZone?: string | null;
  scale?: number;
}): { width: number; height: number } {
  const s = input.scale ?? 0.85;
  const name = blockSafeText(input.name) || 'Signer';
  const role = blockSafeText(input.role ?? '');
  if (input.format === 'signature') return { width: 120, height: 36 };
  const m = measure(
    { format: input.format, compact: false, role: Boolean(role) },
    name,
    role,
    input.timeZone,
  );
  const innerW = m.width * s;
  const innerH = Math.max((m.metaH * s) / (1 - SIGNATURE_SHARE), m.metaH * s + MIN_SIGNATURE_PT);
  // Padding is at most 6pt each side; add it plus a hair so rounding cannot tip it over.
  return { width: Math.ceil(innerW + 12.5), height: Math.ceil(innerH + 12.5) };
}

/** Human label for a recipient role inside the block. */
export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'signer':
      return 'Signer';
    case 'approver':
      return 'Approver';
    case 'reviewer':
      return 'Reviewer';
    default:
      return role ? role.charAt(0).toUpperCase() + role.slice(1) : '';
  }
}
