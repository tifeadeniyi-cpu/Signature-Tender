import {
  Building2,
  Users,
  Send,
  CircleCheck,
  Hourglass,
  TriangleAlert,
  Webhook,
  Coins,
  Code2,
} from 'lucide-react';
import { formatMoney, getAdminOverview, type RevenueRow } from '@st/core';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { BarChart } from '@/components/reports/bar-chart';

export const metadata = { title: 'Overview' };

const monthLabel = (m: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

function Revenue({ title, rows }: { title: string; rows: RevenueRow[] }) {
  const kinds: Record<string, string> = {
    request: 'One-time requests',
    credits: 'Credit packs',
    subscription: 'Subscriptions',
  };
  return (
    <Card>
      <CardHeader
        title={title}
        description="Net of refunds. Test-mode Stripe payments are included while Stripe is in test mode."
      />
      {rows.length ? (
        <dl className="flex flex-col gap-1 text-sm">
          {rows.map((r) => (
            <div
              key={r.currency + r.kind}
              className="flex justify-between border-b border-border/60 py-1"
            >
              <dt>
                {kinds[r.kind] ?? r.kind} <span className="text-xs">({r.payments})</span>
              </dt>
              <dd className="font-semibold tabular-nums text-heading">
                {formatMoney(Number(r.net_cents), r.currency.toUpperCase())}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm">No payments.</p>
      )}
    </Card>
  );
}

export default async function AdminOverviewPage() {
  const user = await requireStaff();
  const o = await getAdminOverview(db(), { userId: user.id });
  const n = (v: number) => Number(v).toLocaleString('en-US');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">Platform overview</h1>
      <section aria-label="Platform numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Workspaces"
          value={n(o.workspaces)}
          icon={<Building2 className="size-5" />}
          hint={`${n(o.active_workspaces_30d)} active in 30 days`}
        />
        <StatCard label="Users" value={n(o.users)} icon={<Users className="size-5" />} />
        <StatCard
          label="Live requests, 30 days"
          value={n(o.requests_30d)}
          icon={<Send className="size-5" />}
          hint={`${n(o.requests_total)} all time; ${n(o.test_requests_30d)} tests`}
        />
        <StatCard
          label="Completed, 30 days"
          value={n(o.completed_30d)}
          icon={<CircleCheck className="size-5" />}
        />
        <StatCard
          label="Waiting on signers"
          value={n(o.pending)}
          icon={<Hourglass className="size-5" />}
          hint={`${n(o.awaiting_payment)} waiting for payment`}
        />
        <StatCard
          label="Finishing failed"
          value={n(o.finalization_failed)}
          icon={<TriangleAlert className="size-5" />}
          hint="See Operations"
        />
        <StatCard
          label="Webhooks failed, 30 days"
          value={n(o.webhooks_dead_30d)}
          icon={<Webhook className="size-5" />}
          hint={`${n(o.webhooks_retrying)} retrying now`}
        />
        <StatCard
          label="Credits used, 30 days"
          value={n(o.credits_consumed_30d)}
          icon={<Coins className="size-5" />}
        />
        <StatCard
          label="API calls, 30 days"
          value={n(o.api_calls_30d)}
          icon={<Code2 className="size-5" />}
        />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Revenue title="Revenue this month" rows={o.revenue_month} />
        <Revenue title="Revenue, last 30 days" rows={o.revenue_30d} />
        <Card>
          <BarChart
            title="Live requests per month"
            unit="requests"
            data={o.requests_by_month.map((m) => ({
              label: monthLabel(m.month),
              value: Number(m.live),
            }))}
          />
        </Card>
        <Card>
          <BarChart
            title="Completed per month"
            unit="completed"
            data={o.requests_by_month.map((m) => ({
              label: monthLabel(m.month),
              value: Number(m.completed),
            }))}
          />
        </Card>
      </div>
      <p className="text-xs">
        Not tracked yet: support tickets and email delivery failures (bounces). They will appear
        here once those systems exist.
      </p>
    </div>
  );
}
