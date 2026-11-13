import { requireWorkspace } from '@/lib/session';
import { integrationPermissions, loadMarketplace } from '@/lib/integrations-view';
import { Marketplace } from './_components/marketplace';
import { ConnectNotice } from './_components/notice';

export const metadata = { title: 'Integrations' };

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user, membership } = await requireWorkspace();
  const sp = await searchParams;
  const items = await loadMarketplace(user.id, membership.workspace.id);
  return (
    <>
      <ConnectNotice connected={sp.connected} error={sp.error} provider={sp.provider} />
      <Marketplace
        items={items}
        perms={integrationPermissions(membership)}
        initialApp={sp.app ?? null}
      />
    </>
  );
}
