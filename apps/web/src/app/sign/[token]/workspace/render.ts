/**
 * Deterministic typed-signature renderer for Signature Studio.
 *
 * The same inputs (text, family, variation, adjustments, loaded font) always produce the same
 * pixels, so the preview a signer chooses is exactly the image that is adopted and placed on the
 * document. Nothing here is random at render time: "variation" seeds a small PRNG.
 */

export type LoopStyle = 'none' | 'single' | 'double';
export type CapitalStyle = 'natural' | 'large' | 'swash';
export type Underline = 'none' | 'simple' | 'swoosh';
export type Finish = 'none' | 'tail';
export type Ink = 'navy' | 'black' | 'blue' | 'burgundy';

export interface StyleParams {
  /** Degrees; positive leans right. */
  slant: number;
  /** 0 (fine) to 3 (heavy). */
  thickness: number;
  /** Extra space between letters, 0 to 10. */
  spacing: number;
  /** How curved flourishes are, 0 to 100. */
  curve: number;
  loop: LoopStyle;
  capitals: CapitalStyle;
  underline: Underline;
  finish: Finish;
  /** How much words wander off the baseline, 0 to 10. */
  baseline: number;
  ink: Ink;
}

export interface SignatureFamilyDef {
  id: string;
  label: string;
  /** Matches an id in SIGNATURE_FONTS. */
  font: string;
  /** Size adjustment so each face reads at a similar height. */
  scale: number;
  defaults: StyleParams;
}

export const INKS: Record<Ink, { label: string; color: string }> = {
  navy: { label: 'Midnight navy', color: '#0f1733' },
  black: { label: 'Black', color: '#141414' },
  blue: { label: 'Royal blue', color: '#1d3a8a' },
  burgundy: { label: 'Burgundy', color: '#5b0a1c' },
};

export const FAMILIES: SignatureFamilyDef[] = [
  {
    id: 'classic',
    label: 'Classic Cursive',
    font: 'Dancing Script',
    scale: 1,
    defaults: {
      slant: 0,
      thickness: 0.4,
      spacing: 0,
      curve: 35,
      loop: 'none',
      capitals: 'natural',
      underline: 'none',
      finish: 'none',
      baseline: 1,
      ink: 'navy',
    },
  },
  {
    id: 'luxury',
    label: 'Luxury Calligraphy',
    font: 'Great Vibes',
    scale: 1.15,
    defaults: {
      slant: 3,
      thickness: 0,
      spacing: 1,
      curve: 65,
      loop: 'single',
      capitals: 'swash',
      underline: 'swoosh',
      finish: 'none',
      baseline: 1,
      ink: 'navy',
    },
  },
  {
    id: 'modern',
    label: 'Modern Signature',
    font: 'Herr Von Muellerhoff',
    scale: 1.35,
    defaults: {
      slant: 8,
      thickness: 0.6,
      spacing: 2,
      curve: 30,
      loop: 'none',
      capitals: 'large',
      underline: 'simple',
      finish: 'tail',
      baseline: 2,
      ink: 'black',
    },
  },
  {
    id: 'bold',
    label: 'Bold & Expressive',
    font: 'Kaushan Script',
    scale: 0.95,
    defaults: {
      slant: 0,
      thickness: 1.6,
      spacing: 0,
      curve: 20,
      loop: 'none',
      capitals: 'large',
      underline: 'simple',
      finish: 'none',
      baseline: 3,
      ink: 'black',
    },
  },
  {
    id: 'delicate',
    label: 'Delicate Script',
    font: 'Allura',
    scale: 1.2,
    defaults: {
      slant: 2,
      thickness: 0,
      spacing: 3,
      curve: 50,
      loop: 'none',
      capitals: 'natural',
      underline: 'none',
      finish: 'tail',
      baseline: 0,
      ink: 'navy',
    },
  },
  {
    id: 'artistic',
    label: 'Artistic Signature',
    font: 'Mrs Saint Delafield',
    scale: 1.3,
    defaults: {
      slant: -2,
      thickness: 0.4,
      spacing: 1,
      curve: 85,
      loop: 'double',
      capitals: 'swash',
      underline: 'swoosh',
      finish: 'tail',
      baseline: 4,
      ink: 'burgundy',
    },
  },
];

/** mulberry32: a tiny seeded PRNG, so a variation always looks the same. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const W = 1400;
const H = 480;

type Piece = { text: string; size: number; x: number; dy: number; rot: number };

/**
 * Draws the signature onto a fresh canvas and trims it to the ink. `fontFamily` is the CSS family
 * of the face (already loaded by the caller).
 */
