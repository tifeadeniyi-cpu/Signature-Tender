import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react';
import {
  INTEGRATION_CAPABILITIES,
  canConnect,
  connectionState,
  getIntegration,
  hasPermission,
  listConnections,
  listIntegrationActivity,
  readDriveSettings,
} from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { availabilityOf } from '@/lib/integrations';
import { Card } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import {
  AppMark,
  AvailabilityBadge,
  ConnectionStatus,
  JOB_STATUS,
  OPERATION_LABEL,
} from '@/components/integrations/ui';
import { ConnectForm, DisconnectForm } from '../connect-forms';
import { DriveSettingsForm, OAuthDisconnectForm } from './drive-settings';

const fmt = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
    : 'Not yet';

const ERRORS: Record<string, string> = {
  cancelled: 'You cancelled the Google authorization. Nothing was connected.',
  state: 'That connection attempt expired or did not come from this browser session. Start again.',
  forbidden: 'Your role does not allow connecting integrations. Ask a workspace owner or admin.',
  unavailable: 'This integration is not available right now.',
  scope:
    'Google Drive access was not granted. Connect again and allow access to the files you choose.',
  provider: 'Google could not complete the connection. Try again in a moment.',
};

export default async function IntegrationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const info = getIntegration(key);
  if (!info) notFound();
  const { user, membership } = await requireWorkspace();
  const actor = { userId: user.id };
  const ws = membership.workspace.id;
  const perms = membership.permissions;
  const canManage = hasPermission(perms, 'integrations.manage');
  const canManagePartner = canManage && hasPermission(perms, 'api.manage');
  const canSeeLog = canManage || hasPermission(perms, 'audit.view');
  const availability = await availabilityOf(info);
  const conn = (await listConnections(db(), actor, ws)).find((c) => c.provider === key);
  const state = connectionState(conn);
  const live = state === 'connected' || state === 'expired' || state === 'error';
  const activity =
    canSeeLog && conn
      ? await listIntegrationActivity(db(), actor, ws, { provider: key, limit: 8 })
      : [];

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/app/integrations"
        className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> All integrations
      </Link>
      {sp.connected ? (
        <Alert tone="success" className="mb-4">
          {info.name} is connected.
        </Alert>
      ) : null}
      {sp.error ? (
        <Alert tone="error" className="mb-4">
          {ERRORS[sp.error] ?? ERRORS.provider}
        </Alert>
      ) : null}

      <Card as="article" className="mb-6">
        <div className="flex flex-wrap items-start gap-4">
          <AppMark name={info.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl">{info.name}</h2>
            <p className="text-sm">
              {info.category} · by {info.provider}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <AvailabilityBadge value={availability} />
              <ConnectionStatus value={state} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {info.kind === 'oauth' && canConnect(availability) && canManage ? (
              <Link
                href={`/api/integrations/${key}/connect`}
                prefetch={false}
                className={buttonClass(live ? 'secondary' : 'gold', 'md')}
              >
                {live ? 'Reconnect' : `Connect ${info.name}`}
              </Link>
            ) : null}
          </div>
        </div>
        <p className="mt-4 text-sm">{info.description}</p>
        {info.note ? <p className="mt-2 text-sm font-semibold text-heading">{info.note}</p> : null}
        {state === 'expired' ? (
          <Alert tone="warning" className="mt-4">
            The connection has expired or access was withdrawn
            {conn?.lastError ? `: ${conn.lastError}` : '.'} Reconnect to resume.
          </Alert>
        ) : state === 'error' && conn?.lastError ? (
          <Alert tone="warning" className="mt-4">
            Last error ({fmt(conn.lastErrorAt)}): {conn.lastError}
          </Alert>
        ) : null}
        {info.kind === 'oauth' && !canManage && !live ? (
          <p className="mt-4 text-sm">Only owners and admins can connect integrations.</p>
        ) : null}
      </Card>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 font-display text-lg">Supported features</h3>
          {info.capabilities.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {info.capabilities.map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <Check className="size-4 text-success" aria-hidden />{' '}
                  {INTEGRATION_CAPABILITIES[c]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">Not yet defined.</p>
          )}
          {!info.available ? (
            <p className="mt-3 text-xs">
              Planned. These features are not available until the integration launches.
            </p>
          ) : null}
        </Card>
        <Card>
          <h3 className="mb-2 flex items-center gap-2 font-display text-lg">
            <ShieldCheck className="size-5 text-gold" aria-hidden /> What it can access
          </h3>
          {info.access?.length ? (
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
              {info.access.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">
              Access details will be published before this integration launches.
            </p>
          )}
          {info.kind === 'oauth' ? (
            <p className="mt-3 text-xs">
              Tokens are encrypted and kept on our servers. Signed documents and signing evidence
              always stay in Signature Tender, whether or not you disconnect.
            </p>
          ) : null}
        </Card>
      </div>

      {info.setup?.length ? (
        <Card className="mb-6">
          <h3 className="mb-2 font-display text-lg">Setup</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            {info.setup.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Card>
      ) : null}

      {info.kind === 'oauth' && conn && live ? (
        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <h3 className="font-display text-lg">Connection</h3>
            <div className="flex flex-wrap gap-2">
              {key === 'google_drive' &&
              hasPermission(perms, 'documents.create') &&
              state === 'connected' ? (
                <Link href="/app/documents/new" className={buttonClass('primary', 'sm')}>
                  Send a Drive file
                </Link>
              ) : null}
            </div>
          </div>
          <dl className="mb-6 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold text-heading">Authorized account</dt>
            <dd>{conn.externalAccountLabel ?? 'Unknown'}</dd>
            <dt className="font-semibold text-heading">Connected by</dt>
            <dd>{conn.connectedByName ?? 'A former member'}</dd>
            <dt className="font-semibold text-heading">Connected</dt>
            <dd>{fmt(conn.connectedAt ?? conn.createdAt)}</dd>
            <dt className="font-semibold text-heading">Last successful sync</dt>
            <dd>{fmt(conn.lastSuccessAt)}</dd>
            <dt className="font-semibold text-heading">Permission</dt>
            <dd>
              {conn.scopes.some((s) => s.endsWith('/drive.file'))
                ? 'Files you pick and files Signature Tender creates'
                : conn.scopes.join(', ') || 'None'}
            </dd>
          </dl>
          {key === 'google_drive' ? (
            <DriveSettingsForm
              settings={readDriveSettings(conn.settings)}
              canManage={canManage && state === 'connected'}
            />
          ) : null}
          {canManage ? (
            <div className="mt-6 border-t border-border pt-4">
              <OAuthDisconnectForm provider={key} name={info.name} />
            </div>
          ) : null}
        </Card>
      ) : null}

      {info.kind !== 'oauth' && info.available ? (
        <Card className="mb-6">
          <h3 className="mb-3 font-display text-lg">Connection</h3>
          {canManagePartner ? (
            <ConnectForm
              provider={info.key}
              name={info.name}
              connected={Boolean(conn && conn.status === 'active')}
              kind={info.kind === 'slack' ? 'slack' : 'api'}
            />
          ) : !conn || conn.status !== 'active' ? (
            <p className="text-sm">
              Only owners, admins and API developers can connect this integration.
            </p>
          ) : null}
          {conn && conn.status === 'active' ? (
            <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {info.kind === 'slack' ? null : (
                  <>
                    <dt className="font-semibold text-heading">API key</dt>
                    <dd className="font-mono">
                      {conn.apiKeyPrefix ? `${conn.apiKeyPrefix}…` : 'None'}
                    </dd>
                    <dt className="font-semibold text-heading">Last used</dt>
                    <dd>{fmt(conn.apiKeyLastUsedAt)}</dd>
                  </>
                )}
                <dt className="font-semibold text-heading">Webhook</dt>
                <dd className="break-all">
                  {conn.webhookUrl
                    ? info.kind === 'slack'
                      ? 'Slack channel webhook (hidden)'
                      : conn.webhookUrl
                    : 'None'}
                </dd>
                <dt className="font-semibold text-heading">Failed deliveries</dt>
                <dd>
                  {conn.failedDeliveries}
                  {conn.failedDeliveries ? (
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
                <dt className="font-semibold text-heading">Connected</dt>
                <dd>{fmt(conn.connectedAt ?? conn.updatedAt)}</dd>
              </dl>
              {canManagePartner ? <DisconnectForm provider={info.key} name={info.name} /> : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {activity.length ? (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-display text-lg">Recent activity</h3>
            <Link
              href={`/app/integrations/activity?provider=${key}`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View all <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          <ul className="divide-y divide-border text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {OPERATION_LABEL[a.operation] ?? a.operation}
                  {typeof a.details?.name === 'string'
                    ? ` · ${a.details.name}`
                    : typeof a.details?.title === 'string'
                      ? ` · ${a.details.title}`
                      : ''}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={JOB_STATUS[a.status]?.tone ?? 'neutral'}>
                    {JOB_STATUS[a.status]?.label ?? a.status}
                  </Badge>
                  <span className="text-xs">{fmt(a.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
