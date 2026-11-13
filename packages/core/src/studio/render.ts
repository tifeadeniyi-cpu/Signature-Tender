import { CANVAS_H, CANVAS_W, DEFAULT_SMART, type Design, type DesignElement, type Point } from './design';
import { FONT_BY_ID, type ElementType } from './families';
import {
  chain,
  cubic,
  emptyBox,
  f1,
  grow,
  hashString,
  merge,
  ribbon,
  sampleAnchors,
  simplify,
  smoothStroke,
  transform,
  type Box,
  type P,
  type PenStyle,
} from './geometry';

/** The parts of an opentype.js Glyph/Font the renderer needs. */
export interface GlyphLike {
  index: number;
  advanceWidth?: number;
  unicode?: number;
  getPath(x: number, y: number, size: number): { commands: PathCommand[] };
}
export interface FontLike {
  unitsPerEm: number;
  charToGlyph(c: string): GlyphLike;
  charToGlyphIndex(c: string): number;
  getKerningValue(a: GlyphLike, b: GlyphLike): number;
  glyphs: { get(i: number): GlyphLike };
  substitution?: { getSingle(feature: string, script: string, lang: string): { sub: number; by: number }[] | undefined };
}
type PathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

export interface FontProvider {
  get(id: string): FontLike | undefined;
}

export interface RenderedPath {
  d: string;
  fill: string;
  opacity?: number;
  /** Extra outline weight for typed text (same colour). */
  stroke?: number;
  /** Dry-ink texture 1..10. */
  texture?: number;
  /** Which layer drew it: 'text', 'drawing' or an element id. */
  layer: string;
}
export interface RenderedImage {
  ref: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
}
/** What Smart Stroke reads from the lettering: measured from the real glyph outlines. */
export interface TextInfo {
  baseY: number;
  size: number;
  slant: number;
  /** Mean stroke width of the lettering (2 x area / perimeter of the outlines). */
  weight: number;
  /** On-curve outline points, for snapping and connecting strokes. */
  anchors: [number, number][];
}
export interface Rendered {
  paths: RenderedPath[];
  images: RenderedImage[];
  bounds: Box;
  boxes: { text?: Box; drawing?: Box; upload?: Box; elements: Record<string, Box> };
  text?: TextInfo;
  /** Characters the selected font does not contain (shown as a warning, never substituted). */
  missingChars: string[];
  /** Fonts that were needed but not loaded yet (the caller loads them and renders again). */
  missingFonts: string[];
}

const TEXT_BASE = 150;

/** Which layers a creation method shows. "Custom design" combines all of them. */
export function layersFor(method: Design['method']) {
  return {
    text: method === 'type' || method === 'design',
    strokes: method === 'draw' || method === 'design',
    upload: method === 'upload' || method === 'design',
  };
}

const penStyle = (d: Design): PenStyle => ({
  pen: d.pen,
  pressure: d.penSettings.pressure,
  taper: d.penSettings.taper,
});

function penExtraWeight(pen: Design['pen']): number {
  return { ballpoint: 0, gel: 0.25, fountain: 0, flex: 0, calligraphy: 0.1, marker: 0.55, natural: 0.1, brush: 0.7 }[pen];
}

/**
 * Renders a design to vector paths. Pure and deterministic: the same design and fonts always
 * produce identical output, in the browser (editor, previews) and on the server (exports).
 */
export function renderDesign(d: Design, fonts: FontProvider): Rendered {
  const out: Rendered = {
    paths: [],
    images: [],
    bounds: emptyBox(),
    boxes: { elements: {} },
    missingChars: [],
    missingFonts: [],
  };
  const layers = layersFor(d.method);
  const texture = d.penSettings.texture > 0 ? Math.max(1, Math.round(d.penSettings.texture / 10)) : undefined;
  const opacity = d.penSettings.opacity < 1 ? d.penSettings.opacity : undefined;
  const style = penStyle(d);
  const common = { ...(texture ? { texture } : {}), ...(opacity ? { opacity } : {}) };

  if (layers.upload && d.upload) {
    const u = d.upload;
    const w = u.w * u.scale;
    const h = u.h * u.scale;
    const box = emptyBox();
    const corners: P[] = [
      [0, 0, 0],
      [w, 0, 0],
      [w, h, 0],
      [0, h, 0],
    ];
    for (const [x, y] of transform(corners, { x: u.x, y: u.y, scale: 1, rotate: u.rotate }, [w / 2, h / 2]))
      grow(box, x, y);
    out.images.push({ ref: u.ref, x: u.x, y: u.y, w, h, rotate: u.rotate });
    out.boxes.upload = box;
    merge(out.bounds, box);
  }

  if (layers.text && d.text && d.text.value.trim()) {
    const font = fonts.get(d.text.font);
    if (!font) out.missingFonts.push(d.text.font);
    else {
      const box = emptyBox();
      const t = renderText(d, font, box, style);
      out.missingChars = t.missing;
      if (t.glyphs)
        out.paths.push({ d: t.glyphs, fill: d.ink, stroke: t.stroke, layer: 'text', ...common });
      for (const extra of t.extras) out.paths.push({ d: extra, fill: d.ink, layer: 'text', ...common });
      out.boxes.text = box;
      out.text = t.info;
      merge(out.bounds, box);
    }
  }

  if (layers.strokes && d.strokes.length) {
    const box = emptyBox();
    const base = 4.2 * d.thickness;
    const origin: [number, number] = [CANVAS_W / 2, CANVAS_H / 2];
    let dPath = '';
    for (const s of d.strokes) {
      const sm = smoothStroke(s.points as P[], Math.min(1, d.smoothing + s.smooth));
      const pts = transform(sm, d.drawing, origin);
      dPath += ribbon(pts, base * d.drawing.scale, style, box);
    }
    if (dPath) out.paths.push({ d: dPath, fill: d.ink, layer: 'drawing', ...common });
    out.boxes.drawing = box;
    merge(out.bounds, box);
  }

  for (const e of d.elements) {
    const box = emptyBox();
    const path = renderElement(e, d, out.text, box);
    if (path) {
      const matched = e.type === 'freehand' && e.smart?.enabled && e.smart.match;
      const op = e.opacity < 1 ? e.opacity : opacity;
      out.paths.push({
        d: path,
        fill: matched ? d.ink : (e.color ?? d.ink),
        layer: e.id,
        ...(texture ? { texture } : {}),
        ...(op ? { opacity: op } : {}),
      });
    }
    out.boxes.elements[e.id] = box;
    merge(out.bounds, box);
  }
  return out;
}

