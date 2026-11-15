import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { supportEmail } from '@/lib/completed';
import { PublicHeader } from '@/components/completed/public-header';

export const metadata: Metadata = {
  title: 'Get your documents',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/** Verified-email retrieval for recipients without an account. */
export default async function RetrieveLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const user = session?.user.emailVerified ? { name: session.user.name } : null;
  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      <PublicHeader user={user} supportEmail={await supportEmail()} />
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
