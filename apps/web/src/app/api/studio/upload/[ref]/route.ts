import { canSeeUpload, readUpload } from '@st/core/studio/server';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { studioActor } from '@/lib/studio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** An uploaded signature image, only for the person whose design uses it. */
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const { actor } = await studioActor(false);
  if ((!actor.userId && !actor.guestHash) || !(await canSeeUpload(db(), actor, ref)))
    return new Response('Not found', { status: 404 });
  const bytes = await readUpload(db(), storage(), ref);
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
