import Link from 'next/link';
import { Activity } from 'lucide-react';
import {
  CONNECTORS,
  getConnector,
  listIntegrationActivity,
  listIntegrationJobs,
  type ActivityStatus,
} from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { integrationPermissions } from '@/lib/integrations-view';
import { EmptyState } from '@/components/ui/feedback';
import { fmtDate } from '../_components/badges';
import { JobButtons } from '../_components/connection-forms';

export const metadata = { title: 'Activity & Sync Logs' };

const STATUS: Record<string, { label: string; cls: string }> = {
  success: { label: 'Success', cls: 'bg-success-bg text-success' },
  pending: { label: 'Pending', cls: 'bg-info-bg text-info' },
  retrying: { label: 'Retrying', cls: 'bg-warning-bg text-warning' },
  failed: { label: 'Failed', cls: 'bg-error-bg text-error' },
  cancelled: { label: 'Cancelled', cls: 'bg-cream text-slate-text' },
};

const ACTION_LABEL: Record<string, string> = {
  'connection.connected': 'Connected',
  'connection.reconnected': 'Reconnected',
  'connection.disconnected': 'Disconnected',
  'connection.authorize': 'Authorization',
  'connection.test': 'Connection test',
};

const UUID = /^[0-9a-f-]{36}$/i;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user, membership } = await requireWorkspace();
  const perms = integrationPermissions(membership);
  const sp = await searchParams;
  const provider = CONNECTORS.some((c) => c.key === sp.provider) ? sp.provider : undefined;
  const status = sp.status && STATUS[sp.status] ? (sp.status as ActivityStatus) : undefined;
  const connectionId = sp.connection && UUID.test(sp.connection) ? sp.connection : undefined;
  const before =
    sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : undefined;
  const actor = { userId: user.id };
  const [rows, jobs] = await Promise.all([
    listIntegrationActivity(db(), actor, membership.workspace.id, {
      provider,
      status,
      connectionId,
      before,
      limit: 50,
    }),
    listIntegrationJobs(db(), actor, membership.workspace.id, { connectionId, limit: 200 }),
  ]);
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const usedProviders = CONNECTORS.filter((c) => c.implemented);

  return (
    <>
      {perms.viewLogs || perms.manage ? null : (
        <p className="mb-4 text-sm">
          You see your own integration activity. Admins see the whole workspace.
        </p>
      )}
      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm">
          <span className="block font-semibold text-heading">Integration</span>
          <select
            name="provider"
            defaultValue={provider ?? ''}
            className="mt-1 h-10 rounded-lg border border-border bg-white px-2 text-sm"
          >
            <option value="">All</option>
            {usedProviders.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-heading">Result</span>
          <select
            name="status"
            defaultValue={status ?? ''}
            className="mt-1 h-10 rounded-lg border border-border bg-white px-2 text-sm"
          >
            <option value="">All</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        {connectionId ? <input type="hidden" name="connection" value={connectionId} /> : null}
        <button
          type="submit"
          className="h-10 rounded-lg border border-border bg-white px-4 text-sm font-semibold text-heading hover:bg-cream"
        >
          Filter
        </button>
        {provider || status || connectionId ? (
          <Link href="/app/integrations/activity" className="text-sm text-primary underline">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={<Activity className="size-5" />} title="No activity yet">
          Connections, syncs and automation runs will be logged here. Logs never include tokens,
          document contents or recipients&rsquo; personal details.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Integration activity, newest first</caption>
            <thead className="border-b border-border bg-cream text-xs uppercase tracking-wide text-heading">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Date and time
                </th>
                <th scope="col" className="px-4 py-3">
                  Integration
                </th>
                <th scope="col" className="px-4 py-3">
                  Action
                </th>
                <th scope="col" className="px-4 py-3">
                  References
                </th>
                <th scope="col" className="px-4 py-3">
                  Result
                </th>
                <th scope="col" className="px-4 py-3">
                  Duration
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const def = getConnector(r.provider);
                const action =
                  ACTION_LABEL[r.action] ??
                  def?.actions.find((a) => a.key === r.action)?.label ??
                  r.action;
                const s = STATUS[r.status] ?? STATUS.pending!;
                const job = r.jobId ? jobById.get(r.jobId) : undefined;
                return (
                  <tr key={r.id} className="border-b border-border align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-3">{fmtDate(r.occurredAt)}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-heading">{def?.name ?? r.provider}</span>
                      {r.connectionLabel ? (
                        <span className="block text-xs">{r.connectionLabel}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{action}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.externalReference ? (
                        <span className="block">External: {r.externalReference}</span>
                      ) : null}
                      {r.documentId ? (
                        <Link
                          href={`/app/documents/${r.documentId}`}
                          className="block text-primary underline"
                        >
                          Envelope
                        </Link>
                      ) : null}
                      {!r.externalReference && !r.documentId ? '—' : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}
                      >
                        {s.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.durationMs != null ? `${r.durationMs} ms` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <details>
                        <summary className="cursor-pointer text-primary underline">Details</summary>
                        <dl className="mt-2 grid max-w-sm grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                          {r.message ? (
                            <>
                              <dt className="font-semibold">Summary</dt>
                              <dd>{r.message}</dd>
                            </>
                          ) : null}
                          {r.errorCode ? (
                            <>
                              <dt className="font-semibold">Error</dt>
                              <dd className="font-mono">{r.errorCode}</dd>
                            </>
                          ) : null}
                          {r.correlationId ? (
                            <>
                              <dt className="font-semibold">Triggering event</dt>
                              <dd className="font-mono break-all">{r.correlationId}</dd>
                            </>
                          ) : null}
                          {r.requestId ? (
                            <>
                              <dt className="font-semibold">Request</dt>
                              <dd className="font-mono break-all">{r.requestId}</dd>
                            </>
                          ) : null}
                          {job ? (
                            <>
                              <dt className="font-semibold">Job</dt>
                              <dd>
                                {job.status}, attempt {job.attemptCount} of {job.maxAttempts}
                                {job.status === 'retrying'
                                  ? `, next try ${fmtDate(job.nextAttemptAt)}`
                                  : ''}
                              </dd>
                            </>
                          ) : null}
                        </dl>
                        {job && perms.manage ? (
                          <div className="mt-2">
                            <JobButtons id={job.id} status={job.status} />
                          </div>
                        ) : null}
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 50 ? (
        <p className="mt-4 text-sm">
          <Link
            className="text-primary underline"
            href={`/app/integrations/activity?${new URLSearchParams({
              ...(provider ? { provider } : {}),
              ...(status ? { status } : {}),
              ...(connectionId ? { connection: connectionId } : {}),
              before: new Date(rows[rows.length - 1]!.occurredAt).toISOString(),
            })}`}
          >
            Older activity
          </Link>
        </p>
      ) : null}
    </>
  );
}
