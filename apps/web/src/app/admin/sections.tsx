import Link from 'next/link';
import { Users, Building2, FileText, CircleCheck, PenLine, Coins } from 'lucide-react';
import {
  FEATURE_LABEL,
  formatMoney,
  pctChange,
  rate,
  type CommandCenter,
  type Period,
} from '@st/core';
import { stripeLiveMode } from '@/lib/stripe';
import { Kpi } from '@/components/admin/kpi';
import { ColumnChart, Donut, Legend, Panel, ProgressBars, SERIES } from '@/components/admin/charts';

/** Panels shared by the Command Center and the Platform Performance Overview tab. */

export const nf = (n: number) => n.toLocaleString('en-US');
export const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);

export function bucketLabel(iso: string, bucket: Period['bucket']) {
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...o, timeZone: 'UTC' }).format(d);
  if (bucket === 'month') return f({ month: 'short', year: '2-digit' });
  return bucket === 'week'
    ? `Wk ${f({ month: 'short', day: 'numeric' })}`
    : f({ month: 'short', day: 'numeric' });
}

export const typeLabel = (t: string) =>
  t === 'small_groups' || t === 'other'
    ? 'Other (small groups)'
    : t === 'uncategorized'
      ? 'Uncategorized'
      : t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeStyle: 'short',
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(iso));

/** The filter part of the URL (range, comparison, custom dates), for links that keep it. */
export function filterParams(p: Period, sp: { from?: string; to?: string }) {
  return new URLSearchParams(
    Object.entries({
      range: p.range,
      compare: p.compare,
      from: p.range === 'custom' ? (sp.from ?? '') : '',
      to: p.range === 'custom' ? (sp.to ?? '') : '',
    }).filter(([, v]) => v),
  );
}

/** A segmented control made of links: each option is a URL with one parameter changed. */
export function Toggle({
  label,
  base,
  params,
  name,
  value,
  options,
}: {
  label: string;
  base: string;
  params: URLSearchParams;
  name: string;
  value: string;
  /** The first option is the default and is left out of the URL. */
  options: readonly (readonly [string, string])[];
}) {
  return (
    <div
      className="flex flex-wrap rounded-lg border border-border p-0.5 text-xs"
      role="group"
      aria-label={label}
    >
      {options.map(([v, l], i) => {
        const q = new URLSearchParams(params);
        if (i === 0) q.delete(name);
        else q.set(name, v);
        const active = v === value;
        return (
          <Link
            key={v}
            href={`${base}?${q}`}
            scroll={false}
            aria-current={active ? 'true' : undefined}
            className={`rounded-md px-2 py-1 ${active ? 'bg-primary text-white' : 'text-heading hover:bg-cream'}`}
          >
            {l}
          </Link>
        );
      })}
    </div>
  );
}

export function KpiRow({
  c,
  cmp,
  links = {},
}: {
  c: CommandCenter;
  cmp: string | null;
  links?: Partial<Record<'users' | 'orgs' | 'docs' | 'done' | 'studio' | 'revenue', string>>;
}) {
  const k = c.kpi;
  const cohortRate = rate(k.cohort_completed, k.docs_sent);
  const cohortRateCmp = rate(k.cohort_completed_cmp ?? 0, k.docs_sent_cmp ?? 0);
  const money = c.revenue?.totals[0];
  return (
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
        href={links.users}
      />
      <Kpi
        label="Organizations"
        value={nf(k.orgs_total)}
        icon={<Building2 className="size-5" />}
        change={pctChange(k.orgs_new, k.orgs_new_cmp)}
        compareLabel={cmp}
        sub={`${nf(k.orgs_new)} new · ${nf(k.orgs_active)} sent a live request`}
        info="Workspaces at the end of the period (lifetime total). The change compares new workspaces. Active means the workspace sent at least one live request in the period."
        href={links.orgs ?? '/admin/workspaces'}
      />
      <Kpi
        label="Documents Processed"
        value={nf(k.docs_sent)}
        icon={<FileText className="size-5" />}
        change={pctChange(k.docs_sent, k.docs_sent_cmp)}
        compareLabel={cmp}
        sub={`${nf(k.docs_sent_total)} all time`}
        info="Live signing requests sent in the period, one per request. Test requests and unsent drafts are not counted."
        href={links.docs}
      />
      <Kpi
        label="Documents Completed"
        value={nf(k.docs_completed)}
        icon={<CircleCheck className="size-5" />}
        change={pctChange(k.docs_completed, k.docs_completed_cmp)}
        compareLabel={cmp}
        sub={`Completion rate ${pct(cohortRate)}${cohortRateCmp != null && cmp ? ` (was ${pct(cohortRateCmp)})` : ''}`}
        info="Live requests that finished in the period. Completion rate: of the requests sent in the period, the share that are now completed."
        href={links.done}
      />
      <Kpi
        label="Signatures Created"
        value={nf(k.designs_new)}
        icon={<PenLine className="size-5" />}
        change={pctChange(k.designs_new, k.designs_new_cmp)}
        compareLabel={cmp}
        sub={`${nf(k.studio_purchases)} Signature Studio purchases`}
        info="Signature Studio designs created in the period (drafts included). No artwork is shown or read here."
        href={links.studio}
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
          href={links.revenue}
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
  );
}

