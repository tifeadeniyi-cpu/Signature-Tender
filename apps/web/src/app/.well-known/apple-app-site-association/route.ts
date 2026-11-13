import { env } from '@/lib/env';
import { MOBILE_BUNDLE_ID, MOBILE_LINK_PATHS } from '@/lib/mobile-links';

export const dynamic = 'force-dynamic';

/**
 * Tells iOS that signing links (signaturetender.com/sign/…) may open in the Signature Tender app.
 * Served only once APPLE_TEAM_ID is set, so nothing is claimed before the app exists.
 */
export function GET() {
  const team = env().APPLE_TEAM_ID;
  if (!team) return new Response('Not found', { status: 404 });
  return Response.json(
    {
      applinks: {
        details: [
          {
            appIDs: [`${team}.${MOBILE_BUNDLE_ID}`],
            components: MOBILE_LINK_PATHS.map((p) => ({ '/': p })),
          },
        ],
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
