import Link from 'next/link';
import { Plug, CircleCheck, Boxes, Hourglass, TriangleAlert } from 'lucide-react';
import { INTEGRATIONS, hasPermission, listConnections } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, StatCard } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { ConnectForm, DisconnectForm } from './connect-forms';

export const metadata = { title: 'Integrations' };

const fmt = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
    : 'Not yet';

export default async function IntegrationsPage() {
  const { user, membership } = await requireWorkspace();
  const canManage =
    hasPermission(membership.permissions, 'integrations.manage') &&
    hasPermission(membership.permissions, 'api.manage');
  const conns = await listConnections(db(), { userId: user.id }, membership.workspace.id);
  const active = conns.filter((c) => c.status === 'active');
  const health = (c: (typeof conns)[number]) =>
    INTEGRATIONS.find((i) => i.key === c.provider)?.kind === 'slack'
      ? c.failedDeliveries > 0 || c.webhookEnabled === false
        ? 'attention'
        : 'ok'
      : c.apiKeyRevokedAt || c.failedDeliveries > 0 || c.webhookEnabled === false
        ? 'attention'
        : !c.apiKeyLastUsedAt
          ? 'setup'
          : 'ok';
  const available = INTEGRATIONS.filter((i) => i.available);
  const planned = INTEGRATIONS.filter((i) => !i.available);
  const categories = [...new Set(planned.map((i) => i.category))];

  return (
    <>
      <PageHeader
        icon={<Plug className="size-8" />}
        title="Integrations"
        description="Connect Signature Tender to other apps. Signature Tender keeps the signing record; connected apps keep a reference to it."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Connected"
          value={active.length}
          icon={<CircleCheck className="size-5" />}
        />
        <StatCard label="Available" value={available.length} icon={<Boxes className="size-5" />} />
        <StatCard
          label="In setup"
          value={active.filter((c) => health(c) === 'setup').length}
          icon={<Hourglass className="size-5" />}
          hint="Connected, no API calls yet"
        />
        <StatCard
          label="Needs attention"
          value={active.filter((c) => health(c) === 'attention').length}
          icon={<TriangleAlert className="size-5" />}
        />
      </div>
      {canManage ? null : (
        <Alert tone="info" className="mb-6">
          Only owners, admins and API developers can connect or disconnect integrations.
        </Alert>
      )}

      <h2 className="mb-3 font-display text-xl">Available now</h2>
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {available.map((i) => {
          const c = active.find((x) => x.provider === i.key);
          const h = c ? health(c) : null;
          return (
            <Card key={i.key} as="article">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-lg">{i.name}</h3>
                  <p className="text-xs text-slate-500">
                    {i.category} · {i.kind === 'slack' ? 'Notifications' : 'API connection'}
                  </p>
                </div>
                {c ? (
                  h === 'attention' ? (
                    <Badge tone="warning">Needs attention</Badge>
                  ) : h === 'setup' ? (
                    <Badge tone="info">Connected, not used yet</Badge>
                  ) : (
                    <Badge tone="success">Connected</Badge>
                  )
                ) : (
                  <Badge tone="neutral">Not connected</Badge>
                )}
              </div>
              <p className="mb-4 text-sm">{i.description}</p>
              {canManage ? (
                <ConnectForm
                  provider={i.key}
                  name={i.name}
                  connected={Boolean(c)}
                  kind={i.kind ?? 'api'}
                />
              ) : null}
              {c ? (
                <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    {i.kind === 'slack' ? null : (
                      <>
                        <dt className="font-semibold">API key</dt>
                        <dd className="font-mono">
                          {c.apiKeyPrefix ? `${c.apiKeyPrefix}…` : 'None'}
                        </dd>
                        <dt className="font-semibold">Last used</dt>
                        <dd>{fmt(c.apiKeyLastUsedAt)}</dd>
                      </>
                    )}
                    <dt className="font-semibold">Webhook</dt>
                    <dd className="break-all">
                      {c.webhookUrl
                        ? i.kind === 'slack'
                          ? 'Slack channel webhook (hidden)'
                          : c.webhookUrl
                        : 'None'}
                    </dd>
                    <dt className="font-semibold">Failed deliveries</dt>
                    <dd>
                      {c.failedDeliveries}
                      {c.failedDeliveries ? (
                        <>
                          {' '}
                          <Link
                            href="/app/settings/developers?deliveries=failed"
                            className="text-primary underline"
                          >
                            View log
                          </Link>
                        </>
                      ) : null}
                    </dd>
                    <dt className="font-semibold">Connected</dt>
                    <dd>{fmt(c.updatedAt)}</dd>
                  </dl>
                  {canManage ? <DisconnectForm provider={i.key} name={i.name} /> : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      <h2 className="mb-1 font-display text-xl">Not available yet</h2>
      <p className="mb-3 text-sm">
        These are planned. None of them can be connected today, and nothing is sent to them.
      </p>
      {categories.map((cat) => (
        <section key={cat} className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-heading">{cat}</h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {planned
              .filter((i) => i.category === cat)
              .map((i) => (
                <li
                  key={i.key}
                  className="rounded-xl border border-dashed border-border bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-heading">{i.name}</p>
                    <Badge tone="neutral">Not available yet</Badge>
                  </div>
                  <p className="mt-1 text-xs">{i.note ?? i.description}</p>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <p className="mt-6 text-sm">
        Building your own connection? See the{' '}
        <Link href="/app/api-docs" className="font-semibold text-primary underline">
          API documentation
        </Link>{' '}
        and manage keys under{' '}
        <Link href="/app/settings/developers" className="font-semibold text-primary underline">
          Settings, Developers
        </Link>
        .
      </p>
    </>
  );
}
