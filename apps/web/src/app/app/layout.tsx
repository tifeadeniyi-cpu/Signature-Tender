import { getConfigValue } from '@st/core';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { requireWorkspace } from '@/lib/session';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireWorkspace();
  const supportEmail = await getConfigValue(db(), 'support.email', 'support@signaturetender.com');
  const appEnv = env().APP_ENV;
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {appEnv !== 'production' ? (
          <div
            className="bg-warning-bg px-4 py-1.5 text-center text-xs font-medium text-warning"
            role="status"
          >
            {appEnv === 'staging' ? 'Staging' : 'Development'} environment. Do not upload real
            customer documents.
          </div>
        ) : null}
        <Topbar ctx={ctx} supportEmail={supportEmail} />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
