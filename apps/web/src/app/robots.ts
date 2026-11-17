import type { MetadataRoute } from 'next';
import { PRIVATE_PATHS, absoluteUrl, siteUrl } from '@/lib/seo';

export const dynamic = 'force-dynamic';

/** robots.txt: public marketing pages are crawlable; the app, staff and recipient links are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE_PATHS }],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: siteUrl(),
  };
}
