import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 256-bit URL-safe secret for recipient links and browser sessions. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashSecret(secret: string): string {
  return sha256Hex(`st:v1:${secret}`);
}

export function isPlausibleSecret(secret: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(secret);
}

/** Six-digit one-time code. */
export function newOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** JSON with recursively sorted keys, so the same data always hashes the same way. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainEvent {
  requestId: string;
  recipientId: string | null;
  actorUserId: string | null;
  type: string;
  data: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export function eventHash(prevHash: string, e: ChainEvent): string {
  return sha256Hex(
    canonicalJson([
      prevHash,
      e.requestId,
      e.recipientId,
      e.actorUserId,
      e.type,
      e.data,
      e.ipAddress,
      e.userAgent,
      e.createdAt.toISOString(),
    ]),
  );
}

/** Recomputes the hash chain. Returns the index of the first broken event, or -1 when intact. */
export function verifyChain(events: (ChainEvent & { prevHash: string; hash: string })[]): number {
  let prev = GENESIS_HASH;
  for (const [i, e] of events.entries()) {
    if (e.prevHash !== prev || eventHash(prev, e) !== e.hash) return i;
    prev = e.hash;
  }
  return -1;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

/**
 * Validates a PNG and rebuilds it with only the chunks needed to draw it, dropping text, EXIF and
 * any other metadata. Throws on anything that is not a well-formed PNG within the limits.
 */
export function sanitizePng(
  input: Uint8Array,
  limits = { maxBytes: 1_000_000, maxSide: 2400 },
): Buffer {
  const buf = Buffer.from(input);
  if (buf.length > limits.maxBytes) throw new Error('Signature image is too large');
  if (buf.length < 60 || !PNG_SIG.every((b, i) => buf[i] === b))
    throw new Error('Signature image must be a PNG');
  const out: Buffer[] = [Buffer.from(PNG_SIG)];
  let off = 8;
  let sawIhdr = false;
  let sawEnd = false;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const end = off + 12 + len;
    if (end > buf.length || !/^[A-Za-z]{4}$/.test(type))
      throw new Error('Signature image is damaged');
    if (!sawIhdr) {
      if (type !== 'IHDR' || len !== 13) throw new Error('Signature image is damaged');
      const w = buf.readUInt32BE(off + 8);
      const h = buf.readUInt32BE(off + 12);
      if (w < 8 || h < 8 || w > limits.maxSide || h > limits.maxSide)
        throw new Error('Signature image has unsupported dimensions');
      sawIhdr = true;
    }
    if (KEEP.has(type)) out.push(buf.subarray(off, end));
    off = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new Error('Signature image is damaged');
  return Buffer.concat(out);
}