export function renderSignature(
  text: string,
  fontFamily: string,
  scale: number,
  params: StyleParams,
  variation: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const seed = hash(`${text}|${fontFamily}|${variation}`);
  let rand = prng(seed);
  const color = INKS[params.ink].color;
  const clean = text.trim().replace(/\s+/g, ' ') || ' ';

  // Lay out words (and enlarged capitals) as pieces so baseline movement keeps cursive joins
  // inside each word intact.
  const layout = (size: number) => {
    const pieces: Piece[] = [];
    let x = 0;
    const letter = (params.spacing * size) / 60;
    const words = clean.split(' ');
    words.forEach((word, wi) => {
      const dy = (rand() - 0.5) * params.baseline * size * 0.03;
      const rot = ((rand() - 0.5) * params.baseline * Math.PI) / 360;
      let rest = word;
      if (params.capitals !== 'natural' && /^\p{Lu}/u.test(word)) {
        const capSize = size * (params.capitals === 'swash' ? 1.38 : 1.22);
        ctx.font = `${capSize}px ${fontFamily}`;
        const c = word[0]!;
        pieces.push({ text: c, size: capSize, x, dy, rot });
        x += ctx.measureText(c).width + letter - capSize * 0.04;
        rest = word.slice(1);
      }
      if (rest) {
        ctx.font = `${size}px ${fontFamily}`;
        pieces.push({ text: rest, size, x, dy, rot });
        x += measure(ctx, rest, letter);
      }
      if (wi < words.length - 1) x += size * 0.32 + letter;
    });
    return { pieces, width: x };
  };

  let size = 190 * scale;
  let laid = layout(size);
  const maxW = W - 300;
  if (laid.width > maxW) {
    size = Math.max(24, (size * maxW) / laid.width);
    // Re-seed so the final layout draws the same variation whatever the first pass consumed.
    rand = prng(seed);
    laid = layout(size);
  }

  const startX = (W - laid.width) / 2;
  const baseY = H * 0.58;
  const skew = Math.tan((params.slant * Math.PI) / 180);
  const letter = (params.spacing * size) / 60;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.textBaseline = 'alphabetic';

  for (const p of laid.pieces) {
    ctx.save();
    ctx.translate(startX + p.x, baseY + p.dy);
    ctx.transform(1, 0, -skew, 1, 0, 0);
    ctx.rotate(p.rot);
    ctx.font = `${p.size}px ${fontFamily}`;
    drawText(ctx, p.text, letter, params.thickness * (p.size / 90));
    ctx.restore();
  }

  // Flourishes are drawn with the same skew so they lean with the writing.
  const left = startX - size * 0.05;
  const right = startX + laid.width;
  const curve = params.curve / 100;
  const pen = Math.max(2, size * 0.022 + params.thickness * 1.6);
  ctx.save();
  ctx.translate(0, baseY);
  ctx.transform(1, 0, -skew * 0.5, 1, 0, 0);
  ctx.lineWidth = pen;

  if (params.capitals === 'swash') {
    // An entry stroke sweeping into the first capital.
    const j = rand();
    ctx.beginPath();
    ctx.moveTo(left - size * 0.35, size * 0.12);
    ctx.bezierCurveTo(
      left - size * (0.2 + curve * 0.25),
      -size * (0.55 + j * 0.2),
      left + size * 0.15,
      -size * (0.7 + curve * 0.2),
      left + size * 0.1,
      -size * 0.25,
    );
    ctx.stroke();
  }

  if (params.underline !== 'none') {
    const y = size * 0.22;
    const lift = size * (0.06 + curve * 0.22) * (params.underline === 'swoosh' ? 1.6 : 1);
    const j1 = rand() - 0.5;
    const j2 = rand() - 0.5;
    ctx.beginPath();
    let x0 = left + size * 0.1;
    if (params.loop !== 'none') {
      const loops = params.loop === 'double' ? 2 : 1;
      const r = size * (0.1 + curve * 0.08);
      ctx.moveTo(x0 - r * 1.4, y - r * 0.2);
      for (let i = 0; i < loops; i++) {
        const cx = x0 + i * r * 1.6;
        ctx.bezierCurveTo(cx + r * 1.6, y - r * 2.2, cx - r * 1.6, y - r * 2.2, cx + r * 0.6, y);
      }
      x0 += (loops - 1) * r * 1.6 + r * 0.6;
    } else {
      ctx.moveTo(x0, y);
    }
    if (params.underline === 'swoosh') {
      const mid = (x0 + right) / 2;
      ctx.bezierCurveTo(
        x0 + (mid - x0) * 0.5,
        y + lift * (0.6 + j1 * 0.4),
        mid,
        y - lift * (0.5 + j2 * 0.4),
        mid + (right - mid) * 0.4,
        y,
      );
      ctx.bezierCurveTo(
        mid + (right - mid) * 0.7,
        y + lift * 0.4,
        right,
        y - lift * 0.2,
        right + size * 0.4,
        y - lift * (0.9 + j1 * 0.3),
      );
    } else {
      ctx.bezierCurveTo(
        x0 + (right - x0) * 0.33,
        y + lift * (0.5 + j1 * 0.3),
        x0 + (right - x0) * 0.66,
        y - lift * (0.3 + j2 * 0.3),
        right + size * 0.15,
        y - lift * 0.3,
      );
    }
    ctx.stroke();
  }

  if (params.finish === 'tail') {
    const j = rand();
    ctx.beginPath();
    ctx.moveTo(right - size * 0.02, -size * 0.04);
    ctx.quadraticCurveTo(
      right + size * (0.25 + curve * 0.2),
      size * (0.05 + j * 0.05),
      right + size * (0.55 + curve * 0.25),
      -size * (0.18 + curve * 0.25),
    );
    ctx.lineWidth = pen * 0.8;
    ctx.stroke();
  }
  ctx.restore();

  return trim(canvas);
}

function measure(ctx: CanvasRenderingContext2D, text: string, letter: number) {
  if (!letter) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + letter;
  return w - letter;
}

function drawText(ctx: CanvasRenderingContext2D, text: string, letter: number, stroke: number) {
  const paint = (t: string, x: number) => {
    ctx.fillText(t, x, 0);
    if (stroke > 0.05) {
      ctx.lineWidth = stroke;
      ctx.strokeText(t, x, 0);
    }
  };
  if (!letter) return paint(text, 0);
  let x = 0;
  for (const ch of text) {
    paint(ch, x);
    x += ctx.measureText(ch).width + letter;
  }
}

/** Crops a canvas to its ink with a small margin. Returns the original if it is empty. */
export function trim(src: HTMLCanvasElement, pad = 16): HTMLCanvasElement {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return src;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** True if a canvas has any visible ink. */
export function hasInk(c: HTMLCanvasElement) {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 8) return true;
  return false;
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .join('')
    .slice(0, 4);
}
