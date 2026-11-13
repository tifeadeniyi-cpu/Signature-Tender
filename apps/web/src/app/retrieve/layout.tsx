import Image from 'next/image';
import type { Metadata } from 'next';
import { BRAND_ASSETS } from '@/lib/brand-assets';

export const metadata: Metadata = {
  title: 'Get your documents',
  robots: { index: false, follow: false },
};

/** Verified-email retrieval for recipients without an account. */
export default function RetrieveLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      <header className="flex h-14 items-center border-b border-border bg-white px-4">
        <Image
          {...BRAND_ASSETS.horizontalLight}
          alt="Signature Tender"
          className="h-10 w-auto"
          priority
        />
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