export function GrowthPanel({
  c,
  p,
  cumulative,
  toggle,
  title = 'Platform Growth',
}: {
  c: CommandCenter;
  p: Period;
  cumulative: boolean;
  toggle: React.ReactNode;
  title?: string;
}) {
  return (
    <Panel
      title={title}
      info="New registrations counts accounts and workspaces created in each interval. Cumulative shows the total at the end of each interval."
      action={toggle}
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
        labels={c.growth.map((g) => bucketLabel(g.start, p.bucket))}
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
  );
}

export function statusSegments(s: CommandCenter['doc_status']) {
  return [
    { label: 'Completed', value: s.completed, color: SERIES.navy },
    { label: 'Pending', value: s.pending, color: SERIES.gold },
    { label: 'Declined', value: s.declined, color: SERIES.burgundy },
    { label: 'Expired', value: s.expired, color: SERIES.gray },
    { label: 'Cancelled', value: s.cancelled, color: SERIES.blue },
    ...(s.failed ? [{ label: 'Finishing failed', value: s.failed, color: '#5C1222' }] : []),
  ];
}

export function StatusPanel({
  status,
  action,
}: {
  status: CommandCenter['doc_status'];
  action?: React.ReactNode;
}) {
  return (
    <Panel
      title="Document Status (All Organizations)"
      info="Cohort: live requests sent in the period, by their status now. Every request is in exactly one group, so the groups add up to the total."
      action={action}
    >
      <Donut
        caption="Status of live requests sent in the period"
        centerLabel="Documents"
        segments={statusSegments(status)}
      />
    </Panel>
  );
}

const KIND_LABEL: Record<string, string> = {
  request: 'Document Signing',
  credits: 'Document Credit Purchases',
  subscription: 'Subscriptions',
  studio: 'Signature Studio Purchases',
};

