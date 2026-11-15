import {
  Sun,
  CalendarDays,
  CalendarRange,
  LogIn,
  Building2,
  CalendarCheck,
  Repeat,
  Sparkles,
} from 'lucide-react';
import { getPerfEngagement, pctChange, rate } from '@st/core';
import { db } from '@/lib/db';
import { Kpi } from '@/components/admin/kpi';
import { ColumnChart, NotTracked, Panel, ProgressBars, SERIES } from '@/components/admin/charts';
import { DataTable } from '@/components/admin/data-table';
import { Toggle, bucketLabel, fmtTime, nf, pct, typeLabel } from '../sections';
import type { TabProps } from './page';

const ACTIVE =
  'Active = signed in, took a recorded action in a workspace, or created a Signature Studio design. An idle open tab is not activity.';

export async function EngagementTab({ p, userId, params, cmp }: TabProps) {
  const e = await getPerfEngagement(db(), { userId }, p);
  const k = e.kpi;
  const labels = e.series.map((s) => bucketLabel(s.start, p.bucket));
  const short = p.to.getTime() - p.from.getTime() <= 92 * 86_400_000;
  const f = e.frequency;
  const segTotal = f.daily + f.several_weekly + f.weekly + f.occasional + f.inactive;
  const planMax = Math.max(1, ...e.by_plan.map((r) => r.orgs));

  return (
    <>
      <p className="-mt-3 text-xs text-slate-text">
        Live from the database at {fmtTime(e.generated_at)} UTC. {ACTIVE}
      </p>
      <section
        aria-label="Engagement numbers"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Kpi
          label="Daily Active Users"
          value={nf(k.dau_avg)}
          icon={<Sun className="size-5" />}
          change={null}
          compareLabel={null}
          sub="Average per day in the period"
          info={`Average number of distinct active people per day across the period. ${ACTIVE}`}
        />
        <Kpi
          label="Weekly Active Users"
          value={nf(k.wau)}
          icon={<CalendarDays className="size-5" />}
          change={null}
          compareLabel={null}
          sub="Last 7 days of the period"
          info={`Distinct active people in the 7 days ending at the end of the period. ${ACTIVE}`}
        />
        <Kpi
          label="Monthly Active Users"
          value={nf(k.mau)}
          icon={<CalendarRange className="size-5" />}
          change={null}
          compareLabel={null}
          sub="Last 30 days of the period"
          info={`Distinct active people in the 30 days ending at the end of the period. ${ACTIVE}`}
        />
        <Kpi
          label="Sign-ins per Active User"
          value={k.active_users ? (k.signins / k.active_users).toFixed(1) : '—'}
          icon={<LogIn className="size-5" />}
          change={null}
          compareLabel={null}
          sub={`${nf(k.signins)} sign-ins`}
          info="Sign-ins in the period ÷ active people. Usage sessions (time in the app) are not measured, so sign-ins stand in for sessions."
        />
        <Kpi
          label="Active Organizations"
          value={nf(k.orgs_active)}
          icon={<Building2 className="size-5" />}
          change={pctChange(k.orgs_active, k.orgs_active_cmp)}
          compareLabel={cmp}
          info="Workspaces where someone took a recorded action in the period."
        />
        <Kpi
          label="Active Days per User"
          value={k.active_users ? (k.active_days / k.active_users).toFixed(1) : '—'}
          icon={<CalendarCheck className="size-5" />}
          change={null}
          compareLabel={null}
          sub={`Out of ${Math.round(k.period_days)} days`}
          info="Average number of distinct days each active person was active in the period."
        />
        <Kpi
          label="Returning User Rate"
          value={
            k.returning != null ? pct(rate(k.returning, k.active_users)) : 'Needs a comparison'
          }
          icon={<Repeat className="size-5" />}
          change={null}
          compareLabel={null}
          sub={
            k.returning != null
              ? `${nf(k.returning)} were also active in the comparison period`
              : undefined
          }
          info="Active people in the period who were also active in the comparison period ÷ active people in the period."
        />
        <Kpi
          label="Feature Engagement Rate"
          value={pct(rate(k.feature_users, k.active_users))}
          icon={<Sparkles className="size-5" />}
          change={null}
          compareLabel={null}
          sub={`${nf(k.feature_users)} used a feature`}
          info="Active people who used at least one product feature (see Feature Usage) ÷ active people. Signing in alone does not count."
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="Active Users Over Time"
          info={`Distinct active people in each interval. ${ACTIVE}`}
          action={
            <Toggle
              label="Interval"
              base="/admin/performance"
              params={params}
              name="bucket"
              value={p.bucket}
              options={
                (short ? [['day', 'Daily']] : []).concat([
                  ['week', 'Weekly'],
                  ['month', 'Monthly'],
                ]) as [string, string][]
              }
            />
          }
        >
          <ColumnChart
            caption="Active people per interval"
            labels={labels}
            series={[
              {
                name: 'Active people',
                color: SERIES.navy,
                values: e.series.map((s) => s.active_users),
              },
            ]}
          />
        </Panel>
        <Panel
          title="User Activity Frequency"
          info="Each registered person is in exactly one group, from the share of the period's days they were active: daily = 5+ days a week on average, several times a week = 2–5, weekly = 1–2, occasional = less than weekly, inactive = not active in the period."
        >
          <ProgressBars
            rows={[
              ['Daily', f.daily],
              ['Several times a week', f.several_weekly],
              ['Weekly', f.weekly],
              ['Occasional', f.occasional],
              ['Inactive', f.inactive],
            ].map(([l, v]) => ({
              label: l as string,
              value: rate(v as number, segTotal) ?? 0,
              detail: `${nf(v as number)} of ${nf(segTotal)} registered people`,
            }))}
          />
        </Panel>
        <Panel
          title="Engagement by Plan"
          info="Active organizations in the period, by the plan they are on now. Plans with fewer than 5 active organizations are merged into Other."
        >
          <ProgressBars
            unit="count"
            rows={e.by_plan.map((r) => ({
              label: r.plan === 'payg' ? 'Pay as you go' : typeLabel(r.plan),
              value: r.orgs,
              max: planMax,
              detail: `${nf(r.orgs)} active organizations`,
            }))}
          />
        </Panel>
        <NotTracked
          label="Session Duration"
          reason="Time spent in the app isn't measured, and an idle open tab shouldn't count as engagement. This needs a privacy-reviewed activity heartbeat before it can be reported."
        />
      </div>

      <Panel
        title="Engagement by Period"
        info="Per interval: distinct active people, sign-ins and organizations with a recorded action. Engagement rate = active people ÷ registered people at the end of the period."
      >
        <DataTable
          caption="Engagement by period"
          columns={[
            { key: 'period', label: 'Period' },
            { key: 'active', label: 'Active People', numeric: true },
            { key: 'orgs', label: 'Active Organizations', numeric: true },
            { key: 'signins', label: 'Sign-ins', numeric: true },
            { key: 'rate', label: 'Engagement Rate', numeric: true, format: 'percent' },
          ]}
          rows={e.series.map((s, i) => ({
            period: labels[i]!,
            active: s.active_users,
            orgs: s.orgs_active,
            signins: s.signins,
            rate: rate(s.active_users, k.registered),
          }))}
        />
      </Panel>
    </>
  );
}
