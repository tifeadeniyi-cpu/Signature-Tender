import Link from 'next/link';
import {
  Users,
  Building2,
  FileText,
  CircleCheck,
  PenLine,
  Coins,
  Download,
  ShieldCheck,
  ShieldAlert,
  CircleDashed,
} from 'lucide-react';
import {
  COMPARE_LABEL,
  formatMoney,
  getCommandCenter,
  pctChange,
  rate,
  resolvePeriod,
  type CommandCenter,
  type Period,
} from '@st/core';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { stripeLiveMode } from '@/lib/stripe';
import { Kpi } from '@/components/admin/kpi';
import { ColumnChart, Donut, Legend, Panel, ProgressBars, SERIES } from '@/components/admin/charts';
import { PeriodFilter } from '@/components/admin/period-filter';

export const metadata = { title: 'Command Center' };

type Search = { range?: string; compare?: string; from?: string; to?: string; growth?: string };

const nf = (n: number) => n.toLocaleString('en-US');
const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);

function bucketLabel(iso: string, bucket: Period['bucket']) {
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...o, timeZone: 'UTC' }).format(d);
  if (bucket === 'month') return f({ month: 'short', year: '2-digit' });
  return bucket === 'week'
    ? `Wk ${f({ month: 'short', day: 'numeric' })}`
    : f({ month: 'short', day: 'numeric' });
}

const FEATURE_LABEL: Record<string, string> = {
  send: 'Send for Signature',
  templates: 'Templates',
  studio: 'Signature Studio',
  team: 'Team Collaboration',
  integrations: 'Integrations',
  api: 'API & Webhooks',
  contacts: 'Contacts',
};
const ACTIVITY_LABEL: Record<string, string> = {
  user_registered: 'New user registered',
  organization_registered: 'New organization registered',
  payment_request: 'Payment received: single request',
  payment_credits: 'Payment received: credit pack',
  payment_subscription: 'Payment received: subscription',
  studio_purchase: 'Signature Studio purchase',
  integration_connected: 'Integration connected',
  finalization_failed: 'Document finishing failed',
  webhook_dead: 'Webhook delivery gave up',
  payment_failed: 'Payment failed',
};
const typeLabel = (t: string) =>
  t === 'small_groups'
    ? 'Other (small groups)'
    : t === 'uncategorized'
      ? 'Uncategorized'
      : t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

function Revenue({ c, p }: { c: CommandCenter; p: Period }) {
  const main = c.revenue?.totals[0];
  const cur = main?.currency ?? 'USD';
  const series = (c.revenue?.series ?? []).filter((s) => s.currency === cur);
  const labels = c.growth.map((g) => bucketLabel(g.start, p.bucket));
  const values = c.growth.map((g) => series.find((s) => s.start === g.start)?.net ?? 0);
  return (
    <Panel
      title="Revenue Trend"
      info="Net collected = successful payments minus refunds and disputed amounts, by the date paid. Includes single requests, credit packs, subscriptions and Signature Studio. Spending credits is not counted again."
      action={
        main ? (
          <span className="font-display text-xl text-heading">
            {formatMoney(main.net ?? 0, cur)}
          </span>
        ) : null
      }
    >
      <ColumnChart
        caption={`Net collected revenue per interval, ${cur}`}
        labels={labels}
        series={[{ name: `Net collected (${cur})`, color: SERIES.gold, values }]}
        format={(n) => formatMoney(n, cur).replace(/\.00$/, '')}
        empty="No payments were collected in this period."
      />
      {(c.revenue?.totals.length ?? 0) > 1 ? (
        <p className="text-xs">
          Other currencies are listed in the export; no conversion is applied.
        </p>
      ) : null}
      {!stripeLiveMode() ? (
        <p className="text-xs text-slate-text">
          Stripe is in test mode, so these are test payments.
        </p>
      ) : null}
    </Panel>
  );
}

