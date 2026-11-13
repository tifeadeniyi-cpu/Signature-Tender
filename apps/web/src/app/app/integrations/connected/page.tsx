import Link from 'next/link';
import { Plug } from 'lucide-react';
import { getConnector, listConnections, listIntegrationConnections } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { integrationPermissions } from '@/lib/integrations-view';
import { EmptyState } from '@/components/ui/feedback';
import { ButtonLink, buttonClass } from '@/components/ui/button';
import { AppLogo, ConnectionBadge, fmtDate } from '../_components/badges';
import { DisconnectConnectionForm, TestConnectionForm } from '../_components/connection-forms';
import { DisconnectForm } from '../connect-forms';

export const metadata = { title: 'Connected Apps' };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-semibold text-heading">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

export default async function ConnectedAppsPage() {
  const { user, membership } = await requireWorkspace();
  const perms = integrationPermissions(membership);
  const actor = { userId: user.id };
  const ws = membership.workspace.id;
  const [partner, oauth] = await Promise.all([
    listConnections(db(), actor, ws),
    listIntegrationConnections(db(), actor, ws),
  ]);
  const partnerActive = partner.filter((c) => c.status === 'active');
  const oauthShown = oauth.filter((c) => c.status !== 'disabled');

  if (!partnerActive.length && !oauthShown.length)
    return (
      <EmptyState
        icon={<Plug className="size-5" />}
        title="No connected apps yet"
        action={<ButtonLink href="/app/integrations">Discover integrations</ButtonLink>}
      >
        Connected accounts for this workspace, and your personal ones, will show here.
      </EmptyState>
    );

  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {oauthShown.map((c) => {
        const def = getConnector(c.provider);
        const name = def?.name ?? c.provider;
        const canManage = perms.manage || c.ownerUserId === user.id;
        return (
          <li key={c.id} id={c.id}>
            <article
              className="rounded-2xl border border-border bg-white p-5 shadow-card"
              aria-label={`${name}, ${c.externalAccountLabel ?? ''}`}
            >
              <div className="mb-3 flex items-start gap-3">
                <AppLogo name={name} logo={def?.logo ?? null} />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg leading-tight">{name}</h2>
                  <p className="truncate text-sm">{c.externalAccountLabel}</p>
                </div>
                <ConnectionBadge status={c.status} />
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <Row label="Workspace">
                  {c.visibility === 'personal' ? 'Personal (only you)' : membership.workspace.name}
                </Row>
                <Row label="Connected">{fmtDate(c.connectedAt ?? c.createdAt)}</Row>
                <Row label="Last successful sync">{fmtDate(c.lastSuccessAt)}</Row>
              </dl>
              {c.lastErrorMessage ? (
                <p className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
                  {c.lastErrorMessage}
                </p>
              ) : null}
              <details className="mt-3 group">
                <summary className="cursor-pointer text-sm font-semibold text-primary">
                  Manage
                </summary>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <Row label="Authorized account">{c.externalAccountLabel}</Row>
                  <Row label="Permissions">
                    {c.scopes.length ? c.scopes.join(', ') : 'None recorded'}
                  </Row>
                  <Row label="Connected by">{c.connectedByName ?? 'A former member'}</Row>
                  <Row label="Owner">
                    {c.visibility === 'personal'
                      ? c.ownerUserId === user.id
                        ? 'You'
                        : 'A workspace member'
                      : 'The workspace'}
                  </Row>
                  <Row label="Automations on">{c.automations}</Row>
                  <Row label="Failed jobs (7 days)">{c.failedJobs7d}</Row>
                  <Row label="Last failure">{fmtDate(c.lastFailureAt)}</Row>
                  <Row label="Token refreshed">{fmtDate(c.lastRefreshedAt)}</Row>
                </dl>
                <div className="mt-3 flex flex-wrap items-start gap-2">
                  <TestConnectionForm id={c.id} />
                  {canManage && c.status !== 'active' ? (
                    <a
                      href={`/api/integrations/oauth/${c.provider}/start?visibility=${c.visibility}`}
                      className={buttonClass('primary', 'sm')}
                    >
                      Reconnect
                    </a>
                  ) : null}
                  <ButtonLink
                    href={`/app/integrations/activity?connection=${c.id}`}
                    variant="ghost"
                    size="sm"
                  >
                    View activity
                  </ButtonLink>
                  <ButtonLink href={`/app/integrations/settings#${c.id}`} variant="ghost" size="sm">
                    Sync settings
                  </ButtonLink>
                  {canManage ? <DisconnectConnectionForm id={c.id} name={name} /> : null}
                </div>
              </details>
            </article>
          </li>
        );
      })}
      {partnerActive.map((c) => {
        const def = getConnector(c.provider);
        const name = def?.name ?? c.provider;
        const slack = def?.auth.type === 'slack_webhook';
        const attention =
          c.failedDeliveries > 0 || c.webhookEnabled === false || Boolean(c.apiKeyRevokedAt);
        return (
          <li key={c.id}>
            <article
              className="rounded-2xl border border-border bg-white p-5 shadow-card"
              aria-label={name}
            >
              <div className="mb-3 flex items-start gap-3">
                <AppLogo name={name} logo={def?.logo ?? null} />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg leading-tight">{name}</h2>
                  <p className="text-sm">{slack ? 'Slack notifications' : 'API connection'}</p>
                </div>
                <ConnectionBadge status={attention ? 'error' : 'active'} />
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <Row label="Workspace">{membership.workspace.name}</Row>
                <Row label="Connected">{fmtDate(c.createdAt)}</Row>
                {slack ? null : (
                  <Row label="API key">
                    {c.apiKeyPrefix ? <span className="font-mono">{c.apiKeyPrefix}…</span> : 'None'}
                  </Row>
                )}
                {slack ? null : <Row label="Last API call">{fmtDate(c.apiKeyLastUsedAt)}</Row>}
                <Row label="Webhook">
                  {c.webhookUrl
                    ? slack
                      ? 'Slack channel webhook (hidden)'
                      : c.webhookUrl
                    : 'None'}
                </Row>
                <Row label="Failed deliveries">
                  {c.failedDeliveries}{' '}
                  {c.failedDeliveries ? (
                    <Link
                      href="/app/settings/developers?deliveries=failed"
                      className="text-primary underline"
                    >
                      View log
                    </Link>
                  ) : null}
                </Row>
              </dl>
              {perms.manage && perms.apiManage ? (
                <div className="mt-3 flex justify-end">
                  <DisconnectForm provider={c.provider} name={name} />
                </div>
              ) : null}
            </article>
          </li>
        );
      })}
    </ul>
  );
}
