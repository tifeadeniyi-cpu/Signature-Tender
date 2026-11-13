import type { PenType } from './families';

export type P = [number, number, number];
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBox = (): Box => ({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
});

export function grow(b: Box, x: number, y: number, r = 0) {
  if (x - r < b.minX) b.minX = x - r;
  if (y - r < b.minY) b.minY = y - r;
  if (x + r > b.maxX) b.maxX = x + r;
  if (y + r > b.maxY) b.maxY = y + r;
}

export function merge(into: Box, b: Box) {
  if (!isFinite(b.minX)) return;
  grow(into, b.minX, b.minY);
  grow(into, b.maxX, b.maxY);
}

export const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** Samples a cubic Bézier from p0 to p3 (pressure interpolated). */
export function cubic(p0: P, p1: P, p2: P, p3: P, n = 32): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u,
      b = 3 * u * u * t,
      c = 3 * u * t * t,
      d = t * t * t;
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
    ]);
  }
  return out;
}

/** Joins sampled segments, dropping the duplicated joint point. */
export function chain(...segs: P[][]): P[] {
  const out: P[] = [];
  for (const s of segs) out.push(...(out.length ? s.slice(1) : s));
  return out;
}

/**
 * Light, shape-preserving smoothing for hand-drawn strokes: a moving average whose window grows
 * with `amount` (end points stay where the pen touched down and lifted), followed by Catmull-Rom
 * resampling so the result is a smooth curve. The raw input is never modified.
 */
export function smoothStroke(points: P[], amount: number): P[] {
  if (points.length < 3) return points.map((p) => [...p] as P);
  // Drop exact duplicates that come from a stationary pen.
  const pts: P[] = [points[0]!];
  for (const p of points.slice(1)) {
    const q = pts[pts.length - 1]!;
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.4) pts.push(p);
  }
  if (pts.length < 3) return pts;
  const k = Math.round(amount * 5);
  let sm = pts;
  if (k > 0) {
    sm = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      const lo = Math.max(0, i - k);
      const hi = Math.min(pts.length - 1, i + k);
      let x = 0,
        y = 0,
        pr = 0,
        w = 0;
      for (let j = lo; j <= hi; j++) {
        const wt = 1 - Math.abs(j - i) / (k + 1);
        x += pts[j]![0] * wt;
        y += pts[j]![1] * wt;
        pr += pts[j]![2] * wt;
        w += wt;
      }
      return [x / w, y / w, pr / w] as P;
    });
  }
  // Catmull-Rom: two extra points between each pair.
  const out: P[] = [];
  for (let i = 0; i < sm.length - 1; i++) {
    const p0 = sm[Math.max(0, i - 1)]!;
    const p1 = sm[i]!;
    const p2 = sm[i + 1]!;
    const p3 = sm[Math.min(sm.length - 1, i + 2)]!;
    const steps = 3;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t,
        t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([
        cr(p0[0], p1[0], p2[0], p3[0]),
        cr(p0[1], p1[1], p2[1], p3[1]),
        p1[2] + (p2[2] - p1[2]) * t,
      ]);
    }
  }
  out.push(sm[sm.length - 1]!);
  return out;
}