const substitutions = new WeakMap<FontLike, { init: Map<number, number>; fina: Map<number, number> }>();
function altMaps(font: FontLike) {
  let m = substitutions.get(font);
  if (!m) {
    const get = (feat: string) => {
      const map = new Map<number, number>();
      for (const script of ['latn', 'DFLT']) {
        try {
          for (const s of font.substitution?.getSingle(feat, script, 'dflt') ?? []) map.set(s.sub, s.by);
        } catch {
          // Lookup types opentype.js cannot read are simply not offered.
        }
        if (map.size) break;
      }
      return map;
    };
    m = { init: get('init'), fina: get('fina') };
    substitutions.set(font, m);
  }
  return m;
}

/** Real alternate letterforms a font contains, so the editor only offers what exists. */
export function fontAlternates(font: FontLike) {
  const m = altMaps(font);
  return { init: m.init.size > 0, fina: m.fina.size > 0 };
}

/** Characters in `text` the font has no glyph for. */
export function unsupportedChars(font: FontLike, text: string): string[] {
  const out = new Set<string>();
  for (const ch of text) if (ch.trim() && font.charToGlyphIndex(ch) === 0) out.add(ch);
  return [...out];
}

/** Lays out typed text from real glyph outlines, then adds entry and exit strokes. */
function renderText(d: Design, font: FontLike, box: Box, style: PenStyle) {
  const text = d.text!;
  const p = text.params;
  const meta = FONT_BY_ID[text.font];
  const upm = font.unitsPerEm || 1000;
  const seed = (hashString(`${text.value}|${text.font}`) % 1000) / 100;
  const skew = Math.tan((p.slant * Math.PI) / 180);
  const alts = altMaps(font);
  const missing = unsupportedChars(font, text.value);

  type Placed = { glyph: GlyphLike; x: number; size: number; sx: number; dy: number };
  const layout = (size: number) => {
    const placed: Placed[] = [];
    let x = 0;
    let i = 0;
    const words = text.value.split(' ');
    words.forEach((word, wi) => {
      const chars = [...word].filter((c) => font.charToGlyphIndex(c) !== 0);
      const glyphs = chars.map((c, ci) => {
        let g = font.charToGlyph(c);
        if (ci === 0 && p.initForms && alts.init.has(g.index)) g = font.glyphs.get(alts.init.get(g.index)!);
        else if (ci === chars.length - 1 && p.finaForms && alts.fina.has(g.index))
          g = font.glyphs.get(alts.fina.get(g.index)!);
        return { g, c };
      });
      glyphs.forEach(({ g, c }, gi) => {
        const isCap = gi === 0 && /\p{Lu}/u.test(c);
        const isLower = /\p{Ll}/u.test(c);
        const k = isCap ? p.capitals : isLower ? p.lower : 1;
        if (gi > 0) x += font.getKerningValue(glyphs[gi - 1]!.g, g) * (size / upm) * p.width;
        const dy =
          p.baseline * size * 0.006 * Math.sin(i * 1.7 + seed) +
          p.baseline * size * 0.004 * Math.sin(i * 0.53 + seed * 2.3);
        placed.push({ glyph: g, x, size: size * k, sx: p.width, dy });
        const adv = ((g.advanceWidth ?? upm * 0.5) * size * k) / upm;
        x += adv * p.width * (isCap ? 0.94 : 1) + p.spacing * size * 0.3 - p.connect * size * 0.05;
        i++;
      });
      if (wi < words.length - 1) x += size * p.wordSpacing * p.width + p.spacing * size * 0.3;
    });
    return { placed, width: x };
  };

  let size = TEXT_BASE * (meta?.scale ?? 1) * p.height;
  let laid = layout(size);
  const maxW = CANVAS_W - 160;
  if (laid.width > maxW) {
    size *= maxW / laid.width;
    laid = layout(size);
  }
  const ox = CANVAS_W / 2 - laid.width / 2 + text.x;
  const baseY = CANVAS_H * 0.62 + text.y;

  const tx = (x: number, y: number, dy: number) => {
    let gy = y;
    let gx = x;
    if (gy > 0 && p.descenders !== 0) {
      gx += gy * Math.max(0, p.descenders) * 0.35;
      gy *= 1 + p.descenders * 0.7;
    }
    const Y = baseY + dy + gy;
    const X = ox + gx - (gy + dy) * skew;
    return [X, Y] as const;
  };
  const weight = (p.weight + penExtraWeight(d.pen)) * size * 0.012 * d.thickness;
  let glyphs = '';
  let firstLeft = Infinity;
  let firstTop = Infinity;
  let firstTopX = 0;
  let lastRight = -Infinity;
  const anchors: [number, number][] = [];
  // Outline measurements for Smart Stroke: signed area and perimeter of the flattened contours.
  let area = 0;
  let perimeter = 0;
  for (const g of laid.placed) {
    const path = g.glyph.getPath(0, 0, g.size);
    let cx = 0,
      cy = 0,
      sx0 = 0,
      sy0 = 0,
      contourArea = 0;
    const seg = (x: number, y: number) => {
      contourArea += cx * y - x * cy;
      perimeter += Math.hypot(x - cx, y - cy);
      cx = x;
      cy = y;
    };
    for (const c of path.commands) {
      if (c.type === 'Z') {
        seg(sx0, sy0);
        area += contourArea / 2;
        contourArea = 0;
        glyphs += 'Z';
        continue;
      }
      const pt = (x: number, y: number) => {
        const [X, Y] = tx(g.x + x * g.sx, y, g.dy);
        grow(box, X, Y, weight / 2);
        if (g === laid.placed[0]) {
          firstLeft = Math.min(firstLeft, X);
          if (Y < firstTop) {
            firstTop = Y;
            firstTopX = X;
          }
        }
        lastRight = Math.max(lastRight, X);
        return [X, Y] as const;
      };
      const s = (q: readonly [number, number]) => `${f1(q[0])} ${f1(q[1])}`;
      if (c.type === 'M') {
        const q = pt(c.x, c.y);
        cx = sx0 = q[0];
        cy = sy0 = q[1];
        anchors.push([q[0], q[1]]);
        glyphs += `M${s(q)}`;
      } else if (c.type === 'L') {
        const q = pt(c.x, c.y);
        seg(q[0], q[1]);
        anchors.push([q[0], q[1]]);
        glyphs += `L${s(q)}`;
      } else if (c.type === 'Q') {
        const c1 = pt(c.x1, c.y1);
        const q = pt(c.x, c.y);
        const [x0, y0] = [cx, cy];
        for (let k = 1; k <= 6; k++) {
          const t = k / 6;
          const u = 1 - t;
          seg(u * u * x0 + 2 * u * t * c1[0] + t * t * q[0], u * u * y0 + 2 * u * t * c1[1] + t * t * q[1]);
        }
        anchors.push([q[0], q[1]]);
        glyphs += `Q${s(c1)} ${s(q)}`;
      } else if (c.type === 'C') {
        const c1 = pt(c.x1, c.y1);
        const c2 = pt(c.x2, c.y2);
        const q = pt(c.x, c.y);
        const [x0, y0] = [cx, cy];
        for (let k = 1; k <= 6; k++) {
          const t = k / 6;
          const u = 1 - t;
          seg(
            u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * q[0],
            u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * q[1],
          );
        }
        anchors.push([q[0], q[1]]);
        glyphs += `C${s(c1)} ${s(c2)} ${s(q)}`;
      }
    }
  }
  const outlineWeight = perimeter > 0 ? (2 * Math.abs(area)) / perimeter : size * 0.04;

  const extras: string[] = [];
  const curve = p.curve / 100;
  const loop = p.loop / 100;
  const pen = Math.max(1.6, outlineWeight * 1.1 + weight * 0.5) * d.thickness;
  if (p.entry && isFinite(firstLeft)) {
    // A sweeping entrance from below the baseline up into the top of the first letter,
    // optionally passing through a loop.
    const x0 = firstTopX;
    const top = firstTop + size * 0.04;
    const start: P = [Math.min(firstLeft, x0) - size * (0.45 + curve * 0.3), baseY + size * 0.12, 0.15];
    const seg: P[][] = [];
    if (loop > 0.35) {
      const r = size * (0.1 + loop * 0.12);
      const lx = x0 - size * 0.42;
      const ly = baseY - size * 0.3;
      seg.push(cubic(start, [start[0] + size * 0.25, start[1] + size * 0.02, 0.4], [lx + r * 1.2, ly + r * 1.1, 0.6], [lx + r, ly, 0.7]));
      seg.push(cubic([lx + r, ly, 0.7], [lx + r * 0.9, ly - r * 1.3, 0.7], [lx - r * 1.1, ly - r * 1.2, 0.6], [lx - r * 0.9, ly, 0.5]));
      seg.push(cubic([lx - r * 0.9, ly, 0.5], [lx - r * 0.7, ly + r * 1.1, 0.5], [x0 - size * 0.3, top - size * 0.05, 0.6], [x0, top, 0.3]));
    } else {
      seg.push(
        cubic(
          start,
          [x0 - size * (0.25 + curve * 0.15), baseY + size * 0.1, 0.6],
          [x0 - size * (0.15 + curve * 0.2), top - size * (0.1 + curve * 0.15), 0.7],
          [x0, top, 0.3],
        ),
      );
    }
    const pts = chain(...seg);
    anchors.push([pts[0]![0], pts[0]![1]]);
    extras.push(ribbon(pts, pen, style, box));
  }
  if (p.tail && isFinite(lastRight)) {
    const x0 = lastRight - size * 0.04;
    const y0 = baseY - size * 0.05;
    const seg: P[][] = [];
    const endX = x0 + size * (0.7 + curve * 0.5);
    if (loop > 0.45) {
      const r = size * (0.08 + loop * 0.1);
      const lx = x0 + size * 0.35;
      seg.push(cubic([x0, y0, 0.6], [x0 + size * 0.15, y0 + size * 0.12, 0.6], [lx, y0 + r, 0.6], [lx + r, y0, 0.6]));
      seg.push(cubic([lx + r, y0, 0.6], [lx + r * 1.6, y0 - r * 1.6, 0.5], [lx - r * 0.8, y0 - r * 1.5, 0.5], [lx, y0 + r * 0.2, 0.5]));
      seg.push(cubic([lx, y0 + r * 0.2, 0.5], [lx + r, y0 + r * 1.2, 0.5], [endX - size * 0.2, y0 - size * curve * 0.1, 0.4], [endX, y0 - size * (0.15 + curve * 0.25), 0.2]));
    } else {
      seg.push(
        cubic(
          [x0, y0, 0.6],
          [x0 + size * 0.25, y0 + size * (0.12 + curve * 0.1), 0.6],
          [endX - size * 0.3, y0 + size * 0.05, 0.4],
          [endX, y0 - size * (0.12 + curve * 0.3), 0.15],
        ),
      );
    }
    const pts = chain(...seg);
    anchors.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1]]);
    extras.push(ribbon(pts, pen * 0.85, style, box));
  }
  return {
    glyphs,
    stroke: weight > 0.05 ? Math.round(weight * 100) / 100 : undefined,
    extras,
    missing,
    info: {
      baseY,
      size,
      slant: p.slant,
      weight: Math.round((outlineWeight + weight) * 100) / 100,
      anchors: dedupe(anchors),
    } satisfies TextInfo,
  };
}

