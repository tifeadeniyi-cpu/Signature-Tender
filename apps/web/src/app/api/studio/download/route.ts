import { AppError } from '@st/core';
import { availableFormats, hitRateLimit, readStudioAsset, slug, zip, getPurchasedDesign } from '@st/core/studio/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { JPEG_BACKGROUNDS, studioDeps, studioSettings, verifyDownloadLink } from '@/lib/studio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const headers = (type: string, filename: string, length: number) => ({
  'Content-Type': type,
  'Content-Length': String(length),
  'Content-Disposition': `attachment; filename="${filename}"`,
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
});

/**
 * Purchased signature files. Needs both the owner's signed-in session and a fresh signed link;
 * the entitlement is checked again here, so a copied link is useless to anyone else.
 */
export async function GET(req: Request) {
  const session = await getSession();
  const user = session?.user.emailVerified ? session.user : null;
  if (!user) return new Response('Sign in to download your signature.', { status: 401 });
  const link = verifyDownloadLink(user.id, new URL(req.url).searchParams);
  if (!link) return new Response('This download link has expired. Go back and choose Download again.', { status: 403 });
  const settings = await studioSettings();
  if (!(await hitRateLimit(db(), `download:${user.id}`, settings.limits.downloadsPerHour)))
    return new Response('Too many downloads. Please wait a few minutes.', { status: 429 });
  const deps = studioDeps();
  const bg = JPEG_BACKGROUNDS[link.bg];
  try {
    if (link.format === 'zip') {
      const info = await getPurchasedDesign(db(), user.id, link.designId, settings);
      if (!info?.entitlement) return new Response('Not found', { status: 404 });
      const formats = availableFormats(info.snapshot).filter((f) => settings.formats[f]);
      const files = [];
      for (const f of formats) {
        const file = await readStudioAsset(db(), deps, user.id, link.designId, f, settings, { jpegBackground: bg, via: 'zip' });
        files.push({ name: file.filename, data: file.body });
      }
      const body = zip(files);
      return new Response(new Uint8Array(body), { headers: headers('application/zip', `${slug(info.design.displayName)}.zip`, body.length) });
    }
    const file = await readStudioAsset(db(), deps, user.id, link.designId, link.format, settings, { jpegBackground: bg });
    return new Response(new Uint8Array(file.body), { headers: headers(file.contentType, file.filename, file.body.length) });
  } catch (err) {
    if (err instanceof AppError)
      return new Response(err.message, { status: err.code === 'forbidden' ? 403 : err.code === 'not_found' ? 404 : 409 });
    console.error('Studio download failed', err);
    return new Response('We could not prepare this file. Please try again. You will not be charged again.', { status: 500 });
  }
}
