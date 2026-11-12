import Image from 'next/image';
import type { Metadata } from 'next';

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
          src="/brand/logo-horizontal.png"
          alt="Signature Tender"
          width={316}
          height={168}
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
