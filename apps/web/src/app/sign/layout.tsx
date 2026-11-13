import type { Metadata } from 'next';
import './burgundy.css';

export const metadata: Metadata = {
  title: 'Review and sign',
  robots: { index: false, follow: false },
  // Signing links carry a secret token: never send it to other sites in the Referer header.
  referrer: 'no-referrer',
};

/**
 * Recipient pages: no app sidebar, no billing or dashboard navigation. Pages wrap themselves in
 * SignChrome (branded header and footer), except the signing workspace, which is full-screen
 * with its own header. `brand-burgundy` keeps these pages in the approved burgundy palette.
 */
export default function SignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="brand-burgundy flex min-h-dvh flex-col bg-ivory">
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
