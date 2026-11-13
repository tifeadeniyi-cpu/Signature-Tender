import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActor, type Database, type ActorContext } from '@st/db';
import { AppError } from './errors';
import { LIBRARY_FROM, libraryQuery, libraryWhere, type LibraryQuery } from './library';

/**
 * The documents Kanban board. Columns are a display grouping of the canonical signing-request
 * status (no second status field exists, and nothing here writes a status). Each document is in
 * exactly one column, based on its latest request; archived documents are left out, like the
 * list's "All" tab.
 */
export const BOARD_COLUMNS = [
  'drafts',
  'sent',
  'in_progress',
  'completed',
  'declined_expired',
  'cancelled',
] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/**
 * Drafts: not yet in recipients' hands (no request, or waiting for payment or dispatch).
 * Sent: dispatched, no recipient has opened it. In progress: someone has viewed or signed it.
 * Declined and expired share a column but keep their own status; cancelled has its own.
 */
export const BOARD_COLUMN_SQL = sql`case
  when lr.status is null then 'drafts'
  when lr.status in ('awaiting_payment','payment_processing','ready_to_dispatch','queued') then 'drafts'
  when lr.status = 'sent' then 'sent'
  when lr.status in ('in_progress','awaiting_approval','finalization_failed') then 'in_progress'
  when lr.status = 'completed' then 'completed'
  when lr.status in ('declined','expired') then 'declined_expired'
  else 'cancelled' end`;

export const BOARD_PAGE_SIZE = 15;
const MAX_LIMIT = 100;

export interface BoardRecipient {
  name: string;
  email: string;
  role: string;
  status: string | null;
}

export interface BoardCard {
  id: string;
  title: string;
  documentType: string;
  documentStatus: string;
  column: BoardColumn;
  requestId: string | null;
  requestStatus: string | null;
  isTest: boolean;
  createdBy: string;
  ownerName: string | null;
  createdAt: Date;
  lastActivity: Date;
  sentAt: Date | null;
  completedAt: Date | null;
  closedAt: Date | null;
  expiresAt: Date | null;
  recipients: BoardRecipient[];
  recipientCount: number;
  /** Signers, approvers and reviewers: everyone whose action the request needs. */
  requiredCount: number;
  requiredDone: number;
  canEdit: boolean;
  canDownload: boolean;
  hasCertificate: boolean;
  /** Someone has been emailed a link and has not acted yet. */
  awaitingSomeone: boolean;
}

const boardOptions = z.object({
  column: z.enum(BOARD_COLUMNS).optional().catch(undefined),
  offset: z.coerce.number().int().min(0).max(100_000).catch(0),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).catch(BOARD_PAGE_SIZE),
});
export type BoardOptions = Partial<z.input<typeof boardOptions>>;

/**
 * Loads the board: filtered totals for every column, plus up to `limit` cards per column
 * (or one page of a single column, for "Load more"). Sorting applies within each column.
 */
