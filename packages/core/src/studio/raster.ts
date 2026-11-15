import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import { deflateRawSync } from 'node:zlib';

/**
 * Server-side rasterization of a Studio SVG. resvg draws exactly the SVG our renderer produced,
 * so PNG and JPEG files match the vector artwork. PNGs keep a real alpha channel (no white box).
 */
export function svgToPng(svg: string, width: number): { png: Buffer; width: number; height: number } {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
  return { png: Buffer.from(r.asPng()), width: r.width, height: r.height };
}

/** JPEG has no transparency: the artwork is composited over a solid background. */
export function svgToJpeg(svg: string, width: number, background: string): { jpeg: Buffer; width: number; height: number } {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background,
    font: { loadSystemFonts: false },
  }).render();
  const data = Buffer.from(r.pixels);
  const out = jpeg.encode({ data, width: r.width, height: r.height }, 92);
  return { jpeg: Buffer.from(out.data), width: r.width, height: r.height };
}

/** Reads the alpha channel of a PNG render: true when any pixel is not fully opaque. */
export function hasTransparency(svg: string, width = 400): boolean {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
  const px = r.pixels;
  for (let i = 3; i < px.length; i += 4) if (px[i]! < 255) return true;
  return false;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A minimal ZIP writer (deflate) for "Download All Formats". */
export function zip(files: { name: string; data: Uint8Array }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * Checks an SVG string is one our renderer could have produced: only svg/defs/filter primitives,
 * path, rect and an embedded PNG image; no scripts, event handlers, foreign objects or external
 * references. Used as a last gate before an SVG is stored or served.
 */
export function assertSafeSvg(svg: string): void {
  const allowed = new Set([
    'svg',
    'defs',
    'filter',
    'feTurbulence',
    'feColorMatrix',
    'feComposite',
    'path',
    'rect',
    'image',
  ]);
  for (const m of svg.matchAll(/<\/?([A-Za-z][\w:-]*)/g))
    if (!allowed.has(m[1]!)) throw new Error(`Unsafe SVG element: ${m[1]}`);
  if (/\son[a-z]+\s*=/i.test(svg)) throw new Error('Unsafe SVG attribute');
  if (/javascript:|<!ENTITY|<!DOCTYPE|xlink:href|<\?xml-stylesheet/i.test(svg)) throw new Error('Unsafe SVG content');
  for (const m of svg.matchAll(/href="([^"]*)"/g))
    if (!m[1]!.startsWith('data:image/png;base64,')) throw new Error('Unsafe SVG reference');
  for (const m of svg.matchAll(/url\(([^)]*)\)/g))
    if (!/^#ink\d+$/.test(m[1]!)) throw new Error('Unsafe SVG reference');
}
