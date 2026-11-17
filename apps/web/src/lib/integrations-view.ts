import 'server-only';
import {
  CAPABILITY_LABELS,
  hasPermission,
  listConnections,
  listIntegrationConnections,
  listMarketplace,
  type MembershipContext,
} from '@st/core';
import { db } from './db';
import { integrationContext, integrationSecretsReady } from './integrations';

export type CardConnectionStatus =
  'not_connected' | 'active' | 'expired' | 'permission_required' | 'error' | 'disabled';

export interface CardConnection {
  id: string | null;
  status: CardConnectionStatus;
  label: string;
  visibility: 'workspace' | 'personal';
  mine: boolean;
}

/** Everything a marketplace card and its details drawer need. Plain data, safe for the client. */
export interface MarketplaceItem {
  key: string;
  name: string;
  provider: string;
  category: string;
  description: string;
  roadmapPhase: number;
  capabilities: string[];
  availability: string;
  implemented: boolean;
  connectable: boolean;
  reason: string | null;
  authType: string;
  allowsPersonal: boolean;
  access: { reads: string[]; writes: string[]; copiesSignedDocuments: boolean; revoke: string };
  setup: string[];
  logo: string | null;
  connections: CardConnection[];
  /** Worst state across the member's visible connections, for the card badge. */
  status: CardConnectionStatus;
}

const RANK: CardConnectionStatus[] = [
  'expired',
  'permission_required',
  'error',
  'active',
  'disabled',
  'not_connected',
];

export interface Permissions {
  manage: boolean;
  use: boolean;
  viewLogs: boolean;
  apiManage: boolean;
}

export function integrationPermissions(m: MembershipContext): Permissions {
  return {
    manage: hasPermission(m.permissions, 'integrations.manage'),
    use: hasPermission(m.permissions, 'integrations.use'),
    viewLogs: hasPermission(m.permissions, 'integrations.view_logs'),
    apiManage: hasPermission(m.permissions, 'api.manage'),
  };
}

/** Builds the marketplace for the signed-in member: catalogue, availability and their connections. */
export async function loadMarketplace(
  userId: string,
  workspaceId: string,
): Promise<MarketplaceItem[]> {
  const actor = { userId };
  const ctx = integrationSecretsReady()
    ? await integrationContext()
    : { oauthClient: () => null, featureEnabled: false };
  const [market, partner, oauth] = await Promise.all([
    listMarketplace(db(), ctx),
    listConnections(db(), actor, workspaceId),
    listIntegrationConnections(db(), actor, workspaceId),
  ]);
  return market.map(({ def, availability, connectable, reason }) => {
    const connections: CardConnection[] =
      def.auth.type === 'oauth2'
        ? oauth
            .filter((c) => c.provider === def.key && c.status !== 'disabled')
            .map((c) => ({
              id: c.id,
              status: c.status as CardConnectionStatus,
              label: c.externalAccountLabel ?? def.name,
              visibility: c.visibility as 'workspace' | 'personal',
              mine: c.ownerUserId === userId,
            }))
        : partner
            .filter((c) => c.provider === def.key && c.status === 'active')
            .map(() => ({
              id: null,
              status: 'active' as const,
              label: 'This workspace',
              visibility: 'workspace' as const,
              mine: false,
            }));
    const status = connections.length
      ? connections.map((c) => c.status).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0]!
      : 'not_connected';
    return {
      key: def.key,
      name: def.name,
      provider: def.provider,
      category: def.category,
      description: def.description,
      roadmapPhase: def.roadmapPhase,
      capabilities: def.capabilities.map((c) => CAPABILITY_LABELS[c]),
      availability,
      implemented: def.implemented,
      connectable,
      reason,
      authType: def.auth.type,
      allowsPersonal: def.allowsPersonal,
      access: def.access,
      setup: def.setup,
      logo: def.logo,
      connections,
      status,
    };
  });
}
