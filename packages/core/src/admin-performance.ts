import type { Database, ActorContext } from '@st/db';
import { callAdminReport, type CommandCenter } from './admin-analytics';
import { COMPARE_LABEL, pctChange, rate, type Period } from './period';

/**
 * Founder admin, Platform Performance. Each tab has one permission-checked SQL function that
 * returns aggregates only (see migration 0032). The Overview tab reuses the Command Center.
 * Key Trends & Insights are deterministic rules over those numbers: no free text is generated.
 */

export const PERF_TABS = [
  'overview',
  'growth',
  'engagement',
  'features',
  'conversion',
  'delivery',
] as const;
export type PerfTab = (typeof PERF_TABS)[number];
export const PERF_TAB_LABEL: Record<PerfTab, string> = {
  overview: 'Overview',
  growth: 'Growth',
  engagement: 'Engagement',
  features: 'Feature Usage',
  conversion: 'Conversion & Retention',
  delivery: 'Delivery & Operations',
};
export const parsePerfTab = (v: string | null | undefined): PerfTab =>
  (PERF_TABS as readonly string[]).includes(v ?? '') ? (v as PerfTab) : 'overview';

/** The feature registry, in display order. Matches st_admin_feature() in SQL. */
export const FEATURES = [
  'create',
  'send',
  'templates',
  'studio',
  'team',
  'contacts',
  'integrations',
  'api',
] as const;
export const FEATURE_LABEL: Record<string, string> = {
  create: 'Document Creation',
  send: 'Send for Signature',
  templates: 'Templates',
  studio: 'Signature Studio',
  team: 'Team Collaboration',
  contacts: 'Contacts',
  integrations: 'Integrations',
  api: 'API & Webhooks',
};

type N = number;
type C = N | null;

export interface PerfGrowth {
  kpi: {
    users_total: N;
    users_start: N;
    users_new: N;
    users_new_cmp: C;
    users_start_cmp: C;
    orgs_total: N;
    orgs_start: N;
    orgs_new: N;
    orgs_new_cmp: C;
    orgs_start_cmp: C;
    orgs_active: N;
    orgs_active_cmp: C;
    orgs_paid: N;
    orgs_paid_cmp: C;
    orgs_total_cmp: C;
  };
  series: {
    start: string;
    users_new: N;
    orgs_new: N;
    users_total: N;
    orgs_total: N;
    users_start: N;
    activated: N;
    paying: N;
  }[];
  by_plan: { plans: string[]; rows: { start: string; plan: string; orgs: N }[] };
  generated_at: string;
}

export interface PerfEngagement {
  kpi: {
    active_users: N;
    active_users_cmp: C;
    dau_avg: N;
    wau: N;
    mau: N;
    active_days: N;
    signins: N;
    returning: C;
    registered: N;
    orgs_active: N;
    orgs_active_cmp: C;
    feature_users: N;
    period_days: N;
  };
  series: { start: string; active_users: N; signins: N; orgs_active: N }[];
  frequency: { daily: N; several_weekly: N; weekly: N; occasional: N; inactive: N };
  by_plan: { plan: string; orgs: N }[];
  generated_at: string;
}

export interface PerfFeatures {
  eligible: N;
  eligible_cmp: C;
  events: N;
  events_cmp: C;
  feature_users: N;
  feature_users_cmp: C;
  user_features: N;
  rows: {
    feature: string;
    users: N;
    events: N;
    users_cmp: C;
    events_cmp: C;
    returning_users: N;
  }[];
  /** One row per interval and feature; an interval with no use has feature null. */
  series: { start: string; feature: string | null; users: N | null }[];
  generated_at: string;
}

export interface PerfConversion {
  funnel: {
    registered: N;
    workspace: N;
    document_created: N;
    document_sent: N;
    repeat: N;
    registered_cmp: C;
    document_sent_cmp: C;
  };
  studio_funnel: {
    visited: N;
    started: N;
    customized: N;
    auth: N;
    checkout: N;
    paid: N;
    downloaded: N;
  };
  paid_funnel: { orgs: N; used: N; paid: N; repeat: N };
  retention: {
    d1_eligible: N;
    d1: N;
    d7_eligible: N;
    d7: N;
    d30_eligible: N;
    d30: N;
  };
  cohorts: { month: string; size: N; suppressed: boolean; retained: (N | null)[] | null }[];
  orgs: { active: N; active_cmp: C; retained: C; recovered: C };
  subscriptions: { active: N; cancelling: N; ended: N };
  generated_at: string;
}

