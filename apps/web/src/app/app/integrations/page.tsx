import { INTEGRATIONS, connectionState, hasPermission, listConnections } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { catalogueAvailability } from '@/lib/integrations';
import { Marketplace } from './marketplace';

export default async function IntegrationsDiscoverPage() {
  const { user, membership } = await requireWorkspace();
  const [conns, availability] = await Promise.all([
    listConnections(db(), { userId: user.id }, membership.workspace.id),
    catalogueAvailability(),
  ]);
  const items = INTEGRATIONS.map((info) => ({
    info,
    availability: availability[info.key]!,
    connection: connectionState(conns.find((c) => c.provider === info.key)),
  }));
  return (
    <>
      <Marketplace
        items={items}
        canManage={hasPermission(membership.permissions, 'integrations.manage')}
      />
      <p className="mt-8 text-sm">
        Building your own connection? Use the{' '}
        <a href="/app/api-docs" className="font-semibold text-primary underline">
          Signature Tender API
        </a>{' '}
        and webhooks, with keys from{' '}
        <a href="/app/settings/developers" className="font-semibold text-primary underline">
          Settings, Developers
        </a>
        .
      </p>
    </>
  );
}
