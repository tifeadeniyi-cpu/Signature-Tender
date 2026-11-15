import { formatMoney } from '@st/core';
import { getStudioAdminReport } from '@st/core/studio/server';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { studioSettings } from '@/lib/studio';
import { retryAssetsAction } from './actions';
import { StudioSettingsForm } from './settings-form';

export const metadata = { title: 'Signature Studio' };

const FUNNEL = [
  ['studio_visited', 'Visited the Studio'],
  ['design_started', 'Started a design'],
  ['auth_started', 'Asked to sign in'],
  ['draft_claimed', 'Signed in with a draft'],
  ['checkout_started', 'Started checkout'],
  ['purchase_completed', 'Paid'],
  ['download_clicked', 'Downloaded'],
] as const;

const when = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(d) + ' UTC' : '—');

export default async function AdminStudioPage() {
  const staff = await requireStaff();
  const [report, settings] = await Promise.all([getStudioAdminReport(db(), staff.id), studioSettings()]);
  const ev = Object.fromEntries(report.funnel.map((f) => [f.event, f]));
  const paid = report.totals.find((t) => t.status === 'paid');
  const refunded = report.totals.filter((t) => ['refunded', 'disputed', 'duplicate'].includes(t.status));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl text-heading">Signature Studio</h1>
        <p className="text-sm">Sales, conversion and settings. Names, artwork and emails are never shown here.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ['Paid designs', String(paid?.n ?? 0)],
          ['Revenue', formatMoney(paid?.cents ?? 0, 'USD')],
          ['Refunded or disputed', String(refunded.reduce((a, t) => a + t.n, 0))],
          ['Buyers who later sent a document', `${report.conversion?.buyers_sent ?? 0} of ${report.conversion?.buyers ?? 0}`],
        ].map(([k, v]) => (
          <Card key={k}>
            <p className="text-xs uppercase tracking-wide text-slate-500">{k}</p>
            <p className="mt-1 font-display text-2xl text-heading">{v}</p>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title="Funnel (last 30 days)" />
        <ol className="grid gap-2 sm:grid-cols-7">
          {FUNNEL.map(([k, label]) => (
            <li key={k} className="rounded-lg bg-ivory p-3">
              <p className="text-xs text-slate-text">{label}</p>
              <p className="font-display text-xl text-heading">{ev[k]?.people ?? 0}</p>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-slate-text">People counted once per account or browser. Buyers who paid for a signing request afterwards: {report.conversion?.buyers_paid_request ?? 0}.</p>
      </Card>
      <Card>
        <CardHeader title="Recent transactions" />
        {report.recent.length === 0 ? (
          <p className="text-sm">None yet.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recent transactions">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Purchase</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Refunded</th>
                  <th>Created</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 font-mono text-xs">{r.id.slice(0, 8)}</td>
                    <td>{r.status}</td>
                    <td>{formatMoney(r.amountCents, r.currency)}</td>
                    <td>{r.refunded ? formatMoney(r.refunded, r.currency) : '—'}</td>
                    <td>{when(r.createdAt)}</td>
                    <td className="max-w-xs truncate text-xs">{r.failureReason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Failed file generation" />
        {report.failedAssets.length === 0 ? (
          <p className="text-sm">None. Customers are never charged again for a retry.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {report.failedAssets.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-mono text-xs">{a.purchaseId.slice(0, 8)}</span> · {a.format.toUpperCase()} · {a.attempts} attempts · {a.error}
                </span>
                <form action={retryAssetsAction.bind(null, a.purchaseId)}>
                  <Button type="submit" size="sm" variant="secondary">
                    Retry
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Settings" />
        <StudioSettingsForm settings={settings} />
      </Card>
    </div>
  );
}
