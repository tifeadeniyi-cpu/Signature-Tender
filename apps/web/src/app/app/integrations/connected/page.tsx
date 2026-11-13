import Link from 'next/link';
import { getIntegration, connectionState, listConnections } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { buttonClass } from '@/components/ui/button';
import { AppMark, ConnectionStatus } from '@/components/integrations/ui';

export const metadata = { title: 'Connected Apps' };

const fmt = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(d) : 'Never';

export default async function ConnectedAppsPage() {
  const { user, membership } = await requireWorkspace();
  const conns = (await listConnections(db(), { userId: user.id }, membership.workspace.id)).filter(
    (c) => c.status !== 'disabled',
  );
  if (!conns.length)
    return (
      <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center">
        <p className="mb-4 text-sm">No apps are connected to {membership.workspace.name} yet.</p>
        <Link href="/app/integrations" className={buttonClass('gold', 'md')}>
          Discover integrations
        </Link>
      </div>
    );
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {conns.map((c) => {
        const info = getIntegration(c.provider);
        const state = connectionState(c);
        return (
          <li
            key={c.id}
            className="flex flex-col rounded-2xl border border-border bg-white p-5 shadow-card"
          >
            <div className="mb-3 flex items-start gap-3">
              <AppMark name={info?.name ?? c.provider} />
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg">{info?.name ?? c.provider}</h2>
                <ConnectionStatus value={state} />
              </div>
              <Link
                href={`/app/integrations/${c.provider}`}
                className={buttonClass('secondary', 'sm')}
                aria-label={`Manage ${info?.name ?? c.provider}`}
              >
                Manage
              </Link>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="font-semibold text-heading">Account</dt>
              <dd className="truncate">
                {c.externalAccountLabel ??
                  (info?.kind === 'slack'
                    ? 'Slack channel webhook'
                    : c.apiKeyPrefix
                      ? `API key ${c.apiKeyPrefix}…`
                      : '—')}
              </dd>
              <dt className="font-semibold text-heading">Workspace</dt>
              <dd>{membership.workspace.name}</dd>
              <dt className="font-semibold text-heading">Connected by</dt>
              <dd>{c.connectedByName ?? '—'}</dd>
              <dt className="font-semibold text-heading">Connected</dt>
              <dd>{fmt(c.connectedAt ?? c.createdAt)}</dd>
              <dt className="font-semibold text-heading">Last successful sync</dt>
              <dd>{info?.kind === 'api' ? fmt(c.apiKeyLastUsedAt) : fmt(c.lastSuccessAt)}</dd>
            </dl>
            {state === 'expired' || state === 'error' ? (
              <p className="mt-3 text-sm text-warning">{c.lastError ?? 'Needs attention.'}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
