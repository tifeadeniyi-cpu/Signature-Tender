import {
  Trophy,
  ArrowDownWideNarrow,
  MousePointerClick,
  Users,
  Layers,
  TrendingUp,
} from 'lucide-react';
import { FEATURES, FEATURE_LABEL, getPerfFeatures, pctChange, ppChange, rate } from '@st/core';
import { db } from '@/lib/db';
import { Kpi } from '@/components/admin/kpi';
import {
  ColumnChart,
  Legend,
  NotTracked,
  Panel,
  ProgressBars,
  SERIES,
} from '@/components/admin/charts';
import { DataTable } from '@/components/admin/data-table';
import { bucketLabel, fmtTime, nf, pct } from '../sections';
import type { TabProps } from './page';

const COLORS = [SERIES.navy, SERIES.gold, SERIES.blue, SERIES.burgundy];

export async function FeaturesTab({ p, userId, cmp }: TabProps) {
  const f = await getPerfFeatures(db(), { userId }, p);
  const rows = FEATURES.map((key) => f.rows.find((r) => r.feature === key)).filter(
    (r) => r != null,
  );
  const ranked = [...rows].sort((a, b) => b.users - a.users);
  const most = ranked[0]?.users ? ranked[0] : null;
  const least = [...rows].reverse().sort((a, b) => a.users - b.users)[0];
  const adoption = rate(f.feature_users, f.eligible);
  const adoptionCmp =
    f.eligible_cmp != null ? rate(f.feature_users_cmp ?? 0, f.eligible_cmp) : null;
  const top = ranked.filter((r) => r.users > 0).slice(0, 4);
  const allStarts = [...new Set(f.series.map((s) => s.start))];
  const labels = allStarts.map((s) => bucketLabel(s, p.bucket));

  return (
    <>
      <p className="-mt-3 text-xs text-slate-text">
        Live from the database at {fmtTime(f.generated_at)} UTC. A feature counts as used when
        someone takes an action with it (sending, saving a template, inviting a teammate...).
        Opening a page or a sidebar link does not count.
      </p>
      <section
        aria-label="Feature numbers"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        <Kpi
          label="Most Used Feature"
          value={most ? (FEATURE_LABEL[most.feature] ?? most.feature) : '—'}
          icon={<Trophy className="size-5" />}
          change={null}
          compareLabel={null}
          sub={most ? `${nf(most.users)} people` : 'No feature use in the period'}
          info="The feature used by the most distinct people in the period."
        />
        <Kpi
          label="Least Used Feature"
          value={least && most ? (FEATURE_LABEL[least.feature] ?? least.feature) : '—'}
          icon={<ArrowDownWideNarrow className="size-5" />}
          change={null}
          compareLabel={null}
          sub={least && most ? `${nf(least.users)} people` : undefined}
          info="The available feature used by the fewest distinct people in the period."
        />
        <Kpi
          label="Total Feature Events"
          value={nf(f.events)}
          icon={<MousePointerClick className="size-5" />}
          change={pctChange(f.events, f.events_cmp)}
          compareLabel={cmp}
          info="Every recorded feature action in the period. One person can make many."
        />
        <Kpi
          label="Active Feature Users"
          value={nf(f.feature_users)}
          icon={<Users className="size-5" />}
          change={pctChange(f.feature_users, f.feature_users_cmp)}
          compareLabel={cmp}
          info="Distinct people who used at least one feature in the period."
        />
        <Kpi
          label="Features per Active User"
          value={f.feature_users ? (f.user_features / f.feature_users).toFixed(1) : '—'}
          icon={<Layers className="size-5" />}
          change={null}
          compareLabel={null}
          info="Average number of different features each feature user used in the period."
        />
        <Kpi
          label="Feature Adoption Growth"
          value={pct(adoption)}
          icon={<TrendingUp className="size-5" />}
          change={ppChange(adoption, adoptionCmp)}
          unit="pp"
          compareLabel={cmp}
          sub={`Of ${nf(f.eligible)} active people`}
          info="Active people who used any feature ÷ active people, and its change in percentage points."
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="Feature Adoption"
          info={`Adoption = distinct people who used the feature ÷ active people in the period (${nf(f.eligible)}). Every signed-in person can use every feature, so all active people are eligible.`}
        >
          <ProgressBars
            rows={ranked.map((r) => ({
              label: FEATURE_LABEL[r.feature] ?? r.feature,
              value: rate(r.users, f.eligible) ?? 0,
              detail: `${nf(r.users)} of ${nf(f.eligible)} active people`,
            }))}
          />
        </Panel>
        <Panel
          title="Feature Usage Trend"
          info="Distinct people using each of the four most used features, per interval."
        >
          <Legend
            items={top.map((r, i) => ({
              label: FEATURE_LABEL[r.feature] ?? r.feature,
              color: COLORS[i]!,
            }))}
          />
          <ColumnChart
            caption="People using the top features per interval"
            labels={labels}
            series={top.map((r, i) => ({
              name: FEATURE_LABEL[r.feature] ?? r.feature,
              color: COLORS[i]!,
              values: allStarts.map(
                (s) => f.series.find((x) => x.start === s && x.feature === r.feature)?.users ?? 0,
              ),
            }))}
          />
        </Panel>
        <Panel
          title="New vs Returning Feature Users"
          info="Returning = people who had used the feature before this period. New = first time in this period."
        >
          <Legend
            items={[
              { label: 'New', color: SERIES.gold },
              { label: 'Returning', color: SERIES.navy },
            ]}
          />
          <ColumnChart
            caption="New and returning users per feature"
            labels={ranked.filter((r) => r.users).map((r) => FEATURE_LABEL[r.feature] ?? r.feature)}
            series={[
              {
                name: 'New',
                color: SERIES.gold,
                values: ranked.filter((r) => r.users).map((r) => r.users - r.returning_users),
              },
              {
                name: 'Returning',
                color: SERIES.navy,
                values: ranked.filter((r) => r.users).map((r) => r.returning_users),
              },
            ]}
          />
        </Panel>
        <NotTracked
          label="Feature Discovery Funnel"
          reason="Seeing or opening a feature isn't recorded (only meaningful actions are), so Seen → Opened → First action → Repeat can't be measured yet."
        />
      </div>

      <Panel
        title="Feature Usage"
        info="Sessions per feature aren't measured. Trend compares distinct users with the comparison period."
      >
        <DataTable
          caption="Feature usage"
          searchable
          columns={[
            { key: 'feature', label: 'Feature' },
            { key: 'eligible', label: 'Eligible Users', numeric: true },
            { key: 'users', label: 'Unique Users', numeric: true },
            { key: 'adoption', label: 'Adoption Rate', numeric: true, format: 'percent' },
            { key: 'events', label: 'Events', numeric: true },
            { key: 'prev', label: 'Previous Period', numeric: true },
            { key: 'trend', label: 'Trend', numeric: true, format: 'percent' },
          ]}
          rows={rows.map((r) => ({
            feature: FEATURE_LABEL[r.feature] ?? r.feature,
            eligible: f.eligible,
            users: r.users,
            adoption: rate(r.users, f.eligible),
            events: r.events,
            prev: r.users_cmp,
            trend: pctChange(r.users, r.users_cmp),
          }))}
        />
      </Panel>
    </>
  );
}
