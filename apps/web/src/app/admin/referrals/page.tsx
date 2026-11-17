import Link from 'next/link';
import { formatMoney, getReferralAdmin } from '@st/core';
import { Card, CardHeader } from '@/components/ui/card';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { AdjustForm, LinkStatusForm, ProgramForm, ReviewForm } from './forms';

export const metadata = { title: 'Referrals' };
export const dynamic = 'force-dynamic';

const RANGES = { '7': 7, '30': 30, '90': 90, year: 0 } as const;
const STATUSES = [
  'verification_pending',
  'verified',
  'awaiting_purchase',
  'under_review',
  'rewarded',
  'rejected',
  'reversed',
];
const day = (d: Date | string | null) =>
  d
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(d))
    : '—';

function rangeFrom(sp: { range?: string; from?: string; to?: string }) {
  const parse = (v?: string) =>
    v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  const from = parse(sp.from);
  const to = parse(sp.to);
  if (from && to) return { from, to: new Date(to.getTime() + 86400_000 - 1), key: 'custom' };
  const key = sp.range && sp.range in RANGES ? sp.range : '30';
  const now = new Date();
  const days = RANGES[key as keyof typeof RANGES];
  return {
    from: days
      ? new Date(now.getTime() - days * 86400_000)
      : new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
    to: now,
    key,
  };
}

