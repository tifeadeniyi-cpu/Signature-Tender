import type { MetadataRoute } from 'next';
import { getStudioSettings } from '@st/core/studio/server';
import { db } from '@/lib/db';
import { absoluteUrl } from '@/lib/seo';

export const dynamic = 'force-dynamic';

/** sitemap.xml: only public pages that should rank. Private areas are listed in robots.txt. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const studioEnabled = await getStudioSettings(db())
    .then((s) => s.enabled)
    .catch(() => true);
  type Page = [string, number, MetadataRoute.Sitemap[number]['changeFrequency']];
  const pages: Page[] = [
    ['/', 1, 'weekly'],
    ['/product', 0.9, 'weekly'],
    ['/pricing', 0.9, 'weekly'],
    ...(studioEnabled ? [['/signature-studio', 0.8, 'weekly'] satisfies Page] : []),
    ['/sign-up', 0.5, 'monthly'],
    ['/legal/terms', 0.2, 'yearly'],
    ['/legal/privacy', 0.2, 'yearly'],
    ['/legal/esign-disclosure', 0.2, 'yearly'],
  ];
  return pages.map(([path, priority, changeFrequency]) => ({
    url: absoluteUrl(path),
    changeFrequency,
    priority,
  }));
}