export interface PerfDelivery {
  kpi: {
    created: N;
    created_cmp: C;
    sent: N;
    sent_cmp: C;
    completed: N;
    completed_cmp: C;
    cohort_completed: N;
    median_hours: C;
    avg_hours: C;
    finalized_ok: N;
    finalized_failed: N;
    finalized_failed_cmp: C;
    signing_started: N;
    signing_signed: N;
    signing_declined: N;
    certificates: N;
    certificates_reissued: N;
  };
  status: CommandCenter['doc_status'];
  series: {
    start: string;
    created: N;
    sent: N;
    completed: N;
    failed: N;
    certificates: N;
    reissued: N;
    signing_started: N;
    signing_signed: N;
    signing_declined: N;
    signing_minutes: C;
  }[];
  completion_time: { under_1h: N; under_1d: N; under_3d: N; under_7d: N; over_7d: N };
  reliability: {
    emails_total: N;
    emails_ok: N;
    webhooks_total: N;
    webhooks_ok: N;
    finalization_total: N;
    finalization_ok: N;
    sync_total: N;
    sync_ok: N;
  };
  failures:
    | {
        ref: string;
        service: string;
        category: string;
        at: string;
        status: string;
        attempts: N | null;
      }[]
    | null;
  generated_at: string;
}

export const getPerfGrowth = (db: Database, a: ActorContext, p: Period) =>
  callAdminReport<PerfGrowth>(db, a, 'st_admin_perf_growth', p);
export const getPerfEngagement = (db: Database, a: ActorContext, p: Period) =>
  callAdminReport<PerfEngagement>(db, a, 'st_admin_perf_engagement', p);
export const getPerfFeatures = (db: Database, a: ActorContext, p: Period) =>
  callAdminReport<PerfFeatures>(db, a, 'st_admin_perf_features', p);
export const getPerfConversion = (db: Database, a: ActorContext, p: Period) =>
  callAdminReport<PerfConversion>(db, a, 'st_admin_perf_conversion', p);
export const getPerfDelivery = (db: Database, a: ActorContext, p: Period) =>
  callAdminReport<PerfDelivery>(db, a, 'st_admin_perf_delivery', p);

/** Percentage-point change between two rates (both in %), or null when either is missing. */
export const ppChange = (cur: number | null, prev: number | null) =>
  cur == null || prev == null ? null : Math.round((cur - prev) * 10) / 10;

// ---------------------------------------------------------------------------------------------
// Key Trends & Insights

export type InsightTone = 'good' | 'info' | 'attention';
export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  /** What the metric means, shown with the insight. */
  definition: string;
  href: string;
}

/** Minimum sample before a change is called out, so tiny numbers don't produce headlines. */
export const INSIGHT_MIN_SAMPLE = 10;

const signed = (n: number, unit: '%' | ' pp') => `${n > 0 ? '+' : ''}${n.toFixed(1)}${unit}`;

/**
 * Deterministic rules over the Command Center numbers. Each fires only with a comparison period,
 * a large enough sample and a change past its threshold. Attention items come first; at most five.
 */
