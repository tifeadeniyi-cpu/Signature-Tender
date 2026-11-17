import Link from 'next/link';
import { Download, ChevronDown } from 'lucide-react';
import {
  COMPARE_LABEL,
  PERF_TABS,
  PERF_TAB_LABEL,
  parsePerfTab,
  resolvePeriod,
  type Period,
} from '@st/core';
import { requireAdmin } from '@/lib/session';
import { PeriodFilter } from '@/components/admin/period-filter';
import { PrintButton } from '@/components/admin/print-button';
import { filterParams } from '../sections';
import { OverviewTab } from './overview-tab';
import { GrowthTab } from './growth-tab';
import { EngagementTab } from './engagement-tab';
import { FeaturesTab } from './features-tab';
import { ConversionTab } from './conversion-tab';
import { DeliveryTab } from './delivery-tab';

export const metadata = { title: 'Platform Performance' };

export type PerfSearch = {
  tab?: string;
  range?: string;
  compare?: string;
  from?: string;
  to?: string;
  bucket?: string;
  growth?: string;
  rev?: string;
  measure?: string;
  cum?: string;
  acq?: string;
};

export interface TabProps {
  p: Period;
  sp: PerfSearch;
  userId: string;
  permissions: string[];
  /** A link to a tab with the current filters (plus any extra parameters). */
  href: (tab: string, extra?: Record<string, string>) => string;
  /** The current filters and tab, for toggles that change one parameter. */
  params: URLSearchParams;
  cmp: string | null;
}

/** Interval override for the time series: day only up to about three months. */
function withBucket(p: Period, b: string | undefined): Period {
  if (b === 'week' || b === 'month') return { ...p, bucket: b };
  if (b === 'day' && p.to.getTime() - p.from.getTime() <= 92 * 86_400_000)
    return { ...p, bucket: 'day' };
  return p;
}

export default async function PlatformPerformancePage({
  searchParams,
}: {
  searchParams: Promise<PerfSearch>;
}) {
  const sp = await searchParams;
  const tab = parsePerfTab(sp.tab);
  const { user, access } = await requireAdmin('analytics.view', `performance_${tab}`);
  const p = withBucket(resolvePeriod(sp), sp.bucket);
  const filters = filterParams(p, sp);
  const href = (t: string, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(filters);
    if (t !== 'overview') q.set('tab', t);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `/admin/performance?${q}`;
  };
  const params = new URLSearchParams(filters);
  if (tab !== 'overview') params.set('tab', tab);
  if (sp.bucket) params.set('bucket', p.bucket);
  const props: TabProps = {
    p,
    sp,
    userId: user.id,
    permissions: access.permissions,
    href,
    params,
    cmp: p.compare === 'none' ? null : COMPARE_LABEL[p.compare],
  };
  const exportQ = new URLSearchParams(filters);
  exportQ.set('tab', tab);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Platform Performance</h1>
          <p className="mt-1 text-sm">
            Growth, adoption, utilization, and business performance across Signature Tender.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <PeriodFilter
            action="/admin/performance"
            range={p.range}
            compare={p.compare}
            from={sp.from}
            to={sp.to}
            keep={tab === 'overview' ? {} : { tab }}
          />
          <details className="relative">
            <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-lg bg-gold px-4 text-sm font-semibold text-heading hover:bg-soft-gold">
              <Download className="size-4" aria-hidden /> Export report
              <ChevronDown className="size-4" aria-hidden />
            </summary>
            <div className="absolute right-0 z-20 mt-1 flex w-64 flex-col rounded-xl border border-border bg-white p-1 text-sm shadow-lg">
              <a
                href={`/admin/performance/export?${exportQ}`}
                className="rounded-lg px-3 py-2 hover:bg-cream"
              >
                CSV: {PERF_TAB_LABEL[tab]}
              </a>
              <a
                href={`/admin/performance/export?${exportQ}&format=excel`}
                className="rounded-lg px-3 py-2 hover:bg-cream"
              >
                Excel: {PERF_TAB_LABEL[tab]}
                <span className="block text-xs text-slate-text">
                  A CSV file that opens in Excel
                </span>
              </a>
              <PrintButton className="rounded-lg px-3 py-2 text-left hover:bg-cream">
                PDF: print or save this tab
              </PrintButton>
            </div>
          </details>
        </div>
      </div>

      <nav
        aria-label="Platform Performance sections"
        className="-mx-1 overflow-x-auto print:hidden"
      >
        <ul className="flex min-w-max gap-1 rounded-xl border border-border bg-white p-1 px-1">
          {PERF_TABS.map((t) => (
            <li key={t}>
              <Link
                href={href(t)}
                aria-current={t === tab ? 'page' : undefined}
                className={`block whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  t === tab ? 'bg-gold text-heading' : 'text-heading hover:bg-cream'
                }`}
              >
                {PERF_TAB_LABEL[t]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'overview' ? <OverviewTab {...props} /> : null}
      {tab === 'growth' ? <GrowthTab {...props} /> : null}
      {tab === 'engagement' ? <EngagementTab {...props} /> : null}
      {tab === 'features' ? <FeaturesTab {...props} /> : null}
      {tab === 'conversion' ? <ConversionTab {...props} /> : null}
      {tab === 'delivery' ? <DeliveryTab {...props} /> : null}
    </div>
  );
}
