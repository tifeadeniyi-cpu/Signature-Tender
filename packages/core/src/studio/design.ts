import { z } from 'zod';
import {
  DEFAULT_PEN_SETTINGS,
  DEFAULT_TEXT_PARAMS,
  ELEMENT_IDS,
  FAMILY_BY_ID,
  FONT_BY_ID,
} from './families';

/**
 * The canonical description of a Signature Studio design. It is the only thing the server
 * stores and renders: previews in the browser and purchased files on the server are both drawn
 * from this document by the same renderer, so they match.
 *
 * Coordinates are in a 1200 x 400 design space. The user's raw drawing is kept as-is (the source
 * of truth); smoothing, pen effects and transforms are applied at render time.
 */
export const CANVAS_W = 1200;
export const CANVAS_H = 400;
export const RENDERER_VERSION = 1;

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a valid ink colour.');
const point = z.tuple([num(-2000, 3200), num(-2000, 2400), num(0, 1)]);

export const penSchema = z.enum([
  'ballpoint',
  'gel',
  'fountain',
  'flex',
  'calligraphy',
  'marker',
  'natural',
  'brush',
]);

export const penSettingsSchema = z.object({
  pressure: num(0, 100),
  opacity: num(0.3, 1),
  texture: num(0, 100),
  taper: num(0, 100),
});

/** Letters, marks and punctuation that appear in names. The fonts cover Latin-1. */
const NAME_RE = /^[\p{L}\p{M} .,'’&-]*$/u;

export const textSchema = z.object({
  value: z
    .string()
    .max(60, 'Keep your signature text to 60 characters.')
    .regex(NAME_RE, 'Use letters, spaces and simple punctuation only.'),
  /** The style preset it started from (null when a font was picked from the library). */
  family: z
    .string()
    .refine((f) => f in FAMILY_BY_ID, 'Unknown style family.')
    .nullable(),
  font: z.string().refine((f) => f in FONT_BY_ID, 'Unknown typeface.'),
  variant: z.number().int().min(0).max(7),
  x: num(-600, 1800).default(0),
  y: num(-400, 800).default(0),
  params: z.object({
    slant: num(-15, 30),
    spacing: num(-0.15, 0.6),
    height: num(0.6, 1.5),
    lower: num(0.7, 1.3),
    wordSpacing: num(0, 1),
    width: num(0.6, 1.6),
    weight: num(0, 3),
    baseline: num(0, 10),
    curve: num(0, 100),
    loop: num(0, 100),
    capitals: num(0.8, 1.9),
    connect: num(0, 1),
    descenders: num(-0.5, 1),
    initForms: z.boolean(),
    finaForms: z.boolean(),
    entry: z.boolean(),
    tail: z.boolean(),
  }),
});

export const strokeSchema = z.object({
  points: z.array(point).min(1).max(4000),
  /** Per-stroke extra smoothing, set by "Smooth selected stroke". */
  smooth: num(0, 1).default(0),
});

export const transformSchema = z.object({
  x: num(-1200, 1200),
  y: num(-400, 400),
  scale: num(0.2, 4),
  rotate: num(-180, 180),
});

/** Smart Stroke settings for a freehand stroke. The raw points are never changed by them. */
export const smartSchema = z.object({
  /** Apply the refinement (false shows the raw stroke: "before"). */
  enabled: z.boolean(),
  smoothing: num(0, 100),
  pressure: num(0, 100),
  taper: num(0, 100),
  /** Curve refinement: fits the stroke to fewer, smoother Bezier segments. */
  refine: num(0, 100),
  /** Take thickness, taper, ink and slant from the signature. */
  match: z.boolean(),
  /** Level the stroke to the signature baseline. */
  align: z.boolean(),
  /** Snap end points to nearby letter outline points. */
  snap: z.boolean(),
});

const anchorSchema = z.object({
  x: num(-3000, 3000),
  y: num(-3000, 3000),
  /** Incoming and outgoing handle offsets. */
  ix: num(-2000, 2000),
  iy: num(-2000, 2000),
  ox: num(-2000, 2000),
  oy: num(-2000, 2000),
});

export const elementSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{4,24}$/),
  type: z.enum(ELEMENT_IDS),
  x: num(-600, 1800),
  y: num(-400, 800),
  /** Width of the element in design units at scale 1 is 600. */
  scale: num(0.1, 3),
  rotate: num(-180, 180),
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
  curve: num(0, 100),
  thickness: num(0.3, 4),
  opacity: num(0.2, 1).default(1),
  /** null means "match the signature ink". */
  color: hex.nullable(),
  /** Freehand: the original points as drawn, relative to the element origin. Never modified. */
  points: z.array(point).max(4000).optional(),
  /** Freehand: Smart Stroke settings. */
  smart: smartSchema.optional(),
  /** Freehand: curve-editor anchors. When present they replace the fitted curve. */
  anchors: z.array(anchorSchema).max(200).optional(),
  /** Freehand: an accepted connection from one end of the stroke to a point on the lettering. */
  connect: z
    .object({ end: z.enum(['start', 'end']), x: num(-3000, 3000), y: num(-3000, 3000) })
    .nullable()
    .optional(),
});

