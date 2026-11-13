import { getConfigValue, formatMoney } from '@st/core';
import { listLibrary } from '@st/core/studio/server';
import { Sidebar } from '@/components/shell/sidebar';
import { visibleNav } from '@/components/shell/nav';
import { studioSettings } from '@/lib/studio';
import { Topbar } from '@/components/shell/topbar';
import { requireWorkspace } from '@/lib/session';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireWorkspace();
  const supportEmail = await getConfigValue(db(), 'support.email', 'support@signaturetender.com');
  const appEnv = env().APP_ENV;
  const studio = await studioSettings().catch(() => null);
  const studioOn = Boolean(studio?.enabled);
  const allowed = visibleNav(ctx.membership.permissions, studioOn).map((n) => n.href);
  // Offer Signature Studio only to people who have not bought a design yet.
  const owns = studioOn
    ? (await listLibrary(db(), ctx.user.id).catch(() => [])).some((d) => d.access === 'active')
    : true;
  const promo =
    studioOn && !owns && studio
      ? ({ kind: 'studio', price: formatMoney(studio.priceCents, studio.currency) } as const)
      : ({ kind: 'create' } as const);
  return (
    <div className="flex min-h-dvh">
      <Sidebar allowed={allowed} promo={promo} />
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
        <Topbar ctx={ctx} supportEmail={supportEmail} allowed={allowed} />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