export default async function AdminReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    status?: string;
    q?: string;
  }>;
}) {
  const { user: staff } = await requireAdmin('revenue.view', 'referrals');
  const sp = await searchParams;
  const r = rangeFrom(sp);
  const status = sp.status && STATUSES.includes(sp.status) ? sp.status : null;
  const data = await getReferralAdmin(db(), staff.id, {
    from: r.from,
    to: r.to,
    status,
    q: sp.q?.slice(0, 120) ?? null,
  });
  const m = data.metrics as Record<string, number>;
  const n = (k: string) => Number(m[k] ?? 0);
  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const funnel: [string, number][] = [
    ['Link visits', n('visits')],
    ['Registrations', n('registrations')],
    ['Email verified', n('verified')],
    ['First paid send', n('qualified')],
    ['Referrer rewarded', n('rewarded')],
  ];
  const qs = new URLSearchParams(
    Object.entries({
      range: sp.range,
      from: sp.from,
      to: sp.to,
      status: sp.status,
      q: sp.q,
    }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-heading">Referrals</h1>
          <p className="text-sm">
            {data.program.name}:{' '}
            <strong>{data.program.live ? 'running' : data.program.status}</strong>. Credits are
            future signing obligations, not revenue.
          </p>
        </div>
        <nav aria-label="Date range" className="flex flex-wrap gap-1 text-sm">
          {(['7', '30', '90', 'year'] as const).map((k) => (
            <Link
              key={k}
              href={`?range=${k}`}
              aria-current={r.key === k ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 ${r.key === k ? 'bg-primary font-semibold text-white' : 'border border-border bg-white'}`}
            >
              {k === 'year' ? 'This year' : `Last ${k} days`}
            </Link>
          ))}
          <form className="flex items-center gap-1">
            <label className="sr-only" htmlFor="from">
              From
            </label>
            <input
              id="from"
              type="date"
              name="from"
              defaultValue={sp.from}
              className="h-8 rounded-md border border-border px-2"
            />
            <label className="sr-only" htmlFor="to">
              To
            </label>
            <input
              id="to"
              type="date"
              name="to"
              defaultValue={sp.to}
              className="h-8 rounded-md border border-border px-2"
            />
            <button className="h-8 rounded-md border border-border bg-white px-2">Apply</button>
          </form>
        </nav>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ['Referral links', String(n('links')), `${n('revoked_links')} revoked`],
          ['Referred registrations', String(n('registrations')), `${n('verified')} verified`],
          ['Qualified referrals', String(n('qualified')), `${n('rewarded')} rewarded`],
          [
            'Waiting for review',
            String(n('under_review')),
            `${n('pending_rewards')} in settlement hold`,
          ],
          [
            'Fraud flags',
            String(n('flagged')),
            `${rate(n('rejected'), n('registrations'))} rejected`,
          ],
          ['Credits issued', String(n('credits_issued')), 'welcome, rewards, adjustments'],
          ['Credits redeemed', String(n('credits_redeemed')), 'used on sends, net of returns'],
          ['Outstanding credits', String(n('outstanding')), 'unused referral credits (liability)'],
          [
            'Referral-sourced revenue',
            formatMoney(n('sourced_revenue_cents'), 'USD'),
            'paid sends by referred customers, net of refunds',
          ],
          [
            'Acquisition cost',
            n('rewarded')
              ? `${(n('credits_issued') / Math.max(1, n('rewarded'))).toFixed(1)} credits`
              : '—',
            'credits issued per rewarded referral',
          ],
        ].map(([k, v, hint]) => (
          <Card key={k} className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{k}</p>
            <p className="mt-1 font-display text-2xl text-heading">{v}</p>
            <p className="text-xs">{hint}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Conversion funnel" description={`${day(r.from)} to ${day(r.to)}`} />
        <ol className="grid gap-3 sm:grid-cols-5">
          {funnel.map(([label, v], i) => (
            <li key={label} className="rounded-xl border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
              <p className="font-display text-2xl text-heading">{v}</p>
              {i > 0 ? (
                <p className="text-xs">{rate(v, funnel[i - 1]![1])} of previous step</p>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardHeader
          title="Referral records"
          description="Under review first. Approving pays whatever is due; every action is logged."
          action={
            <Link
              href={`/admin/referrals/export${qs ? `?${qs}` : ''}`}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-semibold"
            >
              Export CSV
            </Link>
          }
        />
        <form className="mb-4 flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="range" value={sp.range ?? ''} />
          <label className="sr-only" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={sp.q}
            placeholder="Email or code"
            className="h-9 rounded-md border border-border px-2"
          />
          <label className="sr-only" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ''}
            className="h-9 rounded-md border border-border px-2"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <button className="h-9 rounded-md bg-primary px-3 font-semibold text-white">
            Filter
          </button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Referral</th>
                <th className="py-2 pr-3">Referrer</th>
                <th className="py-2 pr-3">Referred</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Qualifying payment</th>
                <th className="py-2 pr-3">Credits</th>
                <th className="py-2 pr-3">Risk</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-3 pr-3">
                    <p className="font-mono text-xs">{row.id.slice(0, 8)}</p>
                    <p className="text-xs">
                      {day(row.registered_at)} · {row.source}
                    </p>
                  </td>
                  <td className="py-3 pr-3">
                    <p>{row.referrer_email}</p>
                    <p className="font-mono text-xs">
                      {row.code} {row.code_status === 'revoked' ? '(revoked)' : ''}
                    </p>
                    <p className="font-mono text-[10px] text-slate-500">
                      ws {row.referrer_workspace_id}
                    </p>
                  </td>
                  <td className="py-3 pr-3">{row.referred_email}</td>
                  <td className="py-3 pr-3">
                    <p className="font-semibold">{row.status.replace(/_/g, ' ')}</p>
                    {row.reason ? <p className="max-w-56 text-xs">{row.reason}</p> : null}
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs">
                    {row.qualification_payment_id ? row.qualification_payment_id.slice(0, 8) : '—'}
                    {row.reward_after ? (
                      <p className="font-sans">pays {day(row.reward_after)}</p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">{row.credits_issued}</td>
                  <td className="py-3 pr-3 text-xs">{(row.risk_flags ?? []).join(', ') || '—'}</td>
                  <td className="flex flex-col gap-2 py-3">
                    {row.status === 'under_review' ? <ReviewForm id={row.id} /> : null}
                    <LinkStatusForm identityId={row.identity_id} status={row.code_status} />
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center">
                    No referrals match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Adjust referral credits"
          description="Adds or removes referral credits through a logged ledger entry. Balances never go below zero."
        />
        <AdjustForm />
      </Card>

      <Card>
        <CardHeader
          title="Program settings"
          description="Changes are logged. Rewards already issued never change."
        />
        <ProgramForm program={data.program} />
      </Card>
    </div>
  );
}