function dedupe(pts: [number, number][]): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [x, y] of pts) {
    const k = `${Math.round(x / 4)},${Math.round(y / 4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([x, y]);
  }
  return out;
}

const pt = (x: number, y: number, p = 0.5): P => [x, y, p];

function ellipse(rx: number, ry: number, from: number, sweep: number, shrink = 0.06, n = 64, cx = 0, cy = 0): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + (sweep * i) / n;
    const k = i / n;
    out.push([cx + Math.cos(t) * rx * (1 - k * shrink), cy + Math.sin(t) * ry * (1 - k * shrink), 0.35 + 0.4 * Math.sin(k * Math.PI)]);
  }
  return out;
}

/** A loop of radius r placed on a horizontal line at (cx, 0), entered from the left. */
function loopAt(cx: number, r: number, up = true): P[][] {
  const s = up ? -1 : 1;
  return [
    cubic(pt(cx - r * 1.4, 0, 0.6), pt(cx, 0, 0.6), pt(cx + r * 1.3, s * r * 0.4), pt(cx + r * 1.1, s * r * 1.2, 0.6)),
    cubic(pt(cx + r * 1.1, s * r * 1.2, 0.6), pt(cx + r * 0.8, s * r * 2.3), pt(cx - r * 1.2, s * r * 2.1), pt(cx - r * 0.6, s * r * 0.9, 0.5)),
    cubic(pt(cx - r * 0.6, s * r * 0.9, 0.5), pt(cx - r * 0.2, s * r * 0.1), pt(cx + r * 0.8, 0), pt(cx + r * 2, 0, 0.5)),
  ];
}

/** Centre lines for each signature element, in a local space about 600 units wide. */
export function elementLines(type: ElementType, curve: number, points?: Point[]): { lines: P[][]; weight: number } {
  const c = curve / 100;
  const w = (lines: P[][], weight = 1) => ({ lines, weight });
  switch (type) {
    case 'u-straight':
      return w([cubic(pt(-300, 2, 0.4), pt(-100, 2 + 6 * c), pt(100, -2 - 6 * c), pt(300, -4, 0.3))]);
    case 'u-thin-curve':
      return w([cubic(pt(-300, -10 - 20 * c, 0.4), pt(-110, 25 + 45 * c, 0.6), pt(110, 25 + 45 * c, 0.6), pt(300, -15 - 30 * c, 0.3))], 0.55);
    case 'u-long-sweep':
      return w([cubic(pt(-420, 30, 0.3), pt(-100, 60 + 50 * c, 0.8), pt(200, 10, 0.6), pt(440, -50 - 60 * c, 0.1))]);
    case 'u-rising':
      return w([cubic(pt(-300, 40, 0.5), pt(-80, 40 + 30 * c, 0.6), pt(120, 0 - 10 * c, 0.5), pt(320, -60 - 30 * c, 0.2))]);
    case 'u-descending':
      return w([cubic(pt(-300, -40, 0.5), pt(-80, -40 - 30 * c, 0.6), pt(120, 0 + 10 * c, 0.5), pt(320, 50 + 25 * c, 0.2))]);
    case 'u-double':
      return w([
        cubic(pt(-300, -6, 0.4), pt(-100, 10 + 20 * c), pt(100, 10 + 20 * c), pt(300, -10 - 10 * c, 0.3)),
        cubic(pt(-220, 22, 0.4), pt(-60, 34 + 16 * c), pt(120, 34 + 16 * c), pt(250, 16 - 8 * c, 0.3)),
      ]);
    case 'u-crossed':
      return w([
        cubic(pt(-300, 30, 0.4), pt(-100, 20 + 20 * c), pt(100, -10 - 20 * c), pt(300, -40, 0.2)),
        cubic(pt(-260, -30, 0.4), pt(-80, -10 + 10 * c), pt(120, 20 + 20 * c), pt(300, 40, 0.2)),
      ]);
    case 'u-looping':
      return w([chain(cubic(pt(-300, 0, 0.4), pt(-150, 10 + 8 * c), pt(0, 6), pt(110, 0, 0.6)), ...loopAt(180, 24 + 26 * c))]);
    case 'u-initial': {
      const r = 26 + 30 * c;
      return w([chain(...loopAt(-260, r, false), cubic(pt(-260 + r * 2, 0, 0.5), pt(-50, 6 + 10 * c), pt(150, 4), pt(320, -10, 0.2)))]);
    }
    case 'u-final':
      return w([cubic(pt(-300, -30, 0.6), pt(-60, 20 + 30 * c, 0.6), pt(250, 20, 0.4), pt(460, -40 - 50 * c, 0.05))]);
    case 'u-s-curve':
      return w([
        chain(
          cubic(pt(-300, 0, 0.4), pt(-220, -40 * c - 10), pt(-120, 40 * c + 10, 0.6), pt(0, 0, 0.6)),
          cubic(pt(0, 0, 0.6), pt(120, -40 * c - 10, 0.6), pt(220, 40 * c + 10), pt(300, -10, 0.3)),
        ),
      ]);
    case 'u-fountain':
      // A swell in the middle, like pressing a fountain pen and releasing.
      return w([cubic(pt(-300, 6, 0.05), pt(-100, 14 + 10 * c, 1), pt(100, 10 + 10 * c, 1), pt(300, -8, 0.05))], 1.4);
    case 'u-wave': {
      const out: P[] = [];
      for (let i = 0; i <= 120; i++) {
        const x = -300 + (600 * i) / 120;
        out.push([x, Math.sin((i / 120) * Math.PI * 6) * (8 + 18 * c), 0.5]);
      }
      return w([out]);
    }
    case 'u-sharp-end':
      return w([cubic(pt(-300, 0, 0.9), pt(-80, 8 + 8 * c, 0.8), pt(160, 2, 0.4), pt(340, -14 - 14 * c, 0))], 1.2);
    case 'u-tail':
      return w([
        chain(
          cubic(pt(-300, 0, 0.5), pt(-100, 26 + 20 * c), pt(120, 26 + 26 * c, 0.6), pt(230, -10, 0.5)),
          cubic(pt(230, -10, 0.5), pt(270, -50 - 40 * c, 0.4), pt(200, -70 - 40 * c, 0.3), pt(190, -40, 0.15)),
        ),
      ]);
    case 'l-circle':
      return w([ellipse(80, 80, -Math.PI * 0.6, Math.PI * 2 * (1.08 + 0.1 * c))]);
    case 'l-open':
      return w([ellipse(85, 75, Math.PI * 0.35, Math.PI * (1.45 + 0.25 * c), 0.02)]);
    case 'l-closed':
      return w([chain(cubic(pt(-200, 60, 0.3), pt(-100, 60), pt(80, 30, 0.6), pt(60, -40, 0.6)), cubic(pt(60, -40, 0.6), pt(40, -120 - 40 * c), pt(-120, -100 - 30 * c), pt(-60, -10, 0.6)), cubic(pt(-60, -10, 0.6), pt(-20, 50), pt(120, 60), pt(220, 50, 0.3)))]);
    case 'l-oval':
      return w([ellipse(150, 55, -Math.PI * 0.6, Math.PI * 2 * (1.08 + 0.12 * c))]);
    case 'l-extended':
      return w([chain(cubic(pt(-320, 30, 0.3), pt(-150, 40), pt(250, 40 + 10 * c, 0.6), pt(260, -10, 0.6)), cubic(pt(260, -10, 0.6), pt(270, -70 - 30 * c), pt(-260, -70 - 30 * c, 0.5), pt(-200, 0, 0.5)), cubic(pt(-200, 0, 0.5), pt(-150, 50), pt(150, 50), pt(330, 30, 0.2)))]);
    case 'l-double': {
      const r = 30 + 20 * c;
      const c1 = -120;
      const c2 = c1 + r * 3.4;
      return w([chain(cubic(pt(-300, 0, 0.4), pt(-250, 0), pt(-200, 0), pt(c1 - r * 1.4, 0, 0.5)), ...loopAt(c1, r), ...loopAt(c2, r), cubic(pt(c2 + r * 2, 0, 0.5), pt(c2 + r * 3, 0), pt(260, -6), pt(320, -10, 0.2)))]);
    }
    case 'l-descender':
      return w([chain(cubic(pt(0, -60, 0.4), pt(10, 0), pt(30, 120 + 60 * c, 0.7), pt(-10, 160 + 60 * c, 0.6)), cubic(pt(-10, 160 + 60 * c, 0.6), pt(-60, 190 + 60 * c), pt(-80, 120), pt(-20, 60, 0.5)), cubic(pt(-20, 60, 0.5), pt(40, 10), pt(160, 0), pt(260, 10, 0.2)))]);
    case 'l-initial':
      return w([chain(...loopAt(-230, 45 + 35 * c), cubic(pt(-230 + (45 + 35 * c) * 2, 0, 0.5), pt(-40, 0), pt(150, 4), pt(300, 0, 0.2)))]);
    case 'l-ending':
      return w([chain(cubic(pt(-300, 0, 0.4), pt(-100, 6), pt(80, 4), pt(150, 0, 0.6)), ...loopAt(210, 40 + 30 * c))]);
    case 'f-opening': {
      const r = 40 + 40 * c;
      return w([
        chain(
          cubic(pt(-300, 40, 0.2), pt(-240, 40, 0.5), pt(-180 + r, -10, 0.7), pt(-180 + r, -60, 0.7)),
          cubic(pt(-180 + r, -60, 0.7), pt(-180 + r, -60 - r * 1.3), pt(-180 - r, -60 - r * 1.3), pt(-180 - r * 0.5, -40, 0.6)),
          cubic(pt(-180 - r * 0.5, -40, 0.6), pt(-120, 20, 0.5), pt(40, 20 + 20 * c, 0.5), pt(300, 0, 0.2)),
        ),
      ]);
    }
    case 'f-closing':
      return w([
        chain(
          cubic(pt(-300, 0, 0.5), pt(-100, 30 + 20 * c), pt(120, 30 + 30 * c, 0.6), pt(220, -20, 0.6)),
          cubic(pt(220, -20, 0.6), pt(280, -80 - 50 * c, 0.5), pt(120, -100 - 40 * c, 0.4), pt(150, -40, 0.2)),
        ),
      ]);
    case 'f-curved-tail':
      return w([cubic(pt(-300, -20, 0.6), pt(-50, 40 + 40 * c, 0.6), pt(200, 40, 0.3), pt(320, -40 - 40 * c, 0.05))]);
    case 'f-rising-tail':
      return w([cubic(pt(-300, 40, 0.6), pt(-80, 50 + 20 * c, 0.6), pt(150, 0, 0.3), pt(300, -120 - 60 * c, 0.05))]);
    case 'f-descending-tail':
      return w([cubic(pt(-300, -30, 0.6), pt(-60, -20 - 20 * c, 0.6), pt(160, 20, 0.3), pt(300, 120 + 60 * c, 0.05))]);
    case 'f-spiral': {
      const out: P[] = [];
      const turns = 2.2 + c;
      for (let i = 0; i <= 160; i++) {
        const k = i / 160;
        const a = k * turns * Math.PI * 2;
        const r = 8 + k * 90;
        out.push([Math.cos(a) * r, Math.sin(a) * r * 0.8, 0.3 + 0.5 * k]);
      }
      return w([out]);
    }
    case 'f-swoosh':
      return w([cubic(pt(-320, 30, 0.3), pt(-60, 60 + 60 * c, 0.9), pt(160, 10, 0.6), pt(340, -60 - 70 * c, 0.05))], 1.3);
    case 'f-connector':
      return w([
        chain(
          cubic(pt(-300, 20, 0.3), pt(-240, 30), pt(-220, -10, 0.6), pt(-180, -20, 0.6)),
          cubic(pt(-180, -20, 0.6), pt(-80, -70 - 60 * c, 0.6), pt(80, -70 - 60 * c, 0.6), pt(180, -20, 0.6)),
          cubic(pt(180, -20, 0.6), pt(220, -10, 0.6), pt(240, 30), pt(300, 20, 0.3)),
        ),
      ]);
    case 'f-pen-trail':
      return w([cubic(pt(-300, 0, 0.6), pt(0, 10 + 14 * c, 0.4), pt(300, 6, 0.2), pt(520, -14 - 20 * c, 0.02))], 0.7);
    case 'freehand':
      return w(points && points.length ? [points.map((q) => [...q] as P)] : []);
  }
}

/** Raw freehand points in design space (before any Smart Stroke refinement). */
export function freehandRaw(e: DesignElement): P[] {
  return transform((e.points ?? []) as P[], { x: e.x, y: e.y, scale: e.scale, rotate: e.rotate, flipX: e.flipX, flipY: e.flipY });
}

/**
 * Smart Stroke: refines a freehand stroke without touching the original points. Smoothing and
 * curve refinement fit a smoother curve while keeping corners (Douglas-Peucker keeps turning
 * points); "match" takes slant from the lettering; "align" levels the stroke onto the baseline;
 * "snap" pulls end points onto nearby letter outline points.
 */
export function smartStrokePoints(e: DesignElement, text: TextInfo | undefined): P[] {
  const s = e.smart ?? DEFAULT_SMART;
  let pts = freehandRaw(e);
  if (e.anchors?.length) {
    pts = sampleAnchors(e.anchors.map((a) => ({ ...a, x: a.x, y: a.y })));
    pts = transform(pts, { x: e.x, y: e.y, scale: e.scale, rotate: e.rotate, flipX: e.flipX, flipY: e.flipY });
  } else if (s.enabled && pts.length > 2) {
    pts = smoothStroke(pts, s.smoothing / 100);
    if (s.refine > 0) {
      const idx = simplify(pts, 0.5 + (s.refine / 100) * 6);
      const kept = idx.map((i) => pts[i]!);
      pts = kept.length > 2 ? smoothStroke(kept, 0) : kept;
    }
  }
  if (!s.enabled || pts.length < 2) return withConnection(pts, e);
  if (s.align && text) {
    const [x0, y0] = pts[0]!;
    const [x1, y1] = pts[pts.length - 1]!;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const level = Math.abs(ang) < Math.PI / 4 ? -ang : 0;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    pts = transform(pts, { x: 0, y: 0, scale: 1, rotate: (level * 180) / Math.PI }, [cx, cy]);
    const meanY = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    const target = text.baseY + text.size * 0.18;
    if (Math.abs(meanY - target) < text.size * 0.6) pts = pts.map(([x, y, p]) => [x, y + (target - meanY), p]);
  }
  if (s.match && text && text.slant) {
    const k = Math.tan((text.slant * Math.PI) / 180) * 0.5;
    pts = pts.map(([x, y, p]) => [x - (y - text.baseY) * k, y, p]);
  }
  if (s.snap && text && text.anchors.length) {
    const radius = Math.max(18, text.size * 0.18);
    const snapEnd = (end: 'start' | 'end') => {
      const i = end === 'start' ? 0 : pts.length - 1;
      const near = nearestAnchor(text.anchors, pts[i]![0], pts[i]![1], radius);
      if (!near) return;
      const dx = near[0] - pts[i]![0];
      const dy = near[1] - pts[i]![1];
      const span = Math.max(2, Math.floor(pts.length * 0.15));
      pts = pts.map((q, j) => {
        const dist = end === 'start' ? j : pts.length - 1 - j;
        if (dist > span) return q;
        const f = 1 - dist / span;
        const e2 = f * f * (3 - 2 * f);
        return [q[0] + dx * e2, q[1] + dy * e2, q[2]];
      });
    };
    snapEnd('start');
    snapEnd('end');
  }
  return withConnection(pts, e);
}

function withConnection(pts: P[], e: DesignElement): P[] {
  if (!e.connect || pts.length < 2) return pts;
  const atStart = e.connect.end === 'start';
  const end = atStart ? pts[0]! : pts[pts.length - 1]!;
  const nb = atStart ? pts[Math.min(3, pts.length - 1)]! : pts[Math.max(0, pts.length - 4)]!;
  // Leave the stroke along its own direction, then curve into the letter point.
  const dx = end[0] - nb[0];
  const dy = end[1] - nb[1];
  const len = Math.hypot(dx, dy) || 1;
  const reach = Math.hypot(e.connect.x - end[0], e.connect.y - end[1]) * 0.45;
  const c1: P = [end[0] + (dx / len) * reach, end[1] + (dy / len) * reach, end[2]];
  const target: P = [e.connect.x, e.connect.y, 0.35];
  const c2: P = [(c1[0] + target[0]) / 2, (c1[1] + target[1]) / 2, 0.45];
  const bridge = cubic(end, c1, c2, target, 20);
  return atStart ? [...bridge.reverse().slice(0, -1), ...pts] : [...pts, ...bridge.slice(1)];
}

export function nearestAnchor(anchors: [number, number][], x: number, y: number, radius: number) {
  let best: [number, number] | null = null;
  let bd = radius;
  for (const a of anchors) {
    const d = Math.hypot(a[0] - x, a[1] - y);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

/**
 * "Connect to Signature": proposes a joining point on the lettering for the stroke end that is
 * nearest to it. Returns null when nothing is close enough, so unrelated strokes never connect.
 */
export function suggestConnection(e: DesignElement, text: TextInfo | undefined) {
  if (!text || e.type !== 'freehand') return null;
  const pts = smartStrokePoints({ ...e, connect: null }, text);
  if (pts.length < 2) return null;
  const radius = text.size * 1.1;
  const options = (['start', 'end'] as const)
    .map((end) => {
      const q = end === 'start' ? pts[0]! : pts[pts.length - 1]!;
      const a = nearestAnchor(text.anchors, q[0], q[1], radius);
      return a ? { end, x: a[0], y: a[1], d: Math.hypot(a[0] - q[0], a[1] - q[1]) } : null;
    })
    .filter((o): o is NonNullable<typeof o> => o !== null && o.d > 3)
    .sort((a, b) => a.d - b.d);
  return options[0] ? { end: options[0].end, x: Math.round(options[0].x * 10) / 10, y: Math.round(options[0].y * 10) / 10 } : null;
}

export function renderElement(e: DesignElement, d: Design, text: TextInfo | undefined, box: Box): string {
  const style: PenStyle = { pen: d.pen, pressure: d.penSettings.pressure, taper: d.penSettings.taper };
  if (e.type === 'freehand') {
    const s = e.smart;
    const pts = smartStrokePoints(e, text);
    const smartStyle: PenStyle = s?.enabled ? { pen: d.pen, pressure: s.pressure, taper: s.taper } : style;
    const base =
      s?.enabled && s.match && text ? Math.max(1.2, text.weight * 0.75) * e.thickness : 3.6 * e.thickness * d.thickness;
    return ribbon(pts, base, smartStyle, box);
  }
  const { lines, weight } = elementLines(e.type, e.curve, e.points);
  const base = 3.6 * weight * e.thickness * d.thickness * Math.sqrt(e.scale);
  let dPath = '';
  for (const line of lines)
    dPath += ribbon(transform(line, { x: e.x, y: e.y, scale: e.scale, rotate: e.rotate, flipX: e.flipX, flipY: e.flipY }), base, style, box);
  return dPath;
}

export interface SvgOptions {
  /** Padding around the artwork, in design units. */
  pad?: number;
  /** Solid background (JPEG and previews). Omit for transparent. */
  background?: string;
  /** Resolves an upload reference to a data URI (server) or object URL (browser). */
  imageHref?: (ref: string) => string | undefined;
  /** Output width in pixels; height follows the aspect ratio. */
  width?: number;
  /** Render with this exact view box instead of cropping to the artwork. */
  viewBox?: Box;
}

/** Cropped bounds with padding, never empty. */
export function cropBox(r: Rendered, pad = 14): Box {
  const b = r.bounds;
  if (!isFinite(b.minX)) return { minX: 0, minY: 0, maxX: CANVAS_W, maxY: CANVAS_H };
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

const hexOnly = (s: string) => (/^#[0-9A-Fa-f]{6}$/.test(s) ? s : '#000000');

function textureFilter(level: number) {
  const k = (level / 10) * 0.9;
  return `<filter id="ink${level}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${-k * 2} ${1 + k * 0.6}" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>`;
}

/**
 * Serializes a render as a self-contained SVG: paths and (for uploads) one embedded PNG, no
 * scripts, no external references, no event attributes. Colours are validated hex values.
 */
export function toSvg(r: Rendered, opts: SvgOptions = {}): string {
  const b = opts.viewBox ?? cropBox(r, opts.pad ?? 14);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const outW = opts.width ?? Math.round(w);
  const outH = Math.max(1, Math.round((outW * h) / w));
  const parts: string[] = [];
  const textures = [...new Set(r.paths.map((p) => p.texture).filter((t): t is number => !!t))];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${f1(b.minX)} ${f1(b.minY)} ${f1(w)} ${f1(h)}">`,
  );
  if (textures.length) parts.push(`<defs>${textures.map(textureFilter).join('')}</defs>`);
  if (opts.background)
    parts.push(
      `<rect x="${f1(b.minX)}" y="${f1(b.minY)}" width="${f1(w)}" height="${f1(h)}" fill="${hexOnly(opts.background)}"/>`,
    );
  for (const img of r.images) {
    const href = opts.imageHref?.(img.ref);
    if (!href || !/^(data:image\/png;base64,[A-Za-z0-9+/=]+|blob:[^"<>\s]+)$/.test(href)) continue;
    const cx = img.x + img.w / 2;
    const cy = img.y + img.h / 2;
    parts.push(
      `<image href="${href}" x="${f1(img.x)}" y="${f1(img.y)}" width="${f1(img.w)}" height="${f1(img.h)}" preserveAspectRatio="none"${img.rotate ? ` transform="rotate(${f1(img.rotate)} ${f1(cx)} ${f1(cy)})"` : ''}/>`,
    );
  }
  for (const p of r.paths) {
    const fill = hexOnly(p.fill);
    const stroke = p.stroke
      ? ` stroke="${fill}" stroke-width="${p.stroke}" stroke-linejoin="round" stroke-linecap="round"`
      : '';
    const op = p.opacity && p.opacity < 1 ? ` opacity="${Math.round(p.opacity * 100) / 100}"` : '';
    parts.push(`<path d="${p.d}" fill="${fill}"${stroke}${op}${p.texture ? ` filter="url(#ink${p.texture})"` : ''}/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
