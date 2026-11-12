import { cookies } from 'next/headers';
import { getConfigValue, hasPermission, hasSentDocument } from '@st/core';
import { AppSidebar } from '@/components/shell/sidebar';
import { SIDEBAR_COOKIE, visibleNav } from '@/components/shell/nav';
import { Topbar } from '@/components/shell/topbar';
import { requireWorkspace } from '@/lib/session';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireWorkspace();
  const canCreate = hasPermission(ctx.membership.permissions, 'documents.create');
  const [supportEmail, returning, jar] = await Promise.all([
    getConfigValue(db(), 'support.email', 'support@signaturetender.com'),
    canCreate
      ? hasSentDocument(db(), { userId: ctx.user.id }, ctx.membership.workspace.id).catch(
          () => true,
        )
      : Promise.resolve(false),
    cookies(),
  ]);
  const appEnv = env().APP_ENV;
  const nav = visibleNav(ctx.membership.permissions);
  const cta = canCreate ? { returning } : null;
  return (
    <div className="flex min-h-dvh">
      <AppSidebar
        items={nav}
        cta={cta}
        initialCollapsed={jar.get(SIDEBAR_COOKIE)?.value === 'collapsed'}
      />
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
        <Topbar ctx={ctx} supportEmail={supportEmail} nav={nav} cta={cta} />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
