import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { AdminNav } from './admin-nav';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: { template: '%s · Staff', default: 'Staff' },
  robots: { index: false },
};

/**
 * Internal administration, separate from every workspace (spec Part 27). Anyone who is not on
 * the staff list gets a plain 404, so the area does not reveal itself.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return (
    <div className="min-h-dvh bg-ivory">
      <header className="border-b border-border bg-heading text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="font-display text-lg">Signature Tender staff</p>
          <AdminNav />
          <Link href="/app" className="text-sm underline-offset-2 hover:underline">
            Back to the app
          </Link>
        </div>
      </header>
      <div className="bg-info-bg px-4 py-1.5 text-center text-xs text-info" role="status">
        Staff view. Counts and identifiers only; document contents and recipients are never shown
        here. Every page you open is recorded in the audit log.
      </div>
      <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