export function buildInsights(c: CommandCenter, p: Period, tabHref: (t: PerfTab) => string) {
  const out: Insight[] = [];
  const vs = p.compare === 'none' ? null : COMPARE_LABEL[p.compare].toLowerCase();
  const k = c.kpi;

  if (vs) {
    // New registrations.
    const users = pctChange(k.users_new, k.users_new_cmp);
    if (users != null && Math.max(k.users_new, k.users_new_cmp ?? 0) >= INSIGHT_MIN_SAMPLE) {
      if (users >= 10)
        out.push({
          id: 'growth_up',
          tone: 'good',
          title: 'Strong growth',
          detail: `New user registrations ${signed(users, '%')} vs. ${vs} (${k.users_new} vs. ${k.users_new_cmp}).`,
          definition: 'Accounts created in the period.',
          href: tabHref('growth'),
        });
      else if (users <= -10)
        out.push({
          id: 'growth_down',
          tone: 'attention',
          title: 'Fewer sign-ups',
          detail: `New user registrations ${signed(users, '%')} vs. ${vs} (${k.users_new} vs. ${k.users_new_cmp}).`,
          definition: 'Accounts created in the period.',
          href: tabHref('growth'),
        });
    }

    // Completion rate of the sent cohort.
    const cr = rate(k.cohort_completed, k.docs_sent);
    const crPrev = rate(k.cohort_completed_cmp ?? 0, k.docs_sent_cmp ?? 0);
    const crPp = ppChange(cr, crPrev);
    if (
      crPp != null &&
      k.docs_sent >= INSIGHT_MIN_SAMPLE &&
      (k.docs_sent_cmp ?? 0) >= INSIGHT_MIN_SAMPLE &&
      Math.abs(crPp) >= 2
    )
      out.push({
        id: crPp > 0 ? 'completion_up' : 'completion_down',
        tone: crPp > 0 ? 'good' : 'attention',
        title: crPp > 0 ? 'Higher completion rate' : 'Lower completion rate',
        detail: `Completion rate ${signed(crPp, ' pp')} vs. ${vs} (${cr!.toFixed(1)}% vs. ${crPrev!.toFixed(1)}%).`,
        definition: 'Of the live requests sent in the period, the share now completed.',
        href: tabHref('delivery'),
      });

    // Net revenue (only when the viewer may see revenue).
    const money = c.revenue?.totals[0];
    if (money && money.net_cmp != null && money.net_cmp > 0) {
      const ch = pctChange(money.net, money.net_cmp);
      if (ch != null && Math.abs(ch) >= 10)
        out.push({
          id: ch > 0 ? 'revenue_up' : 'revenue_down',
          tone: ch > 0 ? 'good' : 'attention',
          title: ch > 0 ? 'Revenue growth' : 'Revenue down',
          detail: `Net collected revenue (${money.currency}) ${signed(ch, '%')} vs. ${vs}.`,
          definition: 'Successful payments minus refunds and disputes, by date paid.',
          href: tabHref('overview'),
        });
    }

    // Signature Studio sessions.
    const st = pctChange(c.studio.sessions, c.studio.sessions_cmp);
    if (
      st != null &&
      Math.max(c.studio.sessions, c.studio.sessions_cmp ?? 0) >= INSIGHT_MIN_SAMPLE &&
      Math.abs(st) >= 20
    )
      out.push({
        id: st > 0 ? 'studio_up' : 'studio_down',
        tone: st > 0 ? 'good' : 'attention',
        title: st > 0 ? 'More designer sessions' : 'Fewer designer sessions',
        detail: `Signature Studio designer sessions ${signed(st, '%')} vs. ${vs}.`,
        definition: 'Distinct designer sessions that started a design.',
        href: tabHref('conversion'),
      });
  }

  // Signature Studio conversion (no comparison needed: a level, with enough designs).
  const conv = rate(c.studio.designs_purchased, c.studio.designs);
  if (conv != null && c.studio.designs >= INSIGHT_MIN_SAMPLE)
    out.push({
      id: 'studio_conversion',
      tone: 'info',
      title: 'Signature Studio conversion',
      detail: `${conv.toFixed(1)}% of the ${c.studio.designs} designs created in the period were bought.`,
      definition: 'Designs created in the period and later purchased ÷ designs created.',
      href: tabHref('conversion'),
    });

  // Operational problems are called out regardless of sample size.
  if (c.health.finalization_failed > 0)
    out.push({
      id: 'finalization_failures',
      tone: 'attention',
      title: 'Document finishing failures',
      detail: `${c.health.finalization_failed} signed request${c.health.finalization_failed === 1 ? '' : 's'} could not be finished and ${c.health.finalization_failed === 1 ? 'is' : 'are'} waiting for a retry.`,
      definition:
        'Requests where everyone signed but the signed copy or certificate was not built.',
      href: tabHref('delivery'),
    });
  if (c.health.webhooks_dead > 0)
    out.push({
      id: 'webhooks_dead',
      tone: 'attention',
      title: 'Webhook deliveries gave up',
      detail: `${c.health.webhooks_dead} webhook deliver${c.health.webhooks_dead === 1 ? 'y' : 'ies'} failed after all retries in the period.`,
      definition: 'Deliveries to customer endpoints marked dead after the last retry.',
      href: tabHref('delivery'),
    });
  const bounces = rate(c.health.emails_bounced + c.health.emails_failed, c.health.emails_total);
  if (bounces != null && c.health.emails_total >= 20 && bounces >= 5)
    out.push({
      id: 'email_failures',
      tone: 'attention',
      title: 'Email delivery problems',
      detail: `${bounces.toFixed(1)}% of emails in the period bounced or failed.`,
      definition: 'Bounced and failed emails ÷ emails attempted.',
      href: tabHref('delivery'),
    });

  const order: Record<InsightTone, number> = { attention: 0, good: 1, info: 2 };
  out.sort((a, b) => order[a.tone] - order[b.tone]);
  return out.slice(0, 5);
}

