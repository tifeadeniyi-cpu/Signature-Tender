import Link from 'next/link';
import { ChartColumn, Send, CircleCheck, Timer, Percent, Download } from 'lucide-react';
import {
  DOCUMENT_TYPES,
  defaultRange,
  getWorkspaceReport,
  reportRangeSchema,
  AppError,
} from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Alert, PermissionDenied } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { BarChart, RankList } from '@/components/reports/bar-chart';

export const metadata = { title: 'Reports' };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const typeLabel = (v: string) => DOCUMENT_TYPES.find((d) => d.value === v)?.label ?? v;
const monthLabel = (m: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );
const hoursLabel = (h: number | null) =>
  h === null ? '—' : h < 48 ? `${h.toLocaleString('en-US')} h` : `${(h / 24).toFixed(1)} days`;

const PRESETS = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last 12 months' },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { user, membership } = await requireWorkspace();
  const fallback = defaultRange(90);
  const parsed = reportRangeSchema.safeParse({
    from: one(sp.from) ?? fallback.from,
    to: one(sp.to) ?? fallback.to,
  });
  const range = parsed.success ? parsed.data : fallback;
  const includeTests = one(sp.tests) === '1';

  let report;
  try {
    report = await getWorkspaceReport(db(), { userId: user.id }, membership.workspace.id, range, {
      includeTests,
    });
  } catch (err) {
    if (err instanceof AppError && err.code === 'forbidden')
      return <PermissionDenied what="view reports" />;
    throw err;
  }
  const t = report.totals;
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({
      from: range.from,
      to: range.to,
      ...(includeTests ? { tests: '1' } : {}),
      ...extra,
    }).toString();
  const seeAll = membership.permissions.includes('documents.view_all');

  return (
    <>
      <PageHeader
        icon={<ChartColumn className="size-8" />}
        title="Reports"
        description={`Signing activity in ${membership.workspace.name}${seeAll ? '' : ' for documents you created'}.`}
        actions={
          <a href={`/api/reports/export?${qs({})}`} className={buttonClass('secondary', 'md')}>
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        }
      />

      <form
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-white p-4"
        aria-label="Report range"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-sm font-medium text-heading">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={range.from}
            className="h-10 rounded-lg border border-border px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-sm font-medium text-heading">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={range.to}
            className="h-10 rounded-lg border border-border px-3 text-sm"
          />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="tests"
            value="1"
            defaultChecked={includeTests}
            className="size-4"
          />
          Include test requests
        </label>
        <button type="submit" className={buttonClass('primary', 'md')}>
          Update
        </button>
        <ul className="flex flex-wrap gap-2 text-sm" aria-label="Quick ranges">
          {PRESETS.map((p) => {
            const r = defaultRange(p.days);
            return (
              <li key={p.days}>
                <Link
                  href={`/app/reports?${new URLSearchParams({ ...r, ...(includeTests ? { tests: '1' } : {}) })}`}
                  className="inline-flex h-10 items-center rounded-lg px-2 text-primary hover:bg-primary-surface"
                >
                  {p.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </form>
      {parsed.success ? null : (
        <Alert tone="warning" className="mb-4">
          That date range was not valid, so the last 90 days are shown.
        </Alert>
      )}

      <section aria-label="Headline numbers" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Sent"
          value={t.sent.toLocaleString('en-US')}
          icon={<Send className="size-5" />}
          hint={includeTests ? 'Including tests' : 'Live requests'}
        />
        <StatCard
          label="Completed"
          value={t.completed.toLocaleString('en-US')}
          icon={<CircleCheck className="size-5" />}
        />
        <StatCard
          label="Completion rate"
          value={
            report.completionRate === null ? '—' : `${Math.round(report.completionRate * 100)}%`
          }
          icon={<Percent className="size-5" />}
          hint="Of requests that finished"
        />
        <StatCard
          label="Median time to complete"
          value={hoursLabel(report.medianHoursToComplete)}
          icon={<Timer className="size-5" />}
          hint={
            report.averageHoursToComplete === null
              ? undefined
              : `Average ${hoursLabel(report.averageHoursToComplete)}`
          }
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <BarChart
            title="Requests sent per month"
            unit="sent"
            data={report.byMonth.map((m) => ({ label: monthLabel(m.month), value: m.sent }))}
          />
        </Card>
        <Card>
          <BarChart
            title="Requests completed per month"
            unit="completed"
            data={report.byMonth.map((m) => ({ label: monthLabel(m.month), value: m.completed }))}
          />
        </Card>
        <Card>
          <CardHeader title="Where requests stand" />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {[
              ['Waiting on signers', t.open],
              ['Waiting for payment', t.awaitingPayment],
              ['Completed', t.completed],
              ['Declined', t.declined],
              ['Expired', t.expired],
              ['Cancelled', t.cancelled],
              ...(t.failed ? ([['Finishing failed', t.failed]] as [string, number][]) : []),
            ].map(([k, v]) => (
              <div
                key={k as string}
                className="flex justify-between gap-2 border-b border-border/60 py-1"
              >
                <dt>{k}</dt>
                <dd className="font-semibold tabular-nums text-heading">
                  {(v as number).toLocaleString('en-US')}
                </dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-5 text-sm font-semibold text-heading">Recipients</h3>
          <p className="mt-1 text-sm">
            {report.recipients.total.toLocaleString('en-US')} asked to act ·{' '}
            {report.recipients.viewed.toLocaleString('en-US')} opened ·{' '}
            {report.recipients.signed.toLocaleString('en-US')} signed or approved ·{' '}
            {report.recipients.declined.toLocaleString('en-US')} declined
          </p>
        </Card>
        <Card>
          <RankList
            title="By document type"
            unit="sent"
            rows={report.byType.map((r) => ({
              label: typeLabel(r.documentType),
              value: r.sent,
              note: `${r.completed} completed`,
            }))}
          />
        </Card>
        {seeAll ? (
          <Card>
            <RankList
              title="By sender"
              unit="sent"
              rows={report.bySender.map((r) => ({
                label: r.name,
                value: r.sent,
                note: `${r.completed} completed`,
              }))}
            />
          </Card>
        ) : null}
        {report.credits ? (
          <Card>
            <BarChart
              title="Credits used per month"
              unit="credits"
              data={report.credits.map((c) => ({ label: monthLabel(c.month), value: c.used }))}
            />
            <p className="mt-3 text-xs">
              {report.credits.reduce((s, c) => s + c.added, 0).toLocaleString('en-US')} credits
              added in this range.{' '}
              <Link href="/app/billing" className="font-semibold text-primary underline">
                Billing & Credits
              </Link>
            </p>
          </Card>
        ) : null}
        {report.api ? (
          <Card>
            <BarChart
              title="API calls per day"
              unit="calls"
              data={report.api.map((a) => ({ label: a.day, value: a.calls }))}
              empty="No API calls in this range."
            />
            <p className="mt-3 text-xs">
              {report.api.reduce((s, a) => s + a.errors, 0).toLocaleString('en-US')} calls returned
              an error. Webhooks: {report.webhooks!.succeeded} delivered,{' '}
              {report.webhooks!.retrying} retrying, {report.webhooks!.failed} failed.{' '}
              <Link
                href="/app/settings/developers"
                className="font-semibold text-primary underline"
              >
                Developers
              </Link>
            </p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
