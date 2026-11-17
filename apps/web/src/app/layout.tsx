import type { Metadata, Viewport } from 'next';
import { DM_Serif_Display, Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { BRAND_ICONS } from '@/lib/brand-assets';
import { OG_IMAGES, SITE_NAME, siteUrl } from '@/lib/seo';

const display = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-dm-serif',
  display: 'swap',
});
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

const DEFAULT_TITLE = 'Signature Tender: Electronic Signatures Without a Subscription';
const DEFAULT_DESCRIPTION =
  'Send documents for electronic signature online and pay only when you send. No subscription required.';

export function generateMetadata(): Metadata {
  const google = process.env.GOOGLE_SITE_VERIFICATION;
  const bing = process.env.BING_SITE_VERIFICATION;
  return {
    metadataBase: new URL(siteUrl()),
    applicationName: SITE_NAME,
    title: { default: DEFAULT_TITLE, template: '%s | Signature Tender' },
    description: DEFAULT_DESCRIPTION,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en_US',
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      images: [OG_IMAGES.default],
    },
    twitter: {
      card: 'summary_large_image',
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      images: [OG_IMAGES.default.url],
    },
    formatDetection: { telephone: false, email: false, address: false },
    // Search Console and Bing Webmaster Tools ownership tags, set in Vercel when needed.
    ...(google || bing
      ? {
          verification: {
            ...(google ? { google } : {}),
            ...(bing ? { other: { 'msvalidate.01': bing } } : {}),
          },
        }
      : {}),
    icons: {
      icon: [
        { url: BRAND_ICONS.favicon, sizes: 'any' },
        { url: BRAND_ICONS.favicon32, sizes: '32x32', type: 'image/png' },
        { url: BRAND_ICONS.icon192, sizes: '192x192', type: 'image/png' },
      ],
      apple: { url: BRAND_ICONS.apple, sizes: '180x180' },
    },
    manifest: '/manifest.webmanifest',
  };
}

export const viewport: Viewport = { themeColor: '#0D1B33' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers makes every page render per request, which the CSP nonce needs.
  await headers();
  return (
    <html lang="en" className={`${display.variable} ${inter.variable}`}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-primary"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