// ---------------------------------------------------------------------------------------------
// CSV exports (aggregates only; the route escapes every cell).

const s = (v: unknown) => (v == null ? '' : String(v));

export function perfCsv(
  tab: Exclude<PerfTab, 'overview'>,
  d: PerfGrowth | PerfEngagement | PerfFeatures | PerfConversion | PerfDelivery,
  p: Period,
): string[][] {
  const head: string[][] = [
    [`Signature Tender Platform Performance: ${PERF_TAB_LABEL[tab]}`],
    ['Period (UTC)', p.from.toISOString(), p.to.toISOString()],
    ['Comparison (UTC)', p.cmpFrom?.toISOString() ?? 'none', p.cmpTo?.toISOString() ?? ''],
    ['Generated', d.generated_at],
    [],
  ];
  const kv = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => [k, s(v)]);
  const table = (rows: Record<string, unknown>[]) =>
    rows.length ? [Object.keys(rows[0]!), ...rows.map((r) => Object.values(r).map(s))] : [];
  switch (tab) {
    case 'growth': {
      const g = d as PerfGrowth;
      return [
        ...head,
        ['Metric', 'Value'],
        ...kv(g.kpi),
        [],
        ...table(g.series),
        [],
        ...table(g.by_plan.rows),
      ];
    }
    case 'engagement': {
      const e = d as PerfEngagement;
      return [
        ...head,
        ['Metric', 'Value'],
        ...kv(e.kpi),
        [],
        ['Activity frequency', 'People'],
        ...kv(e.frequency),
        [],
        ...table(e.series),
        [],
        ...table(e.by_plan),
      ];
    }
    case 'features': {
      const f = d as PerfFeatures;
      return [
        ...head,
        ['Eligible active people', s(f.eligible)],
        ['Feature events', s(f.events)],
        [],
        ...table(f.rows.map((r) => ({ ...r, feature: FEATURE_LABEL[r.feature] ?? r.feature }))),
        [],
        ...table(f.series),
      ];
    }
    case 'conversion': {
      const c = d as PerfConversion;
      return [
        ...head,
        ['Sign-up funnel', 'People'],
        ...kv(c.funnel),
        [],
        ['Signature Studio funnel', 'Sessions'],
        ...kv(c.studio_funnel),
        [],
        ['Paid funnel', 'Organizations'],
        ...kv(c.paid_funnel),
        [],
        ['Retention', 'People'],
        ...kv(c.retention),
        [],
        ['Organizations', 'Count'],
        ...kv(c.orgs),
        [],
        ['Subscriptions (now)', 'Count'],
        ...kv(c.subscriptions),
        [],
        ['Cohort month', 'Size', 'Month 0', 'Month 1', 'Month 2', 'Month 3', 'Month 4', 'Month 5'],
        ...c.cohorts.map((r) => [
          r.month,
          r.suppressed ? 'fewer than 5' : s(r.size),
          ...(r.retained ?? []).map(s),
        ]),
      ];
    }
    case 'delivery': {
      const x = d as PerfDelivery;
      return [
        ...head,
        ['Metric', 'Value'],
        ...kv(x.kpi),
        [],
        ['Status (sent in period)', 'Count'],
        ...kv(x.status),
        [],
        ['Completion time', 'Requests'],
        ...kv(x.completion_time),
        [],
        ['Reliability', 'Count'],
        ...kv(x.reliability),
        [],
        ...table(x.series),
        ...(x.failures?.length ? [[], ...table(x.failures)] : []),
      ];
    }
  }
}