export const uploadSchema = z.object({
  /** SHA-256 of the sanitized PNG kept in private storage. */
  ref: z.string().regex(/^[0-9a-f]{64}$/),
  w: z.number().int().min(1).max(4000),
  h: z.number().int().min(1).max(4000),
  x: num(-1200, 2400),
  y: num(-800, 1200),
  scale: num(0.05, 6),
  rotate: num(-180, 180).default(0),
});

export const designSchema = z.object({
  v: z.literal(1),
  kind: z.enum(['signature', 'initials']),
  method: z.enum(['draw', 'type', 'upload', 'design']),
  ink: hex,
  pen: penSchema,
  penSettings: penSettingsSchema,
  /** Pen width multiplier for strokes and elements, 0.3..4. */
  thickness: num(0.3, 4),
  /** Drawing smoothing, 0..1. */
  smoothing: num(0, 1),
  text: textSchema.nullable(),
  strokes: z.array(strokeSchema).max(300),
  drawing: transformSchema,
  upload: uploadSchema.nullable(),
  elements: z.array(elementSchema).max(40),
});

export type Design = z.infer<typeof designSchema>;
export type DesignText = z.infer<typeof textSchema>;
export type DesignElement = z.infer<typeof elementSchema>;
export type DesignStroke = z.infer<typeof strokeSchema>;
export type Point = [number, number, number];
export type SmartSettings = z.infer<typeof smartSchema>;
export type Anchor = z.infer<typeof anchorSchema>;

export const DEFAULT_SMART: SmartSettings = {
  enabled: true,
  smoothing: 55,
  pressure: 50,
  taper: 50,
  refine: 40,
  match: true,
  align: false,
  snap: true,
};

export function emptyDesign(kind: 'signature' | 'initials' = 'signature'): Design {
  return {
    v: 1,
    kind,
    method: 'type',
    ink: '#0D1B33',
    pen: 'natural',
    penSettings: { ...DEFAULT_PEN_SETTINGS },
    thickness: 1,
    smoothing: 0.5,
    text: {
      value: '',
      family: null,
      font: 'great-vibes',
      variant: 0,
      x: 0,
      y: 0,
      params: { ...DEFAULT_TEXT_PARAMS },
    },
    strokes: [],
    drawing: { x: 0, y: 0, scale: 1, rotate: 0 },
    upload: null,
    elements: [],
  };
}

/** Total stroke points; the server refuses designs above this to bound render cost. */
export const MAX_TOTAL_POINTS = 40000;

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/**
 * Validates and normalizes a design: numbers are rounded so that the same visible design always
 * produces the same canonical form (and hash), and text is trimmed.
 */
