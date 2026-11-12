import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withActor, type Database, type ActorContext } from '@st/db';
import { AppError } from './errors';

/**
 * Internal administration (spec Part 27), separate from workspace administration. Only users in
 * `platform_admins` can call these; the database functions check that, return counts and ids
 * only (never document contents, recipients or signatures), and record every view in the audit log.
 */

export async function isPlatformAdmin(db: Database, actor: ActorContext): Promise<boolean> {
  const [r] = (await withActor(db, actor, (tx) =>
    tx.execute(sql`select st_is_platform_admin() as ok`),
  )) as unknown as { ok: boolean }[];
  return Boolean(r?.ok);
}

async function call<T>(db: Database, actor: ActorContext, q: ReturnType<typeof sql>): Promise<T> {
  try {
    return (await withActor(db, actor, (tx) => tx.execute(q))) as unknown as T;
  } catch (err) {
    const code =
      (err as { code?: string; cause?: { code?: string } }).code ??
      (err as { cause?: { code?: string } }).cause?.code;
    if (code === '42501') throw new AppError('forbidden', 'Signature Tender staff only.');
    throw err;
  }
}

export interface RevenueRow {
  currency: string;
  kind: string;
  net_cents: number;
  payments: number;
}

export interface AdminOverview {
  workspaces: number;
  active_workspaces_30d: number;
  users: number;
  requests_total: number;
  requests_30d: number;
  test_requests_30d: number;
  completed_30d: number;
  pending: number;
  awaiting_payment: number;
  finalization_failed: number;
  webhooks_dead_30d: number;
  webhooks_retrying: number;
  credits_consumed_30d: number;
  api_calls_30d: number;
  revenue_30d: RevenueRow[];
  revenue_month: RevenueRow[];
  requests_by_month: { month: string; live: number; test: number; completed: number }[];
}

export async function getAdminOverview(db: Database, actor: ActorContext): Promise<AdminOverview> {
  const [r] = await call<{ o: AdminOverview }[]>(db, actor, sql`select st_admin_overview() as o`);
  return r!.o;
}

export interface AdminWorkspaceRow {
  id: string;
  name: string;
  created_at: Date;
  members: number;
  plan_code: string;
  subscription_status: string | null;
  live_requests: number;
  test_requests: number;
  last_request_at: Date | null;
  credits_available: number;
  failed_payments: number;
}

export async function listAdminWorkspaces(
  db: Database,
  actor: ActorContext,
  query = '',
  limit = 50,
) {
  const q = z.string().trim().max(120).catch('').parse(query);
  const rows = await call<AdminWorkspaceRow[]>(
    db,
    actor,
    sql`select * from st_admin_workspaces(${q}, ${Math.min(Math.max(limit, 1), 200)})`,
  );
  return rows.map((r) => ({
    ...r,
    members: Number(r.members),
    live_requests: Number(r.live_requests),
    test_requests: Number(r.test_requests),
    credits_available: Number(r.credits_available),
    failed_payments: Number(r.failed_payments),
  }));
}

export interface AdminOperations {
  finalization_failures: {
    request_id: string;
    workspace_id: string;
    workspace: string;
    updated_at: string;
    error: string | null;
  }[];
  webhook_failures: {
    delivery_id: string;
    workspace_id: string;
    workspace: string;
    event_type: string;
    status: string;
    attempts: number;
    last_status_code: number | null;
    error: string | null;
    last_attempt_at: string | null;
    host: string;
  }[];
  payment_issues: {
    payment_id: string;
    workspace_id: string;
    workspace: string;
    kind: string;
    status: string;
    amount_cents: number;
    currency: string;
    created_at: string;
    reason: string | null;
  }[];
  stripe_events_unprocessed: number;
  stuck_requests: number;
  feature_flags: { key: string; enabled: boolean; environments: string[] }[];
}

export async function getAdminOperations(
  db: Database,
  actor: ActorContext,
  limit = 50,
): Promise<AdminOperations> {
  const [r] = await call<{ o: AdminOperations }[]>(
    db,
    actor,
    sql`select st_admin_operations(${Math.min(Math.max(limit, 1), 200)}) as o`,
  );
  return r!.o;
}
