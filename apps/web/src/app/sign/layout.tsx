import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Review and sign',
  robots: { index: false, follow: false },
};

/**
 * Recipient pages: no app sidebar, no billing or dashboard navigation. Each page renders the
 * burgundy signing header itself so the workspace can add its own controls to it.
 */
export default function SignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
