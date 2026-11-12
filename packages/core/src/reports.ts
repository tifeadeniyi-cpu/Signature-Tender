import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withActor, type Database, type ActorContext, type Tx } from '@st/db';
import { AppError } from './errors';
import { csvCell } from './contacts';

/**
 * Workspace reports (spec Phase 8: analytics and usage insights). Everything runs as the signed-in
 * member under row-level security, so a member who can only see their own documents gets a report
 * of their own documents. Credit and API sections need billing.manage and api.manage.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const reportRangeSchema = z
  .object({ from: day, to: day })
  .refine((r) => r.from <= r.to, 'The start date must be before the end date')
  .refine(
    (r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 366 * 2,
    'Choose a range of two years or less',
  );
export type ReportRange = z.infer<typeof reportRangeSchema>;

/** The last `days` days up to today (UTC). */
export function defaultRange(days = 90, now = new Date()): ReportRange {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

async function can(tx: Tx, ws: string, perm: string) {
  const [r] = (await tx.execute(
    sql`select st_has_permission(${ws}::uuid, ${perm}) as ok`,
  )) as unknown as { ok: boolean }[];
  return Boolean(r?.ok);
}

const inRange = (col: ReturnType<typeof sql.raw>, r: ReportRange) =>
  sql`${col} >= ${r.from}::date and ${col} < (${r.to}::date + 1)`;

export interface WorkspaceReport {
  range: ReportRange;
  includeTests: boolean;
  totals: {
    sent: number;
    completed: number;
    declined: number;
    expired: number;
    cancelled: number;
    open: number;
    awaitingPayment: number;
    failed: number;
  };
  /** Completed out of everything that reached an end state, as a fraction; null if none did. */
  completionRate: number | null;
  medianHoursToComplete: number | null;
  averageHoursToComplete: number | null;
  byMonth: { month: string; sent: number; completed: number }[];
  byType: { documentType: string; sent: number; completed: number }[];
  bySender: { name: string; sent: number; completed: number }[];
  recipients: { total: number; viewed: number; signed: number; declined: number };
  credits: { month: string; added: number; used: number }[] | null;
  api: { day: string; calls: number; errors: number }[] | null;
  webhooks: { succeeded: number; retrying: number; failed: number } | null;
}

export async function getWorkspaceReport(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  rawRange: z.input<typeof reportRangeSchema>,
  opts: { includeTests?: boolean } = {},
): Promise<WorkspaceReport> {
  if (!z.string().uuid().safeParse(workspaceId).success)
    throw new AppError('not_found', 'Workspace not found');
  const range = reportRangeSchema.parse(rawRange);
  const includeTests = Boolean(opts.includeTests);
  return withActor(db, actor, async (tx) => {
    if (
      !(await can(tx, workspaceId, 'documents.view_own')) &&
      !(await can(tx, workspaceId, 'documents.view_all'))
    )
      throw new AppError('forbidden', 'Your role cannot view reports.');
    const base = sql`sr.workspace_id = ${workspaceId}::uuid and ${inRange(sql.raw('sr.created_at'), range)}
      ${includeTests ? sql`` : sql`and not sr.is_test`}`;

    const [t] = (await tx.execute(sql`
      select count(*) filter (where sr.sent_at is not null)::int as sent,
        count(*) filter (where sr.status = 'completed')::int as completed,
        count(*) filter (where sr.status = 'declined')::int as declined,
        count(*) filter (where sr.status = 'expired')::int as expired,
        count(*) filter (where sr.status = 'cancelled')::int as cancelled,
        count(*) filter (where sr.status in ('sent','in_progress','awaiting_approval'))::int as open,
        count(*) filter (where sr.status in ('awaiting_payment','payment_processing','ready_to_dispatch','queued'))::int as awaiting_payment,
        count(*) filter (where sr.status = 'finalization_failed')::int as failed,
        percentile_cont(0.5) within group (order by extract(epoch from sr.completed_at - sr.sent_at) / 3600)
          filter (where sr.status = 'completed' and sr.sent_at is not null) as median_h,
        avg(extract(epoch from sr.completed_at - sr.sent_at) / 3600)
          filter (where sr.status = 'completed' and sr.sent_at is not null) as avg_h
      from signing_requests sr where ${base}
    `)) as unknown as Record<string, number | string | null>[];
    const n = (k: string) => Number(t?.[k] ?? 0);
    const ended = n('completed') + n('declined') + n('expired') + n('cancelled');
    const hours = (v: unknown) =>
      v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;

    const byMonth = (await tx.execute(sql`
      select to_char(date_trunc('month', sr.created_at), 'YYYY-MM') as month,
        count(*) filter (where sr.sent_at is not null)::int as sent,
        count(*) filter (where sr.status = 'completed')::int as completed
      from signing_requests sr where ${base} group by 1 order by 1
    `)) as unknown as { month: string; sent: number; completed: number }[];

    const byType = (
      (await tx.execute(sql`
        select coalesce(d.document_type, 'unknown') as document_type,
          count(*) filter (where sr.sent_at is not null)::int as sent,
          count(*) filter (where sr.status = 'completed')::int as completed
        from signing_requests sr left join documents d on d.id = sr.document_id
        where ${base} group by 1 order by 2 desc limit 20
      `)) as unknown as { document_type: string; sent: number; completed: number }[]
    ).map((r) => ({ documentType: r.document_type, sent: r.sent, completed: r.completed }));

    const bySender = (await tx.execute(sql`
      select sr.sender_name as name,
        count(*) filter (where sr.sent_at is not null)::int as sent,
        count(*) filter (where sr.status = 'completed')::int as completed
      from signing_requests sr where ${base} group by 1 order by 2 desc limit 10
    `)) as unknown as { name: string; sent: number; completed: number }[];

    const [rc] = (await tx.execute(sql`
      select count(*)::int as total,
        count(*) filter (where rr.viewed_at is not null)::int as viewed,
        count(*) filter (where rr.signed_at is not null)::int as signed,
        count(*) filter (where rr.declined_at is not null)::int as declined
      from request_recipients rr join signing_requests sr on sr.id = rr.request_id
      where ${base} and rr.role <> 'cc'
    `)) as unknown as WorkspaceReport['recipients'][];

    let credits: WorkspaceReport['credits'] = null;
    if (await can(tx, workspaceId, 'billing.manage'))
      credits = (await tx.execute(sql`
        select to_char(date_trunc('month', l.created_at), 'YYYY-MM') as month,
          coalesce(sum(l.delta) filter (where l.entry_type in ('purchase','subscription_allowance','promotional','admin_adjustment') and l.delta > 0), 0)::int as added,
          coalesce(-sum(l.delta) filter (where l.entry_type = 'reserve'), 0)::int
            - coalesce(sum(l.delta) filter (where l.entry_type = 'restore'), 0)::int as used
        from credit_ledger l
        where l.workspace_id = ${workspaceId}::uuid and ${inRange(sql.raw('l.created_at'), range)}
        group by 1 order by 1
      `)) as unknown as { month: string; added: number; used: number }[];

    let api: WorkspaceReport['api'] = null;
    let webhooks: WorkspaceReport['webhooks'] = null;
    if (await can(tx, workspaceId, 'api.manage')) {
      api = (await tx.execute(sql`
        select day, sum(calls)::int as calls, sum(errors)::int as errors from api_usage_daily
        where workspace_id = ${workspaceId}::uuid and day >= ${range.from} and day <= ${range.to}
        group by day order by day
      `)) as unknown as { day: string; calls: number; errors: number }[];
      const [w] = (await tx.execute(sql`
        select count(*) filter (where status = 'succeeded')::int as succeeded,
          count(*) filter (where status in ('pending','delivering','failed'))::int as retrying,
          count(*) filter (where status = 'dead')::int as failed
        from webhook_deliveries where workspace_id = ${workspaceId}::uuid and ${inRange(sql.raw('created_at'), range)}
      `)) as unknown as { succeeded: number; retrying: number; failed: number }[];
      webhooks = w ?? { succeeded: 0, retrying: 0, failed: 0 };
    }

    return {
      range,
      includeTests,
      totals: {
        sent: n('sent'),
        completed: n('completed'),
        declined: n('declined'),
        expired: n('expired'),
        cancelled: n('cancelled'),
        open: n('open'),
        awaitingPayment: n('awaiting_payment'),
        failed: n('failed'),
      },
      completionRate: ended ? n('completed') / ended : null,
      medianHoursToComplete: hours(t?.median_h),
      averageHoursToComplete: hours(t?.avg_h),
      byMonth,
      byType,
      bySender,
      recipients: rc ?? { total: 0, viewed: 0, signed: 0, declined: 0 },
      credits,
      api,
      webhooks,
    };
  });
}

/** One row per request in the range, for spreadsheets. No recipient emails or document contents. */
export async function exportReportCsv(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  rawRange: z.input<typeof reportRangeSchema>,
  opts: { includeTests?: boolean } = {},
): Promise<string> {
  const range = reportRangeSchema.parse(rawRange);
  const rows = await withActor(db, actor, async (tx) => {
    if (
      !(await can(tx, workspaceId, 'documents.view_own')) &&
      !(await can(tx, workspaceId, 'documents.view_all'))
    )
      throw new AppError('forbidden', 'Your role cannot view reports.');
    return (await tx.execute(sql`
      select sr.id, sr.title, coalesce(d.document_type, '') as document_type, sr.status::text as status,
        sr.is_test, sr.sender_name, sr.created_at, sr.sent_at, sr.completed_at, sr.closed_at,
        (select count(*) from request_recipients rr where rr.request_id = sr.id and rr.role <> 'cc')::int as recipients,
        round((extract(epoch from sr.completed_at - sr.sent_at) / 3600)::numeric, 1) as hours_to_complete
      from signing_requests sr left join documents d on d.id = sr.document_id
      where sr.workspace_id = ${workspaceId}::uuid and ${inRange(sql.raw('sr.created_at'), range)}
        ${opts.includeTests ? sql`` : sql`and not sr.is_test`}
      order by sr.created_at desc limit 10000
    `)) as unknown as Record<string, unknown>[];
  });
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : '');
  const header = [
    'request_id',
    'title',
    'document_type',
    'status',
    'test',
    'sender',
    'created_at',
    'sent_at',
    'completed_at',
    'closed_at',
    'recipients',
    'hours_to_complete',
  ];
  const lines = rows.map((r) =>
    [
      r.id,
      r.title,
      r.document_type,
      r.status,
      r.is_test ? 'yes' : 'no',
      r.sender_name,
      iso(r.created_at),
      iso(r.sent_at),
      iso(r.completed_at),
      iso(r.closed_at),
      String(r.recipients),
      r.hours_to_complete === null ? '' : String(r.hours_to_complete),
    ]
      .map((v) => csvCell(String(v ?? '')))
      .join(','),
  );
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}
