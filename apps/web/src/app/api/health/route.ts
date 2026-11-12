import { pingDatabase } from '@st/core';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Liveness and database check for uptime monitors. Returns no version, configuration or error
 * details, so it is safe to leave public.
 */
export async function GET() {
  const started = Date.now();
  try {
    await pingDatabase(db());
    return Response.json(
      { ok: true, db: 'ok', ms: Date.now() - started },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    console.error(
      JSON.stringify({ level: 'error', event: 'health.db_unreachable', ms: Date.now() - started }),
    );
    return Response.json(
      { ok: false, db: 'unreachable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
