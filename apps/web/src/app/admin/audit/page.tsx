import Link from 'next/link';
import { X } from 'lucide-react';
import { AUDIT_CATEGORIES, listAdminAudit, type AdminAuditRow } from '@st/core';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';

export const metadata = { title: 'Audit Trail' };

const CATEGORY_LABEL: Record<string, string> = {
  admin_access: 'Administrative access',
  authentication: 'Authentication',
  security: 'Security',
  configuration: 'Business configuration',
  operations: 'Operations',
  payments: 'Payments',
  platform: 'Platform',
};
const RISK_TONE = { low: 'neutral', medium: 'warning', high: 'error' } as const;

const fmt = (d: Date | string) =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(d)) + ' UTC';

type Search = {
  from?: string;
  to?: string;
  category?: string;
  q?: string;
  page?: string;
  event?: string;
};

function href(sp: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, String(v));
  const s = p.toString();
  return `/admin/audit${s ? `?${s}` : ''}`;
}

function Drawer({ row, closeHref }: { row: AdminAuditRow; closeHref: string }) {
  const fields: [string, string][] = [
    ['Event ID', row.id],
    ['Sequence', String(row.seq)],
    ['Time', fmt(row.occurred_at)],
    ['Actor', row.actor],
    ['Actor role', row.actor_role],
    ['Category', CATEGORY_LABEL[row.category] ?? row.category],
    ['Action', row.action],
    ['Resource type', row.target_type ?? '—'],
    ['Resource reference', row.target_ref ?? '—'],
    ['Outcome', row.outcome],
    ['Risk', row.risk],
  ];
  const details = Object.entries(row.details ?? {});
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Audit event">
      <Link href={closeHref} className="absolute inset-0 bg-heading/40" aria-label="Close" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl">Audit event</h2>
          <Link
            href={closeHref}
            className="rounded-lg p-1 hover:bg-blush"
            aria-label="Close event details"
          >
            <X className="size-5" aria-hidden />
          </Link>
        </div>
        <dl className="mt-4 flex flex-col gap-2 text-sm">
          {fields.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[9rem_1fr] gap-2 border-b border-border/60 pb-2">
              <dt className="text-slate-text">{k}</dt>
              <dd className="break-all font-medium text-heading">{v}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-6 text-sm font-semibold text-heading">Recorded details</h3>
        {details.length ? (
          <pre className="mt-2 overflow-x-auto rounded-lg bg-ivory p-3 text-xs">
            {JSON.stringify(row.details, null, 2)}
          </pre>
        ) : (
          <p className="mt-1 text-sm">
            None shown. Customer event details are withheld here, and secrets are always redacted.
          </p>
        )}
        <p className="mt-6 text-xs">
          The audit log is append-only: nobody, including staff and the database owner, can edit or
          delete an event.
        </p>
      </aside>
    </div>
  );
}

export default async function AuditTrailPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { user } = await requireAdmin('audit.view', 'audit_log');
  const page = Math.max(1, Number(sp.page) || 1);
  const res = await listAdminAudit(
    db(),
    { userId: user.id },
    {
      from: sp.from || null,
      to: sp.to ? new Date(new Date(sp.to).getTime() + 86_400_000) : null,
      category: (sp.category as never) || null,
      q: sp.q ?? '',
      page,
    },
  );
  let selected = sp.event ? res.rows.find((r) => r.id === sp.event) : undefined;
  if (sp.event && !selected) {
    const one = await listAdminAudit(db(), { userId: user.id }, { q: sp.event }, 1);
    selected = one.rows.find((r) => r.id === sp.event);
  }
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl">Audit Trail</h1>
        <p className="mt-1 text-sm">
          Platform-level events: staff access, configuration changes and security events. Customer
          workspace activity stays with that workspace; customers appear here only as an opaque
          reference.
        </p>
      </div>
      <form method="get" aria-label="Filter events" className="flex flex-wrap items-end gap-3">
        {(
          [
            ['from', 'From', 'date'],
            ['to', 'To', 'date'],
          ] as const
        ).map(([name, label, type]) => (
          <div key={name} className="flex flex-col gap-1">
            <label htmlFor={`audit-${name}`} className="text-sm font-medium text-heading">
              {label}
            </label>
            <input
              id={`audit-${name}`}
              name={name}
              type={type}
              defaultValue={sp[name] ?? ''}
              className="h-10 rounded-lg border border-border bg-white px-3 text-sm"
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-category" className="text-sm font-medium text-heading">
            Category
          </label>
          <select
            id="audit-category"
            name="category"
            defaultValue={sp.category ?? ''}
            className="h-10 rounded-lg border border-border bg-white px-3 text-sm"
          >
            <option value="">All categories</option>
            {AUDIT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-q" className="text-sm font-medium text-heading">
            Action, event ID or resource
          </label>
          <input
            id="audit-q"
            name="q"
            defaultValue={sp.q ?? ''}
            className="h-10 w-64 rounded-lg border border-border bg-white px-3 text-sm"
          />
        </div>
        <button type="submit" className={buttonClass('primary')}>
          Filter
        </button>
        <Link href="/admin/audit" className={buttonClass('ghost')}>
          Clear
        </Link>
      </form>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <caption className="sr-only">Audit events, newest first</caption>
          <thead className="bg-ivory text-xs uppercase tracking-wide text-slate-text">
            <tr>
              {[
                'Time',
                'Actor',
                'Role',
                'Category',
                'Action',
                'Resource',
                'Outcome',
                'Risk',
                '',
              ].map((h, i) => (
                <th key={i} scope="col" className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.rows.map((r) => (
              <tr key={r.id} className="border-t border-border/60">
                <td className="whitespace-nowrap px-3 py-2">{fmt(r.occurred_at)}</td>
                <td className="px-3 py-2">{r.actor}</td>
                <td className="px-3 py-2">{r.actor_role}</td>
                <td className="px-3 py-2">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                <td className="px-3 py-2">
                  <code className="font-mono text-xs">{r.action}</code>
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.target_type ? `${r.target_type}: ${r.target_ref ?? '—'}` : '—'}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={r.outcome === 'success' ? 'success' : 'error'}>{r.outcome}</Badge>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={RISK_TONE[r.risk]}>{r.risk}</Badge>
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={href(sp, { event: r.id })}
                    className="text-sm font-semibold text-primary hover:underline"
                    scroll={false}
                  >
                    View<span className="sr-only"> event {r.id}</span>
                  </Link>
                </td>
              </tr>
            ))}
            {res.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center">
                  No events match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <nav aria-label="Pages" className="flex items-center justify-between text-sm">
        <span>
          {res.total.toLocaleString('en-US')} event{res.total === 1 ? '' : 's'} · page {page} of{' '}
          {pages}
        </span>
        <span className="flex gap-2">
          {page > 1 ? (
            <Link
              href={href(sp, { page: String(page - 1), event: undefined })}
              className={buttonClass('secondary', 'sm')}
            >
              Newer
            </Link>
          ) : null}
          {page < pages ? (
            <Link
              href={href(sp, { page: String(page + 1), event: undefined })}
              className={buttonClass('secondary', 'sm')}
            >
              Older
            </Link>
          ) : null}
        </span>
      </nav>
      {selected ? <Drawer row={selected} closeHref={href(sp, { event: undefined })} /> : null}
    </div>
  );
}
