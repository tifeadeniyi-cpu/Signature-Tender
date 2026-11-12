import Link from 'next/link';
import {
  API_SCOPES,
  WEBHOOK_EVENTS,
  hasPermission,
  isFeatureEnabled,
  listApiKeys,
  listWebhookDeliveries,
  listWebhookEndpoints,
} from '@st/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { requireWorkspace } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import {
  CreateKeyForm,
  KeyRowActions,
  CreateWebhookForm,
  WebhookRowActions,
  RetryButton,
  DeliveryStatus,
} from './panels';

export const metadata = { title: 'Developers' };

/** Request time, read outside render so the component stays pure. */
const currentTime = () => Date.now();

const fmt = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
    : 'Never';

export default async function DevelopersPage({
  searchParams,
}: {
  searchParams: Promise<{ deliveries?: string }>;
}) {
  const { user, membership } = await requireWorkspace();
  const ws = membership.workspace.id;
  if (!hasPermission(membership.permissions, 'api.manage'))
    return (
      <Alert tone="info">
        Only owners, admins and API developers can manage API keys and webhooks.
      </Alert>
    );
  const actor = { userId: user.id };
  const onlyFailed = (await searchParams).deliveries === 'failed';
  const [apiOn, keys, hooks, deliveries] = await Promise.all([
    isFeatureEnabled(db(), 'public_api', env().APP_ENV),
    listApiKeys(db(), actor, ws),
    listWebhookEndpoints(db(), actor, ws),
    listWebhookDeliveries(db(), actor, ws, { status: onlyFailed ? 'dead' : undefined, limit: 50 }),
  ]);
  const now = currentTime();
  const active = keys.filter((k) => !k.revokedAt && (!k.expiresAt || k.expiresAt.getTime() > now));
  const inactive = keys.filter((k) => !active.includes(k));

  return (
    <div className="flex flex-col gap-6">
      {apiOn ? null : (
        <Alert tone="warning">
          The API is turned off in this environment. You can prepare keys and webhooks, but API
          requests are refused and webhooks are not sent until the owner turns the API on.
        </Alert>
      )}
      <Card>
        <CardHeader
          title="API keys"
          description="Keys let your own software use Signature Tender. A key acts as you, limited to its scopes and to this workspace. Treat it like a password."
          action={
            <Link href="/developers" className="text-sm font-semibold text-primary hover:underline">
              API documentation
            </Link>
          }
        />
        {active.length ? (
          <ul className="mb-6 divide-y divide-border rounded-xl border border-border">
            {active.map((k) => (
              <li key={k.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold text-heading">{k.name}</p>
                  <p className="font-mono text-xs">{k.prefix}…</p>
                  <p className="mt-1 text-xs">
                    Created by {k.createdByName} · Last used {fmt(k.lastUsedAt)} ·{' '}
                    {k.expiresAt ? `Expires ${fmt(k.expiresAt)}` : 'Does not expire'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <Badge key={s} tone="neutral">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
                <KeyRowActions id={k.id} name={k.name} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-6 text-sm">No active keys.</p>
        )}
        <h3 className="mb-3 font-semibold text-heading">Create a key</h3>
        <CreateKeyForm scopes={Object.entries(API_SCOPES)} />
        {inactive.length ? (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-semibold text-heading">
              Revoked and expired keys ({inactive.length})
            </summary>
            <ul className="mt-2 text-sm">
              {inactive.map((k) => (
                <li key={k.id} className="py-1">
                  {k.name} <span className="font-mono text-xs">{k.prefix}…</span>{' '}
                  {k.revokedAt ? `revoked ${fmt(k.revokedAt)}` : `expired ${fmt(k.expiresAt)}`}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Webhooks"
          description="We POST signed JSON to your endpoint when requests change. Payloads carry ids and status, never document contents. Failed deliveries are retried with increasing delays."
        />
        {hooks.length ? (
          <ul className="mb-6 divide-y divide-border rounded-xl border border-border">
            {hooks.map((h) => (
              <li key={h.id} className="flex flex-col gap-3 p-4">
                <div>
                  <p className="break-all font-mono text-sm text-heading">{h.url}</p>
                  {h.description ? <p className="text-xs">{h.description}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {h.enabled ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="warning">Paused</Badge>
                    )}
                    <span className="text-xs">
                      {h.events.length ? h.events.join(', ') : 'All events'}
                    </span>
                  </div>
                  {h.previousSecretExpiresAt && h.previousSecretExpiresAt.getTime() > now ? (
                    <p className="mt-1 text-xs">
                      The previous secret also signs until {fmt(h.previousSecretExpiresAt)}.
                    </p>
                  ) : null}
                </div>
                <WebhookRowActions id={h.id} enabled={h.enabled} url={h.url} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-6 text-sm">No endpoints yet.</p>
        )}
        <h3 className="mb-3 font-semibold text-heading">Add an endpoint</h3>
        <CreateWebhookForm events={WEBHOOK_EVENTS} />
      </Card>

      <Card>
        <CardHeader
          title="Delivery log"
          description="The last 50 deliveries. Retry a failed one once your endpoint is fixed."
          action={
            <Link
              href={
                onlyFailed
                  ? '/app/settings/developers'
                  : '/app/settings/developers?deliveries=failed'
              }
              className="text-sm font-semibold text-primary hover:underline"
            >
              {onlyFailed ? 'Show all' : 'Show failed only'}
            </Link>
          }
        />
        {deliveries.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Event</th>
                  <th className="py-2 pr-3 font-semibold">Endpoint</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Attempts</th>
                  <th className="py-2 pr-3 font-semibold">Last result</th>
                  <th className="py-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-3">
                      <code className="font-mono text-xs">{d.eventType}</code>
                      <p className="text-xs">{fmt(d.createdAt)}</p>
                    </td>
                    <td className="max-w-48 truncate py-2 pr-3 font-mono text-xs" title={d.url}>
                      {d.url}
                    </td>
                    <td className="py-2 pr-3">
                      <DeliveryStatus status={d.status} />
                    </td>
                    <td className="py-2 pr-3">{d.attempts}</td>
                    <td className="py-2 pr-3 text-xs">
                      {d.lastError ??
                        (d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : 'Not tried yet')}
                      {d.status === 'failed' ? <p>Next try {fmt(d.nextAttemptAt)}</p> : null}
                    </td>
                    <td className="py-2">
                      {d.status === 'failed' || d.status === 'dead' ? (
                        <RetryButton id={d.id} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm">{onlyFailed ? 'No failed deliveries.' : 'No deliveries yet.'}</p>
        )}
      </Card>
    </div>
  );
}
