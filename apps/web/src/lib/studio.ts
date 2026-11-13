import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { safeEqualHex, sha256Hex } from '@st/core';
import {
  getStudioSettings,
  nodeFontLoader,
  type RenderDeps,
  type StudioFormat,
} from '@st/core/studio/server';
import type { StudioActor } from '@st/db';
import { db } from './db';
import { env } from './env';
import { getSession } from './session';
import { storage } from './storage';

/** Random per-browser id for designing before sign-in. Only its hash is stored. */
export const STUDIO_GUEST_COOKIE = 'st_studio_guest';
const GUEST_RE = /^[A-Za-z0-9_-]{43}$/;

function fontDir() {
  const candidates = [
    path.join(process.cwd(), 'public/studio-fonts'),
    path.join(process.cwd(), 'apps/web/public/studio-fonts'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

const g = globalThis as unknown as { __stStudioFonts?: ReturnType<typeof nodeFontLoader> };
export function studioDeps(): RenderDeps {
  g.__stStudioFonts ??= nodeFontLoader(fontDir());
  return { fonts: g.__stStudioFonts, storage: storage() };
}

export const studioSettings = cache(() => getStudioSettings(db()));

const guestHashOf = (secret: string) => sha256Hex(`st:studio-guest:v1:${secret}`);

/** The guest hash for this browser, if it has the cookie. Never creates one. */
export async function readGuestHash(): Promise<string | null> {
  const v = (await cookies()).get(STUDIO_GUEST_COOKIE)?.value;
  return v && GUEST_RE.test(v) ? guestHashOf(v) : null;
}

/** Creates the guest cookie when needed. Only callable from a server action or route handler. */
export async function ensureGuestHash(): Promise<string> {
  const jar = await cookies();
  let v = jar.get(STUDIO_GUEST_COOKIE)?.value;
  if (!v || !GUEST_RE.test(v)) {
    v = randomBytes(32).toString('base64url');
    const s = await studioSettings();
    jar.set(STUDIO_GUEST_COOKIE, v, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env().APP_ENV === 'production' || env().APP_ENV === 'staging',
      path: '/',
      maxAge: s.guestDraftDays * 86400,
    });
  }
  return guestHashOf(v);
}

/** Signed-in, verified users act as themselves; everyone else as their browser's guest id. */
export async function studioActor(create = false): Promise<{ actor: StudioActor; userId: string | null }> {
  const session = await getSession();
  const userId = session?.user.emailVerified ? session.user.id : null;
  if (userId) return { actor: { userId }, userId };
  const guestHash = create ? await ensureGuestHash() : await readGuestHash();
  if (!guestHash) return { actor: {}, userId: null };
  return { actor: { guestHash }, userId: null };
}

// ---------------------------------------------------------------------------------------------
// Signed, expiring download links. The link is useless without the owner's signed-in session.

export type DownloadFormat = StudioFormat | 'zip';
export const JPEG_BACKGROUNDS = { white: '#FFFFFF', ivory: '#FFF9F2', cream: '#F6F0E7' } as const;
export type JpegBackground = keyof typeof JPEG_BACKGROUNDS;

function linkKey() {
  return createHmac('sha256', env().BETTER_AUTH_SECRET).update('st:studio-download:v1').digest();
}

function linkSig(userId: string, designId: string, format: string, bg: string, exp: number) {
  return createHmac('sha256', linkKey()).update(`${userId}|${designId}|${format}|${bg}|${exp}`).digest('hex');
}

export function signDownloadLink(
  userId: string,
  designId: string,
  format: DownloadFormat,
  bg: JpegBackground,
  seconds: number,
) {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const q = new URLSearchParams({ d: designId, f: format, b: bg, e: String(exp), s: linkSig(userId, designId, format, bg, exp) });
  return `/api/studio/download?${q}`;
}

export function verifyDownloadLink(userId: string, q: URLSearchParams) {
  const d = q.get('d') ?? '';
  const f = q.get('f') ?? '';
  const b = q.get('b') ?? 'white';
  const e = Number(q.get('e'));
  const s = q.get('s') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(d) || !['png', 'svg', 'jpeg', 'zip'].includes(f) || !(b in JPEG_BACKGROUNDS)) return null;
  if (!Number.isFinite(e) || e < Date.now() / 1000 || !/^[0-9a-f]{64}$/.test(s)) return null;
  if (!safeEqualHex(s, linkSig(userId, d, f, b, e))) return null;
  return { designId: d, format: f as DownloadFormat, bg: b as JpegBackground };
}

/**
 * Server-rendered SVG of a design for pages (checkout summary, library, download window). Uses the
 * same renderer and fonts as the editor and the exports. Uploads are inlined for the owner only;
 * callers must already have checked access to the design.
 */
export async function designSvg(
  design: import('@st/core/studio/index').Design,
  opts: { width?: number; background?: string } = {},
) {
  const { renderDesign, toSvg, readUpload } = await import('@st/core/studio/server');
  const deps = studioDeps();
  const fonts = await deps.fonts(design.text?.font ? [design.text.font] : []);
  let href: string | undefined;
  if (design.upload) {
    const bytes = await readUpload(db(), deps.storage, design.upload.ref);
    if (bytes) href = `data:image/png;base64,${bytes.toString('base64')}`;
  }
  return toSvg(renderDesign(design, fonts), { width: opts.width, background: opts.background, imageHref: () => href });
}

export interface SignerStudioDesign {
  id: string;
  name: string;
  svg: string;
}

/**
 * Purchased Studio designs the signed-in user may use on this signing request: only when their
 * verified account email is the recipient's email. Anyone else sees none.
 */
export async function purchasedForSigner(
  recipientEmail: string,
): Promise<Record<'signature' | 'initials', SignerStudioDesign[]>> {
  const empty = { signature: [], initials: [] };
  const session = await getSession();
  if (!session?.user.emailVerified || session.user.email.toLowerCase() !== recipientEmail.toLowerCase()) return empty;
  const settings = await studioSettings();
  if (!settings.enabled) return empty;
  const { listSignableDesigns } = await import('@st/core/studio/server');
  const load = async (kind: 'signature' | 'initials') =>
    Promise.all(
      (await listSignableDesigns(db(), session.user.id, kind)).map(async (d) => ({
        id: d.id,
        name: d.name,
        svg: await designSvg(d.design, { width: 360 }).catch(() => ''),
      })),
    );
  const [signature, initials] = await Promise.all([load('signature'), load('initials')]);
  return { signature, initials };
}
