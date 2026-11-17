import {
  Users,
  UserPlus,
  Building2,
  Building,
  TrendingUp,
  Activity,
  CreditCard,
} from 'lucide-react';
import {
  PAGE_LABEL,
  SOURCE_LABEL,
  getPerfGrowth,
  getPerfMeasurement,
  pctChange,
  ppChange,
  rate,
} from '@st/core';
import { db } from '@/lib/db';
import { Kpi } from '@/components/admin/kpi';
import { ColumnChart, Legend, Panel, ProgressBars, SERIES } from '@/components/admin/charts';
import { DataTable } from '@/components/admin/data-table';
import { Stat, Toggle, TrackedSince, bucketLabel, fmtTime, nf, pct, typeLabel } from '../sections';
import type { TabProps } from './page';

const PLAN_COLORS = [SERIES.navy, SERIES.gold, SERIES.blue, SERIES.burgundy, SERIES.gray];
const planLabel = (p: string) => (p === 'payg' ? 'Pay as you go' : typeLabel(p));

export async function GrowthTab({ p, sp, userId, params, cmp }: TabProps) {
  const [g, m] = await Promise.all([
    getPerfGrowth(db(), { userId }, p),
    getPerfMeasurement(db(), { userId }, p),
  ]);
  const acq = sp.acq === 'visits' || sp.acq === 'pages' ? sp.acq : 'signups';
  const visitChange = pctChange(m.visits.total, m.visits.total_cmp);
  const k = g.kpi;
  const labels = g.series.map((s) => bucketLabel(s.start, p.bucket));
  const userRate = rate(k.users_new, k.users_start);
  const userRateCmp =
    k.users_start_cmp != null ? rate(k.users_new_cmp ?? 0, k.users_start_cmp) : null;
  const orgRate = rate(k.orgs_new, k.orgs_start);
  const orgRateCmp = k.orgs_start_cmp != null ? rate(k.orgs_new_cmp ?? 0, k.orgs_start_cmp) : null;
  const paidConv = rate(k.orgs_paid, k.orgs_total);
  const paidConvCmp =
    k.orgs_total_cmp != null ? rate(k.orgs_paid_cmp ?? 0, k.orgs_total_cmp) : null;
  const cum = sp.cum === 'orgs' ? 'orgs' : 'users';
  const plans = g.by_plan.plans.sort((a, b) =>
    a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b),
  );

  return (
    <>
      <p className="-mt-3 text-xs text-slate-text">
        Live from the database at {fmtTime(g.generated_at)} UTC. Growth rate = new in the period ÷
        total at the start of the period.
      </p>
      <section
        aria-label="Growth numbers"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Kpi
          label="Total Registered Users"
          value={nf(k.users_total)}
          icon={<Users className="size-5" />}
          change={null}
          compareLabel={null}
          sub="At the end of the period (lifetime)"
          info="Every account created up to the end of the period."
        />
        <Kpi
          label="New Users"
          value={nf(k.users_new)}
          icon={<UserPlus className="size-5" />}
          change={pctChange(k.users_new, k.users_new_cmp)}
          compareLabel={cmp}
          info="Accounts created in the period."
        />
        <Kpi
          label="Total Organizations"
          value={nf(k.orgs_total)}
          icon={<Building2 className="size-5" />}
          change={null}
          compareLabel={null}
          sub="At the end of the period (lifetime)"
          info="Every workspace created up to the end of the period."
        />
        <Kpi
          label="New Organizations"
          value={nf(k.orgs_new)}
          icon={<Building className="size-5" />}
          change={pctChange(k.orgs_new, k.orgs_new_cmp)}
          compareLabel={cmp}
          info="Workspaces created in the period."
        />
        <Kpi
          label="User Growth Rate"
          value={k.users_start ? pct(userRate) : 'No base yet'}
          icon={<TrendingUp className="size-5" />}
          change={ppChange(userRate, userRateCmp)}
          unit="pp"
          compareLabel={k.users_start ? cmp : null}
          info="New users in the period ÷ registered users at the start of the period. Shown only when there were users at the start."
        />
        <Kpi
          label="Organization Growth Rate"
          value={k.orgs_start ? pct(orgRate) : 'No base yet'}
          icon={<TrendingUp className="size-5" />}
          change={ppChange(orgRate, orgRateCmp)}
          unit="pp"
          compareLabel={k.orgs_start ? cmp : null}
          info="New organizations in the period ÷ organizations at the start of the period."
        />
        <Kpi
          label="Active Organizations"
          value={nf(k.orgs_active)}
          icon={<Activity className="size-5" />}
          change={pctChange(k.orgs_active, k.orgs_active_cmp)}
          compareLabel={cmp}
          info="Workspaces that sent at least one live signing request in the period."
        />
        <Kpi
          label="Paid Organization Conversion"
          value={pct(paidConv)}
          icon={<CreditCard className="size-5" />}
          change={ppChange(paidConv, paidConvCmp)}
          unit="pp"
          compareLabel={cmp}
          sub={`${nf(k.orgs_paid)} of ${nf(k.orgs_total)} have paid`}
          info="Organizations that have made at least one successful payment ÷ all organizations, both at the end of the period."
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="User Acquisition" info="Accounts created in each interval.">
          <ColumnChart
            caption="New users per interval"
            labels={labels}
            series={[
              { name: 'New users', color: SERIES.navy, values: g.series.map((s) => s.users_new) },
            ]}
          />
        </Panel>
        <Panel title="Organization Acquisition" info="Workspaces created in each interval.">
          <ColumnChart
            caption="New organizations per interval"
            labels={labels}
            series={[
              {
                name: 'New organizations',
                color: SERIES.gold,
                values: g.series.map((s) => s.orgs_new),
              },
            ]}
          />
        </Panel>
        <Panel
          title="Cumulative Growth"
          info="The total at the end of each interval."
          action={
            <Toggle
              label="Cumulative measure"
              base="/admin/performance"
              params={params}
              name="cum"
              value={cum}
              options={[
                ['users', 'Users'],
                ['orgs', 'Organizations'],
              ]}
            />
          }
        >
          <ColumnChart
            caption={`Total ${cum === 'orgs' ? 'organizations' : 'users'} at the end of each interval`}
            labels={labels}
            series={[
              cum === 'orgs'
                ? {
                    name: 'Organizations (total)',
                    color: SERIES.gold,
                    values: g.series.map((s) => s.orgs_total),
                  }
                : {
                    name: 'Users (total)',
                    color: SERIES.navy,
                    values: g.series.map((s) => s.users_total),
                  },
            ]}
          />
        </Panel>
        <Panel
          title="Growth by Plan"
          info="New organizations in each interval, by the plan they are on now. Plans with fewer than 5 new organizations in the period are merged into Other so no customer stands out."
        >
          <Legend
            items={plans.map((pl, i) => ({
              label: planLabel(pl),
              color: PLAN_COLORS[i % PLAN_COLORS.length]!,
            }))}
          />
          <ColumnChart
            stacked
            caption="New organizations per interval by current plan"
            labels={labels}
            series={plans.map((pl, i) => ({
              name: planLabel(pl),
              color: PLAN_COLORS[i % PLAN_COLORS.length]!,
              values: g.series.map(
                (s) => g.by_plan.rows.find((r) => r.start === s.start && r.plan === pl)?.orgs ?? 0,
              ),
            }))}
          />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="Website Visits"
          info="A visit is a page load on the public website that arrives from outside the site (a link, a search, a typed address). Reloads and moves between pages don't add visits. Counted without cookies or identifiers, and not counted when the browser sends Global Privacy Control or Do Not Track, so this is a floor rather than an exact total."
        >
          <TrackedSince since={m.visits.since} what="Visits" />
          <dl className="mb-4 grid grid-cols-2 gap-2">
            <Stat
              label="Visits in the period"
              value={nf(m.visits.total)}
              note={
                visitChange != null && cmp
                  ? `${visitChange > 0 ? '+' : ''}${visitChange.toFixed(1)}% vs. ${cmp.toLowerCase()}`
                  : 'No earlier data to compare'
              }
            />
            <Stat
              label="Visits per new user"
              value={
                m.visits.conv_users ? (m.visits.conv_visits / m.visits.conv_users).toFixed(1) : '—'
              }
              note="Since counting began"
            />
          </dl>
          <ColumnChart
            caption="Website visits per interval"
            labels={m.visits.series.map((s) => bucketLabel(s.start, p.bucket))}
            series={[
              { name: 'Visits', color: SERIES.blue, values: m.visits.series.map((s) => s.visits) },
            ]}
            empty="No visits were counted in the selected period."
          />
        </Panel>
        <Panel
          title="Acquisition Sources"
          info="Sources are coarse categories worked out in the visitor's browser from the referring site and campaign tags; the referrer address, campaign names and search terms are discarded. A new account's source is the visit it signed up in. Not recorded = signed up before counting began, with tracking turned off, or on another visit. Sources with fewer than 5 new users are merged into Other."
          action={
            <Toggle
              label="Acquisition measure"
              base="/admin/performance"
              params={params}
              name="acq"
              value={acq}
              options={[
                ['signups', 'New users'],
                ['visits', 'Visits'],
                ['pages', 'Landing pages'],
              ]}
            />
          }
        >
          <TrackedSince
            since={acq === 'signups' ? m.signups.since : m.visits.since}
            what={acq === 'signups' ? 'Sign-up sources' : 'Visits'}
          />
          {acq === 'signups' ? (
            <ProgressBars
              rows={m.signups.by_source.map((r) => ({
                label: SOURCE_LABEL[r.source] ?? r.source,
                value: rate(r.users, m.signups.users_new) ?? 0,
                detail: `${nf(r.users)} of ${nf(m.signups.users_new)} new users`,
              }))}
              empty="No new users in the selected period."
            />
          ) : acq === 'visits' ? (
            <ProgressBars
              rows={m.visits.by_source.map((r) => ({
                label: SOURCE_LABEL[r.source] ?? r.source,
                value: rate(r.visits, m.visits.total) ?? 0,
                detail: `${nf(r.visits)} of ${nf(m.visits.total)} visits`,
              }))}
              empty="No visits were counted in the selected period."
            />
          ) : (
            <ProgressBars
              rows={m.visits.by_page.map((r) => ({
                label: PAGE_LABEL[r.page] ?? r.page,
                value: rate(r.visits, m.visits.total) ?? 0,
                detail: `${nf(r.visits)} visits started here`,
              }))}
              empty="No visits were counted in the selected period."
            />
          )}
        </Panel>
      </div>

      <Panel
        title="Growth by Period"
        info="Activated = people who sent their first live signing request in the interval. Paying = organizations whose first successful payment was in the interval. Growth rate = new users ÷ users at the start of the interval. Activation = activated ÷ new users."
      >
        <DataTable
          caption="Growth by period"
          columns={[
            { key: 'period', label: 'Period' },
            { key: 'users_new', label: 'New Users', numeric: true },
            { key: 'orgs_new', label: 'New Organizations', numeric: true },
            { key: 'activated', label: 'Activated Users', numeric: true },
            { key: 'paying', label: 'Paying Accounts', numeric: true },
            { key: 'growth', label: 'Growth Rate', numeric: true, format: 'percent' },
            { key: 'activation', label: 'Activation', numeric: true, format: 'percent' },
          ]}
          rows={g.series.map((s, i) => ({
            period: labels[i]!,
            users_new: s.users_new,
            orgs_new: s.orgs_new,
            activated: s.activated,
            paying: s.paying,
            growth: rate(s.users_new, s.users_start),
            activation: rate(s.activated, s.users_new),
          }))}
        />
      </Panel>
    </>
  );
}