export function RevenuePanel({
  c,
  p,
  view = 'net',
  toggle,
}: {
  c: CommandCenter;
  p: Period;
  view?: 'net' | 'gross' | 'service';
  toggle?: React.ReactNode;
}) {
  if (!c.revenue)
    return (
      <Panel title="Revenue Trend">
        <p className="text-sm">Revenue is visible to founder and finance roles.</p>
      </Panel>
    );
  const main = c.revenue.totals[0];
  const cur = main?.currency ?? 'USD';
  const series = c.revenue.series.filter((s) => s.currency === cur);
  const money = (n: number) => formatMoney(n, cur).replace(/\.00$/, '');
  const kinds = c.revenue.by_kind.filter((k) => k.currency === cur);
  return (
    <Panel
      title="Revenue Trend"
      info="Net collected = successful payments minus refunds and disputed amounts, by the date paid. Gross collected is before refunds. Includes single requests, credit packs, subscriptions and Signature Studio. Spending credits is not counted again. API usage and add-ons are not sold yet, so they have no category."
      action={
        main ? (
          <span className="font-display text-xl text-heading">
            {formatMoney(view === 'gross' ? (main.gross ?? 0) : (main.net ?? 0), cur)}
          </span>
        ) : null
      }
    >
      {toggle}
      {view === 'service' ? (
        <ColumnChart
          caption={`Net collected revenue by service in the period, ${cur}`}
          labels={kinds.map((k) => KIND_LABEL[k.kind] ?? k.kind)}
          series={[
            { name: `Net collected (${cur})`, color: SERIES.gold, values: kinds.map((k) => k.net) },
          ]}
          format={money}
          empty="No payments were collected in this period."
        />
      ) : (
        <ColumnChart
          caption={`${view === 'gross' ? 'Gross' : 'Net'} collected revenue per interval, ${cur}`}
          labels={c.growth.map((g) => bucketLabel(g.start, p.bucket))}
          series={[
            {
              name: `${view === 'gross' ? 'Gross' : 'Net'} collected (${cur})`,
              color: SERIES.gold,
              values: c.growth.map((g) => {
                const s = series.find((x) => x.start === g.start);
                return (view === 'gross' ? s?.gross : s?.net) ?? 0;
              }),
            },
          ]}
          format={money}
          empty="No payments were collected in this period."
        />
      )}
      {c.revenue.totals.length > 1 ? (
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

export function FeaturesPanel({
  c,
  measure = 'adoption',
  toggle,
  rowHref,
}: {
  c: CommandCenter;
  measure?: 'adoption' | 'users';
  toggle?: React.ReactNode;
  rowHref?: string;
}) {
  const active = c.features.active_users;
  const max = Math.max(1, ...c.features.rows.map((f) => f.users));
  return (
    <Panel
      title="Top Features by Usage"
      info={`Adoption = people who used the feature in the period ÷ active people (${nf(active)}). Active means they took a recorded action in a workspace or created a Signature Studio design. Opening a page does not count.`}
    >
      {toggle}
      <ProgressBars
        unit={measure === 'users' ? 'count' : 'percent'}
        rows={c.features.rows.map((f) => ({
          label: FEATURE_LABEL[f.feature] ?? f.feature,
          value: measure === 'users' ? f.users : (rate(f.users, active) ?? 0),
          max: measure === 'users' ? max : 100,
          detail: `${nf(f.users)} of ${nf(active)} active people`,
          href: rowHref,
        }))}
      />
    </Panel>
  );
}

export function StudioPanel({
  c,
  cmp,
  href,
}: {
  c: CommandCenter;
  cmp: string | null;
  href?: string;
}) {
  const st = c.studio;
  const k = c.kpi;
  const conversion = rate(st.designs_purchased, st.designs);
  const cards: [string, string, number | null][] = [
    ['Designer Sessions', nf(st.sessions), pctChange(st.sessions, st.sessions_cmp)],
    ['Signatures Created', nf(st.designs), pctChange(k.designs_new, k.designs_new_cmp)],
    ['Purchases', nf(k.studio_purchases), pctChange(k.studio_purchases, k.studio_purchases_cmp)],
    ['Conversion Rate', pct(conversion), null],
  ];
  return (
    <Panel
      title="Signature Studio Performance"
      info="Sessions: distinct designer sessions that started a design. Conversion: designs created in the period that were later bought ÷ designs created in the period. No signature artwork is read."
      action={
        href ? (
          <Link href={href} className="text-xs font-semibold text-primary hover:underline">
            Studio funnel
          </Link>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {cards.map(([l, v, ch]) => (
          <div key={l} className="rounded-xl border border-border bg-ivory p-3">
            <p className="text-xs font-semibold text-heading">{l}</p>
            <p className="font-display text-2xl text-heading">{v}</p>
            {ch != null && cmp ? (
              <p className="text-xs">
                {ch > 0 ? '+' : ''}
                {ch.toFixed(1)}% vs. {cmp.toLowerCase()}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-text">
        {nf(st.downloads)} successful downloads in the period.
      </p>
    </Panel>
  );
}

export function DocTypesPanel({ c }: { c: CommandCenter }) {
  const total = c.doc_types.reduce((n, t) => n + t.count, 0);
  return (
    <Panel
      title="Documents by Type (Platform-wide)"
      info="The document type each customer chose when uploading, for live requests sent in the period. Types with fewer than 5 documents are merged into Other so no single customer stands out. Document text is never read."
    >
      <ProgressBars
        rows={c.doc_types.map((t) => ({
          label: typeLabel(t.type),
          value: rate(t.count, total) ?? 0,
          detail: `${nf(t.count)} documents`,
        }))}
      />
    </Panel>
  );
}
