import { sql } from 'drizzle-orm';
import { withActor, type Database, type ActorContext } from '@st/db';
import { AppError } from './errors';

/**
 * Founder admin analytics (Command Center and Platform Performance). Periods are UTC: the
 * reporting time zone is UTC so day and month boundaries never double count. Every number comes
 * from st_admin_command_center, which returns aggregates only.
 */

export * from './period';
import type { Period } from './period';

type N = number;
export interface CommandCenter {
  kpi: {
    users_total: N;
    users_new: N;
    users_new_cmp: N | null;
    orgs_total: N;
    orgs_new: N;
    orgs_new_cmp: N | null;
    orgs_active: N;
    docs_sent: N;
    docs_sent_cmp: N | null;
    docs_sent_total: N;
    docs_completed: N;
    docs_completed_cmp: N | null;
    cohort_completed: N;
    cohort_completed_cmp: N | null;
    designs_new: N;
    designs_new_cmp: N | null;
    studio_purchases: N;
    studio_purchases_cmp: N | null;
  };
  growth: { start: string; users_new: N; orgs_new: N; users_total: N; orgs_total: N }[];
  doc_status: {
    completed: N;
    pending: N;
    declined: N;
    expired: N;
    cancelled: N;
    failed: N;
    total: N;
  };
  doc_types: { type: string; count: N }[];
  features: { active_users: N; rows: { feature: string; users: N }[] };
  studio: {
    sessions: N;
    sessions_cmp: N | null;
    designs: N;
    designs_purchased: N;
    downloads: N;
  };
  revenue: {
    totals: {
      currency: string;
      gross: N;
      refunded: N;
      disputed: N;
      net: N;
      gross_cmp: N | null;
      net_cmp: N | null;
    }[];
    by_kind: { kind: string; currency: string; net: N }[];
    series: { start: string; currency: string; gross: N; refunded: N; disputed: N; net: N }[];
  } | null;
  activity: { kind: string; at: string; severity: 'info' | 'warning' }[];
  audit: { id: string; action: string; at: string; risk: string; category: string }[] | null;
  security: {
    staff: N;
    staff_strong: N;
    denied: N;
    audit_append_only: boolean;
    production_signing: boolean | null;
  };
  health: {
    finalization_failed: N;
    webhooks_total: N;
    webhooks_ok: N;
    webhooks_dead: N;
    emails_total: N;
    emails_ok: N;
    emails_bounced: N;
    emails_failed: N;
    stripe_unprocessed: N;
    sync_failed: N;
  };
  generated_at: string;
}

/** Postgres returns bigint counts as strings inside jsonb aggregates; make them numbers. */
function numbers<T>(v: T): T {
  if (Array.isArray(v)) return v.map(numbers) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = numbers(x);
    return o as T;
  }
  if (typeof v === 'string' && /^-?\d+$/.test(v) && v.length < 16) return Number(v) as T;
  return v;
}

/** Calls one of the founder admin analytics functions; 42501 (not permitted) becomes forbidden. */
export async function callAdminReport<T>(
  db: Database,
  actor: ActorContext,
  fn: string,
  p: Period,
): Promise<T> {
  if (!/^st_admin_[a-z_]+$/.test(fn)) throw new Error('Unknown admin report');
  try {
    const [r] = (await withActor(db, actor, (tx) =>
      tx.execute(sql`select ${sql.raw(fn)}(${p.from.toISOString()}::timestamptz,
        ${p.to.toISOString()}::timestamptz, ${p.cmpFrom?.toISOString() ?? null}::timestamptz,
        ${p.cmpTo?.toISOString() ?? null}::timestamptz, ${p.bucket}) as c`),
    )) as unknown as { c: T }[];
    return numbers(r!.c);
  } catch (err) {
    const code =
      (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === '42501') throw new AppError('forbidden', 'Signature Tender staff only.');
    throw err;
  }
}

export function getCommandCenter(
  db: Database,
  actor: ActorContext,
  p: Period,
): Promise<CommandCenter> {
  return callAdminReport<CommandCenter>(db, actor, 'st_admin_command_center', p);
}

/** Writes an audit event for an admin report export (the actor's own platform-level event). */
export async function recordAdminExport(
  db: Database,
  actor: ActorContext,
  report: string,
  p: Period,
) {
  await withActor(db, actor, (tx) =>
    tx.execute(sql`insert into audit_events (workspace_id, actor_user_id, action, target_type, target_id, metadata)
      values (null, ${actor.userId}, 'admin.report_exported', 'report', ${report},
        ${JSON.stringify({ range: p.range, compare: p.compare, from: p.from.toISOString(), to: p.to.toISOString() })}::jsonb)`),
  );
}

/** The Command Center as CSV rows (metric, current, comparison). Aggregates only. */
export function commandCenterCsv(c: CommandCenter, p: Period): string[][] {
  const rows: string[][] = [
    ['Signature Tender Command Center'],
    ['Period (UTC)', p.from.toISOString(), p.to.toISOString()],
    ['Comparison (UTC)', p.cmpFrom?.toISOString() ?? 'none', p.cmpTo?.toISOString() ?? ''],
    ['Generated', c.generated_at],
    [],
    ['Metric', 'Current period', 'Comparison period'],
  ];
  const k = c.kpi;
  const add = (label: string, cur: number | string, cmp: number | string | null | undefined) =>
    rows.push([label, String(cur), cmp == null ? '' : String(cmp)]);
  add('Registered users (total at end of period)', k.users_total, null);
  add('New users', k.users_new, k.users_new_cmp);
  add('Organizations (total at end of period)', k.orgs_total, null);
  add('New organizations', k.orgs_new, k.orgs_new_cmp);
  add('Organizations that sent a live request', k.orgs_active, null);
  add('Live requests sent', k.docs_sent, k.docs_sent_cmp);
  add('Live requests completed', k.docs_completed, k.docs_completed_cmp);
  add('Sent in period and now completed', k.cohort_completed, k.cohort_completed_cmp);
  add('Signature Studio designs created', k.designs_new, k.designs_new_cmp);
  add('Signature Studio purchases', k.studio_purchases, k.studio_purchases_cmp);
  if (c.revenue) {
    rows.push(
      [],
      [
        'Revenue, net collected by date paid (amounts in cents)',
        'Current period',
        'Comparison period',
      ],
    );
    if (!c.revenue.totals.length) rows.push(['No payments in this period', '0', '']);
  }
  for (const r of c.revenue?.totals ?? []) {
    add(`Gross collected (${r.currency}, cents)`, r.gross ?? 0, r.gross_cmp);
    add(`Refunded (${r.currency}, cents)`, r.refunded ?? 0, null);
    add(`Disputed (${r.currency}, cents)`, r.disputed ?? 0, null);
    add(`Net collected (${r.currency}, cents)`, r.net ?? 0, r.net_cmp);
  }
  rows.push([], ['Document status (requests sent in period)', 'Count']);
  for (const [s, n] of Object.entries(c.doc_status)) rows.push([s, String(n)]);
  rows.push(
    [],
    ['Interval start', 'New users', 'New organizations', 'Users total', 'Organizations total'],
  );
  for (const g of c.growth)
    rows.push([
      g.start,
      String(g.users_new),
      String(g.orgs_new),
      String(g.users_total),
      String(g.orgs_total),
    ]);
  return rows;
}
