import Link from 'next/link';
import { getStaffAccess, requireStaff } from '@/lib/session';
import { AdminMobileNav, AdminSidebar } from './admin-nav';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: { template: '%s · Admin', default: 'Admin' },
  robots: { index: false, follow: false },
};

const ROLE_LABEL: Record<string, string> = {
  founder: 'Founder Admin',
  finance: 'Finance Admin',
  support: 'Support Admin',
  security: 'Security Admin',
  technical: 'Technical Admin',
  analyst: 'Analyst',
};

/**
 * Internal administration, separate from every workspace (spec Part 27). Anyone who is not on
 * the staff list gets a plain 404, so the area does not reveal itself. Each section is shown
 * only to roles that may open it, and every page checks the role again on the server.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const access = await getStaffAccess();
  const label = ROLE_LABEL[access.role ?? ''] ?? 'Staff';
  return (
    <div className="flex min-h-dvh bg-ivory">
      <AdminSidebar permissions={access.permissions} label={label} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border bg-heading text-white lg:bg-white lg:text-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="font-display text-lg">
              {label}
              <span className="ml-2 text-sm font-normal opacity-75">{user.name}</span>
            </p>
            <Link href="/app" className="text-sm underline-offset-2 hover:underline">
              Back to the app
            </Link>
          </div>
          <AdminMobileNav permissions={access.permissions} />
        </header>
        <div className="bg-info-bg px-4 py-1.5 text-center text-xs text-info" role="status">
          Admin view. Counts and opaque references only; document contents, signatures and
          recipients are never shown here. Every page you open is recorded in the audit log.
        </div>
        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