/** Simplifies a polyline (Ramer-Douglas-Peucker) — used to pick editable curve handles. */
export function simplify(points: P[], tolerance: number): number[] {
  if (points.length < 3) return points.map((_, i) => i);
  const keep = new Set<number>([0, points.length - 1]);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1,
      dist = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]!;
      const d = Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / len;
      if (d > dist) {
        dist = d;
        worst = i;
      }
    }
    if (dist > tolerance && worst > 0) {
      keep.add(worst);
      stack.push([a, worst], [worst, b]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

const NIB = (-38 * Math.PI) / 180;
const BROAD = (-30 * Math.PI) / 180;

/** How a pen turns a centre line into width. `pressure` and `taper` are 0..100. */
export interface PenStyle {
  pen: PenType;
  pressure: number;
  taper: number;
}

function widthAt(s: PenStyle, base: number, p: number, angle: number): number {
  const pv = s.pressure / 100;
  const pf = Math.max(0.15, 1 + pv * (p - 0.5) * 1.5);
  switch (s.pen) {
    case 'ballpoint':
      return base * 0.55 * (1 + pv * (p - 0.5) * 0.4);
    case 'gel':
      return base * (1 + pv * (p - 0.5) * 0.5);
    case 'fountain':
      return base * (0.28 + 1.25 * Math.abs(Math.sin(angle - NIB))) * (1 + pv * (p - 0.5) * 0.6);
    case 'flex': {
      // Downstrokes swell, upstrokes stay hairline.
      const down = Math.max(0, Math.sin(angle));
      return base * (0.25 + 1.7 * down * (0.6 + 0.8 * p * pv + (1 - pv) * 0.4));
    }
    case 'calligraphy':
      return base * 1.35 * (0.14 + 1.3 * Math.abs(Math.sin(angle - BROAD)));
    case 'marker':
      return base * 1.25;
    case 'brush':
      return base * 1.7 * pf;
    case 'natural':
    default:
      return base * pf;
  }
}

/**
 * Turns a centre line into a filled outline whose width follows the pen: pressure, nib angle
 * and tapers at both ends. The output is a true vector path (no raster).
 */
export function ribbon(pts: P[], base: number, style: PenStyle, box: Box): string {
  if (!pts.length) return '';
  if (pts.length === 1 || pathLength(pts) < 0.8) {
    const [x, y] = pts[0]!;
    const r = Math.max(0.6, widthAt(style, base, pts[0]![2], 0) / 2);
    grow(box, x, y, r);
    return `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`;
  }
  const n = pts.length;
  const total = pathLength(pts);
  const taper = (style.taper / 100) * (style.pen === 'brush' ? 0.4 : 0.3);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  let acc = 0;
  const halfs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    if (i > 0) acc += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    let w = widthAt(style, base, pts[i]![2], ang);
    if (taper > 0) {
      const t = acc / total;
      const edge = Math.min(t, 1 - t) / taper;
      if (edge < 1) w *= 0.2 + 0.8 * (edge * edge * (3 - 2 * edge));
    }
    const h = Math.max(0.3, w / 2);
    halfs.push(h);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const [x, y] = pts[i]!;
    left.push([x + nx * h, y + ny * h]);
    right.push([x - nx * h, y - ny * h]);
    grow(box, x, y, h);
  }
  const side = (pts2: [number, number][]) => {
    let d = '';
    for (let i = 1; i < pts2.length - 1; i++) {
      const [x, y] = pts2[i]!;
      const [x2, y2] = pts2[i + 1]!;
      d += `Q${f1(x)} ${f1(y)} ${f1((x + x2) / 2)} ${f1((y + y2) / 2)}`;
    }
    const last = pts2[pts2.length - 1]!;
    return d + `L${f1(last[0])} ${f1(last[1])}`;
  };
  const rEnd = halfs[n - 1]!;
  const rStart = halfs[0]!;
  const rl = [...right].reverse();
  return (
    `M${f1(left[0]![0])} ${f1(left[0]![1])}` +
    side(left) +
    `A${f1(rEnd)} ${f1(rEnd)} 0 0 1 ${f1(rl[0]![0])} ${f1(rl[0]![1])}` +
    side(rl) +
    `A${f1(rStart)} ${f1(rStart)} 0 0 1 ${f1(left[0]![0])} ${f1(left[0]![1])}Z`
  );
}

export function pathLength(pts: P[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++)
    l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return l;
}

/** Applies scale, rotation (degrees) and translation around an origin. */
export function transform(
  pts: P[],
  t: { x: number; y: number; scale: number; rotate: number; flipX?: boolean; flipY?: boolean },
  origin: [number, number] = [0, 0],
): P[] {
  const r = (t.rotate * Math.PI) / 180;
  const c = Math.cos(r),
    s = Math.sin(r);
  const fx = t.flipX ? -1 : 1;
  const fy = t.flipY ? -1 : 1;
  return pts.map(([x, y, p]) => {
    const dx = (x - origin[0]) * t.scale * fx;
    const dy = (y - origin[1]) * t.scale * fy;
    return [origin[0] + dx * c - dy * s + t.x, origin[1] + dx * s + dy * c + t.y, p];
  });
}

/** FNV-1a string hash, used to seed deterministic baseline movement. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Samples a chain of curve-editor anchors (cubic segments between consecutive anchors). */
export function sampleAnchors(
  anchors: { x: number; y: number; ix: number; iy: number; ox: number; oy: number }[],
  steps = 24,
): P[] {
  if (anchors.length === 1) return [[anchors[0]!.x, anchors[0]!.y, 0.5]];
  const segs: P[][] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    segs.push(
      cubic([a.x, a.y, 0.5], [a.x + a.ox, a.y + a.oy, 0.5], [b.x + b.ix, b.y + b.iy, 0.5], [b.x, b.y, 0.5], steps),
    );
  }
  return chain(...segs);
}

/**
 * Fits a polyline with curve-editor anchors: keeps the corner and turning points that a
 * Douglas-Peucker pass finds, with Catmull-Rom tangents as handles. Used by "Edit Curve".
 */
export function fitAnchors(pts: P[], tolerance: number) {
  const idx = simplify(pts, tolerance);
  const kept = idx.map((i) => pts[i]!);
  return kept.map((p, i) => {
    const prev = kept[Math.max(0, i - 1)]!;
    const next = kept[Math.min(kept.length - 1, i + 1)]!;
    const tx = (next[0] - prev[0]) / 6;
    const ty = (next[1] - prev[1]) / 6;
    const first = i === 0;
    const last = i === kept.length - 1;
    return {
      x: p[0],
      y: p[1],
      ix: first ? 0 : -tx,
      iy: first ? 0 : -ty,
      ox: last ? 0 : tx,
      oy: last ? 0 : ty,
    };
  });
}
