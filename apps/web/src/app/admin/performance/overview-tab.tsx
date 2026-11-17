import Link from 'next/link';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { buildInsights, getCommandCenter, INSIGHT_MIN_SAMPLE, type PerfTab } from '@st/core';
import { db } from '@/lib/db';
import { Panel } from '@/components/admin/charts';
import {
  DocTypesPanel,
  FeaturesPanel,
  GrowthPanel,
  KpiRow,
  RevenuePanel,
  StatusPanel,
  StudioPanel,
  Toggle,
  fmtTime,
} from '../sections';
import type { TabProps } from './page';

const TONE = {
  good: { Icon: CircleCheck, cls: 'text-success', label: 'Favorable' },
  info: { Icon: Info, cls: 'text-gold', label: 'Information' },
  attention: { Icon: TriangleAlert, cls: 'text-burgundy', label: 'Needs attention' },
} as const;

export async function OverviewTab({ p, sp, userId, href, params, cmp }: TabProps) {
  const c = await getCommandCenter(db(), { userId }, p);
  const cumulative = sp.growth === 'cumulative';
  const rev = sp.rev === 'gross' || sp.rev === 'service' ? sp.rev : 'net';
  const measure = sp.measure === 'users' ? 'users' : 'adoption';
  const insights = buildInsights(c, p, (t: PerfTab) => href(t));
  return (
    <>
      <p className="-mt-3 text-xs text-slate-text">
        Live from the database at {fmtTime(c.generated_at)} UTC. Periods are in UTC. Test requests
        are excluded.
      </p>
      <KpiRow
        c={c}
        cmp={cmp}
        links={{
          users: href('growth'),
          orgs: href('growth'),
          docs: href('delivery'),
          done: href('delivery'),
          studio: href('conversion'),
          revenue: href('overview', { rev: 'service' }),
        }}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <GrowthPanel
          title="User & Organization Growth"
          c={c}
          p={p}
          cumulative={cumulative}
          toggle={
            <Toggle
              label="Measure"
              base="/admin/performance"
              params={params}
              name="growth"
              value={cumulative ? 'cumulative' : 'new'}
              options={[
                ['new', 'New registrations'],
                ['cumulative', 'Cumulative'],
              ]}
            />
          }
        />
        <StatusPanel
          status={c.doc_status}
          action={
            <Link
              href={href('delivery')}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Breakdown
            </Link>
          }
        />
        <RevenuePanel
          c={c}
          p={p}
          view={rev}
          toggle={
            c.revenue ? (
              <Toggle
                label="Revenue view"
                base="/admin/performance"
                params={params}
                name="rev"
                value={rev}
                options={[
                  ['net', 'Net collected'],
                  ['gross', 'Gross collected'],
                  ['service', 'By service'],
                ]}
              />
            ) : null
          }
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-4">
        <FeaturesPanel
          c={c}
          measure={measure}
          rowHref={href('features')}
          toggle={
            <Toggle
              label="Feature measure"
              base="/admin/performance"
              params={params}
              name="measure"
              value={measure}
              options={[
                ['adoption', 'Adoption rate'],
                ['users', 'Unique active users'],
              ]}
            />
          }
        />
        <StudioPanel c={c} cmp={cmp} href={href('conversion')} />
        <DocTypesPanel c={c} />
        <Panel
          title="Key Trends & Insights"
          info={`Calculated from the numbers on this page with fixed rules: a change is called out only with a comparison period, at least ${INSIGHT_MIN_SAMPLE} records and a change past its threshold. Problems (failures, bounces) are always shown.`}
        >
          {insights.length ? (
            <ul className="flex flex-col gap-3">
              {insights.map((i) => {
                const t = TONE[i.tone];
                return (
                  <li key={i.id}>
                    <Link href={i.href} className="group flex gap-2">
                      <t.Icon className={`mt-0.5 size-4 shrink-0 ${t.cls}`} aria-hidden />
                      <span className="text-sm">
                        <span className="font-semibold text-heading group-hover:underline">
                          <span className="sr-only">{t.label}: </span>
                          {i.title}
                        </span>
                        <span className="block text-xs">{i.detail}</span>
                        <span className="block text-[11px] text-slate-text">{i.definition}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm">
              No notable changes for this period. Changes are only called out when there is a
              comparison period and enough activity to be meaningful.
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}
