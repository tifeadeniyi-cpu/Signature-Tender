import { listAdminWorkspaces } from '@st/core';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { buttonClass } from '@/components/ui/button';
import { Badge } from '@/components/ui/feedback';

export const metadata = { title: 'Workspaces' };

const fmt = (d: Date | string | null) =>
  d
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(d))
    : '—';

export default async function AdminWorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireStaff();
  const q = (await searchParams).q ?? '';
  const rows = await listAdminWorkspaces(db(), { userId: user.id }, q, 100);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">Workspaces</h1>
      <form
        method="get"
        role="search"
        aria-label="Find a workspace"
        className="flex flex-wrap items-end gap-2"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium text-heading">
            Name or workspace id
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            className="h-10 w-72 rounded-lg border border-border bg-white px-3 text-sm"
          />
        </div>
        <button type="submit" className={buttonClass('primary', 'md')}>
          Search
        </button>
      </form>
      <div
        className="overflow-x-auto rounded-2xl border border-border bg-white"
        tabIndex={0}
        role="region"
        aria-label="Workspaces"
      >
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border bg-blush/40 text-xs uppercase text-heading">
            <tr>
              {[
                'Workspace',
                'Created',
                'Members',
                'Plan',
                'Live requests',
                'Tests',
                'Last request',
                'Credits',
                'Payment issues',
              ].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((w) => (
              <tr key={w.id}>
                <td className="px-3 py-2">
                  <p className="font-semibold text-heading">{w.name}</p>
                  <p className="font-mono text-[11px]">{w.id}</p>
                </td>
                <td className="px-3 py-2">{fmt(w.created_at)}</td>
                <td className="px-3 py-2 tabular-nums">{w.members}</td>
                <td className="px-3 py-2">
                  {w.plan_code}
                  {w.subscription_status ? (
                    <span className="text-xs"> ({w.subscription_status})</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 tabular-nums">{w.live_requests}</td>
                <td className="px-3 py-2 tabular-nums">{w.test_requests}</td>
                <td className="px-3 py-2">{fmt(w.last_request_at)}</td>
                <td className="px-3 py-2 tabular-nums">{w.credits_available}</td>
                <td className="px-3 py-2">
                  {w.failed_payments ? <Badge tone="warning">{w.failed_payments}</Badge> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length ? null : <p className="p-4 text-sm">No workspaces match.</p>}
      </div>
    </div>
  );
}