export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const { user, access } = await requireAdmin('analytics.view', 'command_center');
  const p = resolvePeriod(sp);
  const c = await getCommandCenter(db(), { userId: user.id }, p);
  const k = c.kpi;
  const cmp = p.compare === 'none' ? null : COMPARE_LABEL[p.compare];
  const cohortRate = rate(k.cohort_completed, k.docs_sent);
  const cohortRateCmp = rate(k.cohort_completed_cmp ?? 0, k.docs_sent_cmp ?? 0);
  const money = c.revenue?.totals[0];
  const cumulative = sp.growth === 'cumulative';
  const filterParams = new URLSearchParams(
    Object.entries({
      range: p.range,
      compare: p.compare,
      from: sp.from ?? '',
      to: sp.to ?? '',
    }).filter(([, v]) => v),
  );
  const labels = c.growth.map((g) => bucketLabel(g.start, p.bucket));
  const st = c.studio;
  const conversion = rate(st.designs_purchased, st.designs);
  const docTypeTotal = c.doc_types.reduce((n, t) => n + t.count, 0);
  const h = c.health;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Platform Command Center</h1>
          <p className="mt-1 text-sm">
            Real-time insights, performance, and overall health of Signature Tender.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodFilter
            action="/admin"
            range={p.range}
            compare={p.compare}
            from={sp.from}
            to={sp.to}
            keep={sp.growth ? { growth: sp.growth } : {}}
          />
          <a
            href={`/admin/export?${filterParams}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-gold px-4 text-sm font-semibold text-heading hover:bg-soft-gold"
          >
            <Download className="size-4" aria-hidden /> Export report
          </a>
        </div>
      </div>
      <p className="-mt-3 text-xs text-slate-text">
        Live from the database at{' '}
        {new Intl.DateTimeFormat('en-US', {
          timeStyle: 'short',
          dateStyle: 'medium',
          timeZone: 'UTC',
        }).format(new Date(c.generated_at))}{' '}
        UTC. Periods are in UTC. Test requests are excluded.
      </p>

      <section
        aria-label="Key numbers"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-6"
      >
        <Kpi
          label="Total Users"
          value={nf(k.users_total)}
          icon={<Users className="size-5" />}
          change={pctChange(k.users_new, k.users_new_cmp)}
          compareLabel={cmp}
          sub={`${nf(k.users_new)} new in period (change is in new sign-ups)`}
          info="Registered accounts at the end of the period (lifetime total). The change compares new registrations in this period with the comparison period."
        />
        <Kpi
          label="Organizations"
          value={nf(k.orgs_total)}
          icon={<Building2 className="size-5" />}
          change={pctChange(k.orgs_new, k.orgs_new_cmp)}
          compareLabel={cmp}
          sub={`${nf(k.orgs_new)} new · ${nf(k.orgs_active)} sent a live request`}
          info="Workspaces at the end of the period (lifetime total). The change compares new workspaces. Active means the workspace sent at least one live request in the period."
          href="/admin/workspaces"
        />
        <Kpi
          label="Documents Processed"
          value={nf(k.docs_sent)}
          icon={<FileText className="size-5" />}
          change={pctChange(k.docs_sent, k.docs_sent_cmp)}
          compareLabel={cmp}
          sub={`${nf(k.docs_sent_total)} all time`}
          info="Live signing requests sent in the period, one per request. Test requests and unsent drafts are not counted."
        />
        <Kpi
          label="Documents Completed"
          value={nf(k.docs_completed)}
          icon={<CircleCheck className="size-5" />}
          change={pctChange(k.docs_completed, k.docs_completed_cmp)}
          compareLabel={cmp}
          sub={`Completion rate ${pct(cohortRate)}${cohortRateCmp != null && cmp ? ` (was ${pct(cohortRateCmp)})` : ''}`}
          info="Live requests that finished in the period. Completion rate: of the requests sent in the period, the share that are now completed."
        />
        <Kpi
          label="Signatures Created"
          value={nf(k.designs_new)}
          icon={<PenLine className="size-5" />}
          change={pctChange(k.designs_new, k.designs_new_cmp)}
          compareLabel={cmp}
          sub={`${nf(k.studio_purchases)} Signature Studio purchases`}
          info="Signature Studio designs created in the period (drafts included). No artwork is shown or read here."
        />
        {money ? (
          <Kpi
            label="Total Revenue"
            value={formatMoney(money.net ?? 0, money.currency)}
            icon={<Coins className="size-5" />}
            change={pctChange(money.net ?? 0, money.net_cmp)}
            compareLabel={cmp}
            sub={`Net collected · gross ${formatMoney(money.gross ?? 0, money.currency)}, refunds ${formatMoney(money.refunded ?? 0, money.currency)}`}
            info="Net collected revenue: successful payments in the period minus refunds and disputed amounts. Not authorisations. Credit spending is not counted again."
          />
        ) : c.revenue ? (
          <Kpi
            label="Total Revenue"
            value={formatMoney(0)}
            icon={<Coins className="size-5" />}
            change={null}
            compareLabel={null}
            sub="No payments in this period"
            info="Net collected revenue: successful payments minus refunds and disputes."
          />
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          title="Platform Growth"
          info="New registrations counts accounts and workspaces created in each interval. Cumulative shows the total at the end of each interval."
          action={
            <div
              className="flex rounded-lg border border-border p-0.5 text-xs"
              role="group"
              aria-label="Measure"
            >
              {(
                [
                  ['new', 'New registrations'],
                  ['cumulative', 'Cumulative'],
                ] as const
              ).map(([v, l]) => {
                const q = new URLSearchParams(filterParams);
                if (v === 'cumulative') q.set('growth', v);
                const active = (v === 'cumulative') === cumulative;
                return (
                  <Link
                    key={v}
                    href={`/admin?${q}`}
                    aria-current={active ? 'true' : undefined}
                    className={`rounded-md px-2 py-1 ${active ? 'bg-primary text-white' : 'text-heading hover:bg-cream'}`}
                  >
                    {l}
                  </Link>
                );
              })}
            </div>
          }
        >
          <Legend
            items={[
              { label: 'Users', color: SERIES.navy },
              { label: 'Organizations', color: SERIES.gold },
            ]}
          />
          <ColumnChart
            caption={
              cumulative
                ? 'Total users and organizations at the end of each interval'
                : 'New users and organizations per interval'
            }
            labels={labels}
            series={[
              {
                name: cumulative ? 'Users (total)' : 'New users',
                color: SERIES.navy,
                values: c.growth.map((g) => (cumulative ? g.users_total : g.users_new)),
              },
              {
                name: cumulative ? 'Organizations (total)' : 'New organizations',
                color: SERIES.gold,
                values: c.growth.map((g) => (cumulative ? g.orgs_total : g.orgs_new)),
              },
            ]}
          />
        </Panel>

        <Panel
          title="Document Status (All Organizations)"
          info="Cohort: live requests sent in the period, by their status now. Every request is in exactly one group, so the groups add up to the total."
        >
          <Donut
            caption="Status of live requests sent in the period"
            centerLabel="Documents"
            segments={[
              { label: 'Completed', value: c.doc_status.completed, color: SERIES.navy },
              { label: 'Pending', value: c.doc_status.pending, color: SERIES.gold },
              { label: 'Declined', value: c.doc_status.declined, color: SERIES.burgundy },
              { label: 'Expired', value: c.doc_status.expired, color: SERIES.gray },
              { label: 'Cancelled', value: c.doc_status.cancelled, color: SERIES.blue },
              ...(c.doc_status.failed
                ? [{ label: 'Finishing failed', value: c.doc_status.failed, color: '#5C1222' }]
                : []),
            ]}
          />
        </Panel>

        {c.revenue ? (
          <Revenue c={c} p={p} />
        ) : (
          <Panel title="Revenue Trend">
            <p className="text-sm">Revenue is visible to founder and finance roles.</p>
          </Panel>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          title="Top Features by Usage"
          info={`Adoption = people who used the feature in the period ÷ active people (${nf(c.features.active_users)}). Active means they took a recorded action in a workspace or created a Signature Studio design. Opening a page does not count.`}
        >
          <ProgressBars
            rows={c.features.rows.map((f) => ({
              label: FEATURE_LABEL[f.feature] ?? f.feature,
              value: rate(f.users, c.features.active_users) ?? 0,
              detail: `${nf(f.users)} of ${nf(c.features.active_users)} active people`,
            }))}
          />
        </Panel>

        <Panel
          title="Signature Studio Performance"
          info="Sessions: distinct designer sessions that started a design. Conversion: designs created in the period that were later bought ÷ designs created in the period. No signature artwork is read."
        >
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Designer Sessions', nf(st.sessions), pctChange(st.sessions, st.sessions_cmp)],
              ['Signatures Created', nf(st.designs), pctChange(k.designs_new, k.designs_new_cmp)],
              [
                'Purchases',
                nf(k.studio_purchases),
                pctChange(k.studio_purchases, k.studio_purchases_cmp),
              ],
              ['Conversion Rate', pct(conversion), null],
            ].map(([l, v, ch]) => (
              <div key={l as string} className="rounded-xl border border-border bg-ivory p-3">
                <p className="text-xs font-semibold text-heading">{l}</p>
                <p className="font-display text-2xl text-heading">{v}</p>
                {ch != null && cmp ? (
                  <p className="text-xs">
                    {(ch as number) > 0 ? '+' : ''}
                    {(ch as number).toFixed(1)}% vs. {cmp.toLowerCase()}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-text">
            {nf(st.downloads)} successful downloads in the period.
          </p>
        </Panel>

        <Panel
          title="Documents by Type (Platform-wide)"
          info="The document type each customer chose when uploading, for live requests sent in the period. Types with fewer than 5 documents are merged into Other so no single customer stands out. Document text is never read."
        >
          <ProgressBars
            rows={c.doc_types.map((t) => ({
              label: typeLabel(t.type),
              value: rate(t.count, docTypeTotal) ?? 0,
              detail: `${nf(t.count)} documents`,
            }))}
          />
        </Panel>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Recent Platform Activity">
          {c.activity.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {c.activity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full ${a.severity === 'warning' ? 'bg-burgundy' : 'bg-success'}`}
                      aria-hidden
                    />
                    {ACTIVITY_LABEL[a.kind] ?? a.kind}
                    {a.severity === 'warning' ? (
                      <span className="sr-only"> (needs attention)</span>
                    ) : null}
                  </span>
                  <span className="whitespace-nowrap text-xs text-slate-text">{ago(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No activity yet.</p>
          )}
        </Panel>

        {c.audit ? (
          <Panel
            title="Audit Trail"
            action={
              <Link
                href="/admin/audit"
                className="text-xs font-semibold text-primary hover:underline"
              >
                View all
              </Link>
            }
          >
            {c.audit.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {c.audit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/audit?event=${a.id}`} className="truncate hover:underline">
                      <code className="font-mono text-xs">{a.action}</code>
                    </Link>
                    <span className="whitespace-nowrap text-xs text-slate-text">{ago(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">No administrative events yet.</p>
            )}
          </Panel>
        ) : null}

        <Panel
          title="Security & Compliance"
          info="The actual state of controls in the app. No certification (SOC 2, ISO 27001, PCI) is held or claimed."
        >
          <ul className="flex flex-col gap-2 text-sm">
            {[
              {
                label: 'Staff sign-in protection',
                ok: c.security.staff_strong === c.security.staff,
                value: `${c.security.staff_strong} of ${c.security.staff} staff use 2FA or a passkey`,
              },
              {
                label: 'Audit log',
                ok: c.security.audit_append_only,
                value: c.security.audit_append_only ? 'Append-only (enforced)' : 'Not enforced',
              },
              {
                label: 'Refused admin access',
                ok: c.security.denied === 0,
                value: `${nf(c.security.denied)} attempts in period`,
              },
              {
                label: 'Live signing',
                ok: true,
                value: c.security.production_signing ? 'On' : 'Off until legal review and pen test',
              },
            ].map((r) => (
              <li key={r.label} className="flex items-start gap-2">
                {r.ok ? (
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-burgundy" aria-hidden />
                )}
                <span>
                  <span className="font-semibold text-heading">{r.label}</span>
                  <span className="block text-xs">{r.value}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="System Health"
          action={
            access.permissions.includes('system.view') ? (
              <Link
                href="/admin/operations"
                className="text-xs font-semibold text-primary hover:underline"
              >
                View status
              </Link>
            ) : null
          }
        >
          <div className="flex items-center gap-2 rounded-xl bg-cream px-3 py-2 text-sm">
            <CircleDashed className="size-4 text-heading" aria-hidden />
            Uptime and response time: monitoring not configured
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {[
              ['Finishing failures open', nf(h.finalization_failed)],
              [
                'Webhook success',
                h.webhooks_total ? pct(rate(h.webhooks_ok, h.webhooks_total)) : 'No deliveries',
              ],
              [
                'Email delivered',
                h.emails_total ? pct(rate(h.emails_ok, h.emails_total)) : 'No emails',
              ],
              ['Email bounces', nf(h.emails_bounced)],
              ['Stripe events waiting', nf(h.stripe_unprocessed)],
              ['Integration sync failures', nf(h.sync_failed)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-border px-2 py-1.5">
                <dt className="text-xs">{l}</dt>
                <dd className="font-semibold text-heading">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
