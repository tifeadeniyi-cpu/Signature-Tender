import type { Metadata, Viewport } from 'next';
import { DM_Serif_Display, Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';

const display = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-dm-serif',
  display: 'swap',
});
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Signature Tender: Send. Sign. Pay Once.', template: '%s | Signature Tender' },
  description:
    'Send documents for electronic signature and pay only when you need to. No subscription required.',
  icons: { icon: '/brand/app-icon.png', apple: '/brand/app-icon.png' },
};

export const viewport: Viewport = { themeColor: '#5B0A1C' };

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
