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
import { getPerfEngagement, getPerfMeasurement, minutesPerDay, pctChange, rate } from '@st/core';
import { db } from '@/lib/db';
import { Kpi } from '@/components/admin/kpi';
import { ColumnChart, Panel, ProgressBars, SERIES } from '@/components/admin/charts';
import { DataTable } from '@/components/admin/data-table';
import { Stat, Toggle, TrackedSince, bucketLabel, fmtTime, nf, pct, typeLabel } from '../sections';
import type { TabProps } from './page';

const ACTIVE =
  'Active = signed in, took a recorded action in a workspace, or created a Signature Studio design. An idle open tab is not activity.';

export async function EngagementTab({ p, userId, params, cmp }: TabProps) {
  const [e, m] = await Promise.all([
    getPerfEngagement(db(), { userId }, p),
    getPerfMeasurement(db(), { userId }, p),
  ]);
  const t = m.time;
  const perDay = t.suppressed ? null : minutesPerDay(t.seconds, t.user_days);
  const perDayCmp = t.suppressed ? null : minutesPerDay(t.seconds_cmp, t.user_days_cmp);
  const perDayChange = perDay != null ? pctChange(perDay, perDayCmp) : null;
  const mins = (sec: number | null) =>
    sec == null ? '—' : sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`;
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
          info="Sign-ins in the period ÷ active people. For time spent in the app, see Time in the App below."
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
        <Panel
          title="Time in the App"
          info="Active time counts only while a signed-in tab is visible and focused and the person has clicked, typed or scrolled in the last minute, so an idle or background tab adds nothing. Stored as a daily total per person (no page-by-page history), not counted when the browser sends Global Privacy Control or Do Not Track, and deleted after 13 months. Withheld when fewer than 5 people were tracked."
        >
          <TrackedSince since={t.since} what="Active time" />
          {t.suppressed ? (
            <p className="rounded-lg bg-ivory px-3 py-8 text-center text-sm">
              Fewer than 5 people have tracked time in this period, so it&apos;s withheld to protect
              their privacy.
            </p>
          ) : (
            <>
              <dl className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Stat
                  label="Active time per active day"
                  value={perDay != null ? `${perDay} min` : '—'}
                  note={
                    perDayChange != null && cmp
                      ? `${perDayChange > 0 ? '+' : ''}${perDayChange.toFixed(1)}% vs. ${cmp.toLowerCase()}`
                      : 'Average for a person on a day they used the app'
                  }
                />
                <Stat
                  label="Median per person"
                  value={mins(t.median_seconds)}
                  note="Total over the period"
                />
                <Stat label="People tracked" value={nf(t.users)} note="With any active time" />
              </dl>
              <ProgressBars
                rows={(
                  [
                    ['Under 5 minutes', t.bands.under_5m],
                    ['5 to 30 minutes', t.bands.m5_30],
                    ['30 minutes to 2 hours', t.bands.m30_2h],
                    ['Over 2 hours', t.bands.over_2h],
                  ] as const
                ).map(([l, v]) => ({
                  label: l,
                  value: rate(v, t.users) ?? 0,
                  detail: `${nf(v)} of ${nf(t.users)} people (total in the period)`,
                }))}
              />
            </>
          )}
        </Panel>
        <Panel
          title="Active Time Over Time"
          info="Average active minutes per person on the days they used the app, per interval. Intervals with fewer than 5 tracked people are left blank."
        >
          {t.suppressed ? (
            <p className="rounded-lg bg-ivory px-3 py-8 text-center text-sm">
              Not enough tracked people in this period to chart.
            </p>
          ) : (
            <ColumnChart
              caption="Average active minutes per active day, per interval"
              labels={t.series.map((s) => bucketLabel(s.start, p.bucket))}
              series={[
                {
                  name: 'Minutes per active day',
                  color: SERIES.gold,
                  values: t.series.map((s) => minutesPerDay(s.seconds, s.user_days) ?? 0),
                },
              ]}
              precise
              format={(n) => `${n.toFixed(1)} min`}
              empty="No active time was recorded for the selected period."
            />
          )}
        </Panel>
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