export async function loadBoard(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: LibraryQuery,
  opts: BoardOptions = {},
) {
  if (!z.string().uuid().safeParse(workspaceId).success)
    throw new AppError('not_found', 'Workspace not found');
  const f = libraryQuery.parse(raw);
  const o = boardOptions.parse(opts);
  return withActor(db, actor, async (tx) => {
    const where = sql`${libraryWhere(f, actor, workspaceId)} and d.archived_at is null`;
    const countRows = (await tx.execute(sql`
      select ${BOARD_COLUMN_SQL} as col, count(*)::int as n ${LIBRARY_FROM} where ${where} group by 1
    `)) as unknown as { col: BoardColumn; n: number }[];
    const counts = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, 0])) as Record<
      BoardColumn,
      number
    >;
    for (const r of countRows) counts[r.col] = r.n;

    const dir = f.dir === 'asc' ? sql`asc` : sql`desc`;
    const activity = sql`greatest(d.updated_at, coalesce(lr.updated_at, d.updated_at))`;
    const order = {
      activity: sql`${activity} ${dir}`,
      title: sql`lower(d.title) ${dir}`,
      sent: sql`lr.sent_at ${dir} nulls last`,
      expires: sql`lr.expires_at ${dir} nulls last`,
      created: sql`d.created_at ${dir}`,
      completed: sql`lr.completed_at ${dir} nulls last`,
    }[f.sort];
    // d.id last, so equal timestamps keep a stable order between loads.
    const ordering = sql`${order}, d.id`;
    const colFilter = o.column ? sql`and ${BOARD_COLUMN_SQL} = ${o.column}` : sql``;
    const pageCond = o.column
      ? sql`rn > ${o.offset} and rn <= ${o.offset + o.limit}`
      : sql`rn <= ${o.limit}`;

    const rows = (await tx.execute(sql`
      select * from (
        select d.id, d.title, d.document_type, d.status as document_status, d.created_by,
          d.created_at, ${activity} as last_activity,
          (select u.name from "user" u where u.id = d.created_by) as owner_name,
          lr.id as request_id, lr.status::text as request_status, coalesce(lr.is_test, false) as is_test,
          lr.sent_at, lr.completed_at, lr.closed_at, lr.expires_at,
          (lr.status = 'completed' and lr.signed_file_id is not null and d.purged_at is null)
            as can_download,
          (lr.status = 'completed' and lr.certificate_file_id is not null and d.purged_at is null)
            as has_certificate,
          st_can_edit_document(d.id) as can_edit,
          ${BOARD_COLUMN_SQL} as col,
          row_number() over (partition by ${BOARD_COLUMN_SQL} order by ${ordering}) as rn
        ${LIBRARY_FROM}
        where ${where} ${colFilter}
      ) b where ${pageCond}
      order by col, rn
    `)) as unknown as Record<string, unknown>[];

    // Recipients: the request's own list once sent (it is frozen), else the draft's list.
    const reqIds = rows.map((r) => r.request_id as string | null).filter((x): x is string => !!x);
    const people = new Map<string, BoardRecipient[]>();
    if (reqIds.length) {
      const rr = (await tx.execute(sql`
        select sr.document_id, r.name, r.email, r.role::text as role, r.status::text as status
        from request_recipients r join signing_requests sr on sr.id = r.request_id
        where r.request_id in (${sql.join(
          reqIds.map((x) => sql`${x}::uuid`),
          sql`, `,
        )})
        order by r.signing_order, r.created_at
      `)) as unknown as Record<string, string>[];
      for (const r of rr) {
        const list = people.get(r.document_id!) ?? [];
        list.push({ name: r.name!, email: r.email!, role: r.role!, status: r.status ?? null });
        people.set(r.document_id!, list);
      }
    }
    const drafts = rows.filter((r) => !r.request_id).map((r) => r.id as string);
    if (drafts.length) {
      const dr = (await tx.execute(sql`
        select r.document_id, r.name, r.email, r.role::text as role
        from document_recipients r
        where r.document_id in (${sql.join(
          drafts.map((x) => sql`${x}::uuid`),
          sql`, `,
        )})
        order by r.signing_order, r.created_at
      `)) as unknown as Record<string, string>[];
      for (const r of dr) {
        const list = people.get(r.document_id!) ?? [];
        list.push({ name: r.name!, email: r.email!, role: r.role!, status: null });
        people.set(r.document_id!, list);
      }
    }

    const date = (v: unknown) => (v ? new Date(v as string) : null);
    const cards = rows.map((r): BoardCard => {
      const list = people.get(r.id as string) ?? [];
      const required = list.filter((p) => p.role !== 'cc' && p.role !== 'viewer');
      return {
        id: r.id as string,
        title: r.title as string,
        documentType: r.document_type as string,
        documentStatus: r.document_status as string,
        column: r.col as BoardColumn,
        requestId: (r.request_id as string | null) ?? null,
        requestStatus: (r.request_status as string | null) ?? null,
        isTest: Boolean(r.is_test),
        createdBy: r.created_by as string,
        ownerName: (r.owner_name as string | null) ?? null,
        createdAt: date(r.created_at)!,
        lastActivity: date(r.last_activity)!,
        sentAt: date(r.sent_at),
        completedAt: date(r.completed_at),
        closedAt: date(r.closed_at),
        expiresAt: date(r.expires_at),
        recipients: list,
        recipientCount: list.length,
        requiredCount: required.length,
        requiredDone: required.filter((p) => p.status === 'signed').length,
        canEdit: Boolean(r.can_edit),
        canDownload: Boolean(r.can_download),
        hasCertificate: Boolean(r.has_certificate),
        awaitingSomeone: list.some((p) => p.status === 'notified' || p.status === 'viewed'),
      };
    });
    return {
      query: f,
      counts,
      total: BOARD_COLUMNS.reduce((s, c) => s + counts[c], 0),
      cards,
      column: o.column ?? null,
      offset: o.offset,
      limit: o.limit,
    };
  });
}

/** Recipient emails for the board's "Specific recipient" filter: the most recent 50 the actor can see. */
export async function listBoardRecipients(db: Database, actor: ActorContext, workspaceId: string) {
  if (!z.string().uuid().safeParse(workspaceId).success) return [];
  return withActor(db, actor, async (tx) => {
    const rows = (await tx.execute(sql`
      select lower(r.email) as email, max(r.created_at) as last
      from document_recipients r join documents d on d.id = r.document_id
      where d.workspace_id = ${workspaceId}::uuid and d.deleted_at is null
      group by 1 order by 2 desc limit 50
    `)) as unknown as { email: string }[];
    return rows.map((r) => r.email);
  });
}
