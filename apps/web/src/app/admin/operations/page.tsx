import { countLegacyCertificates, formatMoney, getAdminOperations } from '@st/core';
import { CertificateReissue } from './certificate-reissue';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';

export const metadata = { title: 'Operations' };

const fmt = (d: string | null) =>
  d
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(d)) + ' UTC'
    : '—';

function Table({
  label,
  head,
  rows,
}: {
  label: string;
  head: string[];
  rows: React.ReactNode[][];
}) {
  if (!rows.length) return <p className="text-sm">None.</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="py-2 pr-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="py-2 pr-3 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminOperationsPage() {
  const user = await requireStaff();
  const o = await getAdminOperations(db(), { userId: user.id }, 50);
  const legacyCertificates = await countLegacyCertificates(db());
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">Operations</h1>
      <Card>
        <CardHeader
          title="Certificates of Completion"
          description="Gives already-completed requests a new Certificate of Completion from their recorded evidence. The signed agreement and its evidence are not changed; the old certificate is kept in the file history and the new one says it was re-issued."
        />
        <CertificateReissue legacy={legacyCertificates} />
      </Card>
      {o.stripe_events_unprocessed || o.stuck_requests ? (
        <Alert tone="warning">
          {o.stripe_events_unprocessed} Stripe events unprocessed after 10 minutes;{' '}
          {o.stuck_requests} paid requests not dispatched after an hour.
        </Alert>
      ) : (
        <Alert tone="success">Stripe events are processed and paid requests are dispatched.</Alert>
      )}
      <Card>
        <CardHeader
          title="Finishing failures"
          description="Requests where everyone signed but the signed copy or certificate could not be built. The workspace can retry from the document page."
        />
        <Table
          label="Finishing failures"
          head={['Workspace', 'Request', 'When', 'Error']}
          rows={o.finalization_failures.map((f) => [
            f.workspace,
            <code key="r" className="font-mono text-xs">
              {f.request_id}
            </code>,
            fmt(f.updated_at),
            f.error ?? '—',
          ])}
        />
      </Card>
      <Card>
        <CardHeader
          title="Webhook failures"
          description="Retrying and failed deliveries across workspaces. Only the destination host is shown."
        />
        <Table
          label="Webhook failures"
          head={['Workspace', 'Event', 'Host', 'Status', 'Attempts', 'Last result', 'Last try']}
          rows={o.webhook_failures.map((w) => [
            w.workspace,
            <code key="e" className="font-mono text-xs">
              {w.event_type}
            </code>,
            w.host,
            <Badge key="s" tone={w.status === 'dead' ? 'error' : 'warning'}>
              {w.status === 'dead' ? 'Failed' : 'Retrying'}
            </Badge>,
            w.attempts,
            w.error ?? (w.last_status_code ? `HTTP ${w.last_status_code}` : '—'),
            fmt(w.last_attempt_at),
          ])}
        />
      </Card>
      <Card>
        <CardHeader
          title="Payment issues"
          description="Failed or disputed payments, and checkouts still pending after an hour (last 7 days)."
        />
        <Table
          label="Payment issues"
          head={['Workspace', 'Kind', 'Status', 'Amount', 'Created', 'Reason']}
          rows={o.payment_issues.map((p) => [
            p.workspace,
            p.kind,
            p.status,
            formatMoney(p.amount_cents, p.currency.toUpperCase()),
            fmt(p.created_at),
            p.reason ?? '—',
          ])}
        />
      </Card>
      <Card>
        <CardHeader
          title="Feature flags"
          description="Read-only here. Flags change in the database, by the owner."
        />
        <ul className="grid gap-2 sm:grid-cols-2">
          {o.feature_flags.map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <code className="font-mono text-xs">{f.key}</code>
              <span className="flex items-center gap-2">
                {f.environments.length ? (
                  <span className="text-xs">{f.environments.join(', ')}</span>
                ) : null}
                <Badge tone={f.enabled ? 'success' : 'neutral'}>{f.enabled ? 'On' : 'Off'}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
