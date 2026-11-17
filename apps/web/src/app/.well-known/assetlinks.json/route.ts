import { env } from '@/lib/env';
import { MOBILE_BUNDLE_ID } from '@/lib/mobile-links';

export const dynamic = 'force-dynamic';

/** Android App Links: lets signing links open in the app. Empty until the app's certificate is set. */
export function GET() {
  const prints = (env().ANDROID_APP_CERT_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  return Response.json(
    prints.length
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: MOBILE_BUNDLE_ID,
              sha256_cert_fingerprints: prints,
            },
          },
        ]
      : [],
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
