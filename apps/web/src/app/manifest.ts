import type { MetadataRoute } from 'next';
import { BRAND_ICONS } from '@/lib/brand-assets';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Signature Tender',
    short_name: 'Signature Tender',
    description: 'Send documents for electronic signature and pay only when you send.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFF9F2',
    theme_color: '#0D1B33',
    icons: [
      { src: BRAND_ICONS.icon192, sizes: '192x192', type: 'image/png' },
      { src: BRAND_ICONS.icon512, sizes: '512x512', type: 'image/png' },
    ],
  };
}
