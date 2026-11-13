import Link from 'next/link';
import { INTEGRATIONS, getIntegration, hasPermission, listIntegrationActivity } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { Badge, PermissionDenied } from '@/components/ui/feedback';
import { JOB_STATUS, OPERATION_LABEL } from '@/components/integrations/ui';
import { RetryJobForm } from './retry-form';

export const metadata = { title: 'Activity & Sync Logs' };

const fmt = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'medium' }).format(d)
    : '—';
const STATUSES = ['succeeded', 'pending', 'retrying', 'failed', 'cancelled'];

export default async function IntegrationActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const { user, membership } = await requireWorkspace();
  const perms = membership.permissions;
  if (!hasPermission(perms, 'integrations.manage') && !hasPermission(perms, 'audit.view'))
    return <PermissionDenied what="view integration logs" />;
  const provider = INTEGRATIONS.some((i) => i.key === sp.provider) ? sp.provider : undefined;
  const status = STATUSES.includes(sp.status ?? '') ? sp.status : undefined;
  const rows = await listIntegrationActivity(db(), { userId: user.id }, membership.workspace.id, {
    provider,
    status,
    limit: 200,
  });
  const canRetry = hasPermission(perms, 'integrations.manage');
  return (
    <>
      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-heading">Integration</span>
          <select
            name="provider"
            defaultValue={provider ?? ''}
            className="h-10 rounded-lg border border-border bg-white px-3"
          >
            <option value="">All</option>
            {INTEGRATIONS.filter((i) => i.kind === 'oauth').map((i) => (
              <option key={i.key} value={i.key}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-heading">Result</span>
          <select
            name="status"
            defaultValue={status ?? ''}
            className="h-10 rounded-lg border border-border bg-white px-3"
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS[s]!.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-10 rounded-lg border border-border bg-white px-4 text-sm font-semibold text-heading hover:border-gold"
        >
          Filter
        </button>
      </form>
      <p className="mb-3 text-xs">
        Logs show actions and identifiers only. Tokens, keys and document contents are never
        recorded. Webhook deliveries to partner apps are under{' '}
        <Link href="/app/settings/developers" className="text-primary underline">
          Settings, Developers
        </Link>
        .
      </p>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center text-sm">
          No activity yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const st = JOB_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };
            const name =
              typeof r.details?.name === 'string'
                ? r.details.name
                : typeof r.details?.title === 'string'
                  ? r.details.title
                  : null;
            const files = Array.isArray(r.details?.files) ? (r.details.files as string[]) : [];
            return (
              <li key={r.id} className="rounded-xl border border-border bg-white">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                    <span className="w-full shrink-0 text-xs sm:w-44">{fmt(r.createdAt)}</span>
                    <span className="font-semibold text-heading">
                      {getIntegration(r.provider)?.name ?? r.provider}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {OPERATION_LABEL[r.operation] ?? r.operation}
                      {name ? ` · ${name}` : ''}
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="w-16 text-right text-xs">
                      {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : ''}
                    </span>
                  </summary>
                  <div className="border-t border-border px-4 py-3 text-sm">
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
                      <dt className="font-semibold text-heading">Connection</dt>
                      <dd>{r.accountLabel ?? '—'}</dd>
                      <dt className="font-semibold text-heading">Triggered by</dt>
                      <dd>{r.eventId ? 'Document completed (automatic)' : 'A member action'}</dd>
                      {r.documentId ? (
                        <>
                          <dt className="font-semibold text-heading">Document</dt>
                          <dd>
                            <Link
                              href={`/app/documents/${r.documentId}`}
                              className="text-primary underline"
                            >
                              Open in Signature Tender
                            </Link>
                          </dd>
                        </>
                      ) : null}
                      {r.externalReference ? (
                        <>
                          <dt className="font-semibold text-heading">External reference</dt>
                          <dd className="break-all font-mono text-xs">{r.externalReference}</dd>
                        </>
                      ) : null}
                      {files.length ? (
                        <>
                          <dt className="font-semibold text-heading">Saved</dt>
                          <dd>
                            {files.join(', ')}
                            {typeof r.details?.folder === 'string' ? ` in ${r.details.folder}` : ''}
                          </dd>
                        </>
                      ) : null}
                      <dt className="font-semibold text-heading">Attempts</dt>
                      <dd>{r.attempts}</dd>
                      {r.status === 'retrying' ? (
                        <>
                          <dt className="font-semibold text-heading">Next attempt</dt>
                          <dd>{fmt(r.nextAttemptAt)}</dd>
                        </>
                      ) : null}
                      {r.errorMessage ? (
                        <>
                          <dt className="font-semibold text-heading">Error</dt>
                          <dd className="text-error">
                            {r.errorMessage}
                            {r.errorCode ? (
                              <span className="ml-1 font-mono text-xs">({r.errorCode})</span>
                            ) : null}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                    {r.status === 'failed' && r.eventId && canRetry ? (
                      <div className="mt-3">
                        <RetryJobForm
                          jobId={r.id}
                          needsReconnect={
                            r.errorCode === 'auth_revoked' || r.errorCode === 'auth_expired'
                          }
                          provider={r.provider}
                        />
                      </div>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