export function normalizeDesign(raw: unknown): Design {
  const d = designSchema.parse(raw);
  const total = d.strokes.reduce((n, s) => n + s.points.length, 0) +
    d.elements.reduce((n, e) => n + (e.points?.length ?? 0), 0);
  if (total > MAX_TOTAL_POINTS)
    throw new z.ZodError([
      { code: 'custom', path: ['strokes'], message: 'This drawing has too many points.', input: total },
    ]);
  const rp = (p: Point): Point => [round(p[0], 1), round(p[1], 1), round(p[2], 2)];
  return {
    ...d,
    ink: d.ink.toUpperCase(),
    penSettings: {
      pressure: round(d.penSettings.pressure),
      opacity: round(d.penSettings.opacity),
      texture: round(d.penSettings.texture),
      taper: round(d.penSettings.taper),
    },
    thickness: round(d.thickness),
    smoothing: round(d.smoothing),
    text: d.text
      ? {
          ...d.text,
          value: d.text.value.replace(/\s+/g, ' ').trim(),
          x: round(d.text.x, 1),
          y: round(d.text.y, 1),
          params: Object.fromEntries(
            Object.entries(d.text.params).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]),
          ) as DesignText['params'],
        }
      : null,
    strokes: d.strokes.map((s) => ({ points: s.points.map(rp), smooth: round(s.smooth) })),
    drawing: {
      x: round(d.drawing.x, 1),
      y: round(d.drawing.y, 1),
      scale: round(d.drawing.scale, 3),
      rotate: round(d.drawing.rotate, 1),
    },
    upload: d.upload
      ? {
          ...d.upload,
          x: round(d.upload.x, 1),
          y: round(d.upload.y, 1),
          scale: round(d.upload.scale, 3),
          rotate: round(d.upload.rotate, 1),
        }
      : null,
    elements: d.elements.map((e) => ({
      ...e,
      x: round(e.x, 1),
      y: round(e.y, 1),
      scale: round(e.scale, 3),
      rotate: round(e.rotate, 1),
      curve: round(e.curve, 1),
      thickness: round(e.thickness),
      color: e.color ? e.color.toUpperCase() : null,
      opacity: round(e.opacity),
      ...(e.points ? { points: e.points.map(rp) } : {}),
      ...(e.anchors
        ? {
            anchors: e.anchors.map((a) => ({
              x: round(a.x, 1),
              y: round(a.y, 1),
              ix: round(a.ix, 1),
              iy: round(a.iy, 1),
              ox: round(a.ox, 1),
              oy: round(a.oy, 1),
            })),
          }
        : {}),
      ...(e.connect ? { connect: { ...e.connect, x: round(e.connect.x, 1), y: round(e.connect.y, 1) } } : {}),
    })),
  };
}

/** True when the design has something to render. */
export function hasContent(d: Design): boolean {
  return Boolean(
    (d.text && d.text.value.trim()) || d.strokes.length || d.upload || d.elements.length,
  );
}

/** Stable JSON: object keys sorted, so equal designs serialize identically. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Formats a design can be exported as. SVG is offered only when every layer is true vector. */
export function availableFormats(d: Design): ('png' | 'svg' | 'jpeg')[] {
  return d.upload ? ['png', 'jpeg'] : ['png', 'svg', 'jpeg'];
}

/** Short description of the style for cards and receipts. */
export function styleLabel(d: Design): string {
  if (d.upload) return 'Uploaded signature';
  if (d.text?.value && (d.method === 'type' || d.method === 'design'))
    return (
      (d.text.family && FAMILY_BY_ID[d.text.family]?.label) ||
      FONT_BY_ID[d.text.font]?.name ||
      'Typed signature'
    );
  if (d.strokes.length) return 'Hand-drawn';
  return 'Custom design';
}

/** A new element with sensible defaults, centred at (x, y). */
export function newElement(
  type: DesignElement['type'],
  id: string,
  at: { x: number; y: number; scale?: number },
): DesignElement {
  return {
    id,
    type,
    x: at.x,
    y: at.y,
    scale: at.scale ?? 0.8,
    rotate: 0,
    flipX: false,
    flipY: false,
    curve: 50,
    thickness: 1,
    opacity: 1,
    color: null,
  };
}
