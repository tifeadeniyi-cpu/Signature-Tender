import Link from 'next/link';
import {
  CheckCircle2,
  Clock,
  FileText,
  Hourglass,
  Layers,
  Plus,
  Search,
  Trash2,
  Download,
  TimerOff,
} from 'lucide-react';
import {
  searchLibrary,
  hasPermission,
  DOCUMENT_TYPES,
  LIBRARY_TABS,
  type LibraryTab,
  type LibraryQuery,
} from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink, buttonClass } from '@/components/ui/button';
import { StatCard } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { StatusBadge } from '@/components/documents/status-badge';
import { ArchiveButton } from '@/components/documents/library-buttons';
import { cn } from '@/lib/cn';
import type { DocumentStatus } from '@st/core';

export const metadata = { title: 'Documents' };

const TAB_LABELS: Record<LibraryTab, string> = {
  all: 'All',
  in_progress: 'In progress',
  completed: 'Completed',
  pending: 'Pending',
  expired: 'Expired',
  drafts: 'Drafts',
  declined: 'Declined',
  cancelled: 'Cancelled',
  archived: 'Archived',
};
const typeLabel = (v: string | null) =>
  DOCUMENT_TYPES.find((d) => d.value === v)?.label ?? 'Document';
const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const day = (d: Date | null) => (d ? fmt.format(d) : '—');

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { user, membership } = await requireWorkspace();
  const canCreate = hasPermission(membership.permissions, 'documents.create');
  const raw = Object.fromEntries(
    Object.entries(sp).map(([k, v]) => [k, one(v) ?? '']),
  ) as unknown as LibraryQuery;
  const lib = await searchLibrary(db(), { userId: user.id }, membership.workspace.id, raw);
  const f = lib.query;
  const filtered = Boolean(
    f.q || f.type || f.owner === 'me' || f.sentFrom || f.sentTo || f.completedFrom || f.completedTo,
  );

  // Builds a link that keeps the current filters and changes only the given keys.
  const href = (patch: Partial<Record<keyof typeof f, string | number>>) => {
    const next: Record<string, string> = {};
    const merged = { ...f, ...patch } as Record<string, unknown>;
    const defaults: Record<string, unknown> = {
      tab: 'all',
      sort: 'activity',
      dir: 'desc',
      page: 1,
      owner: 'all',
      q: '',
      type: '',
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === '' || v === defaults[k]) continue;
      next[k] = String(v);
    }
    const qs = new URLSearchParams(next).toString();
    return `/app/documents${qs ? `?${qs}` : ''}`;
  };

  const newButton = canCreate ? (
    <ButtonLink href="/app/documents/new">
      <Plus className="size-4" aria-hidden /> New document
    </ButtonLink>
  ) : null;
  const sortLink = (key: typeof f.sort, label: string) => {
    const active = f.sort === key;
    const dir = active && f.dir === 'desc' ? 'asc' : 'desc';
    return (
      <Link
        href={href({ sort: key, dir: key === 'title' && !active ? 'asc' : dir, page: 1 })}
        className="hover:underline"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active ? <span aria-hidden>{f.dir === 'asc' ? ' ↑' : ' ↓'}</span> : null}
      </Link>
    );
  };
  const ariaSort = (key: typeof f.sort) =>
    f.sort === key ? (f.dir === 'asc' ? 'ascending' : 'descending') : undefined;

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Find, track and download every document in this workspace."
        actions={newButton}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="All documents"
          value={lib.counts.all}
          icon={<Layers className="size-5" />}
        />
        <StatCard
          label="In progress"
          value={lib.counts.in_progress}
          icon={<Clock className="size-5" />}
        />
        <StatCard
          label="Completed"
          value={lib.counts.completed}
          icon={<CheckCircle2 className="size-5" />}
        />
        <StatCard
          label="Pending"
          value={lib.counts.pending}
          icon={<Hourglass className="size-5" />}
          hint="Waiting to be sent"
        />
        <StatCard
          label="Expired"
          value={lib.counts.expired}
          icon={<TimerOff className="size-5" />}
        />
      </div>

      <nav aria-label="Document status" className="mb-4 overflow-x-auto">
        <ul className="flex gap-1 border-b border-border">
          {LIBRARY_TABS.map((t) => (
            <li key={t} className="shrink-0">
              <Link
                href={href({ tab: t, page: 1 })}
                aria-current={f.tab === t ? 'page' : undefined}
                className={cn(
                  '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
                  f.tab === t
                    ? 'border-primary font-semibold text-primary-dark'
                    : 'border-transparent text-heading hover:border-border',
                )}
              >
                {TAB_LABELS[t]}
                <span className="rounded-full bg-primary-surface px-1.5 text-xs text-primary">
                  {lib.counts[t]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form
        method="get"
        action="/app/documents"
        role="search"
        aria-label="Search documents"
        className="mb-4 rounded-2xl border border-border bg-white p-4 shadow-card"
      >
        <input type="hidden" name="tab" value={f.tab} />
        <input type="hidden" name="sort" value={f.sort} />
        <input type="hidden" name="dir" value={f.dir} />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium text-heading">
            Search
            <span className="relative">
              <Search className="absolute left-3 top-3 size-4 text-slate-400" aria-hidden />
              <input
                type="search"
                name="q"
                defaultValue={f.q}
                placeholder="Title, signer name or email, or reference"
                className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm font-normal"
              />
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-heading">
            Type
            <select
              name="type"
              defaultValue={f.type}
              className="h-10 rounded-lg border border-border bg-white px-3 text-sm font-normal"
            >
              <option value="">All types</option>
              {DOCUMENT_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-heading">
            Owner
            <select
              name="owner"
              defaultValue={f.owner}
              className="h-10 rounded-lg border border-border bg-white px-3 text-sm font-normal"
            >
              <option value="all">Anyone</option>
              <option value="me">Me</option>
            </select>
          </label>
        </div>
        <details
          className="mt-3"
          open={Boolean(f.sentFrom || f.sentTo || f.completedFrom || f.completedTo)}
        >
          <summary className="cursor-pointer text-sm font-medium text-primary">
            Date filters
          </summary>
          <div className="mt-3 flex flex-wrap gap-3">
            {(
              [
                ['sentFrom', 'Sent from'],
                ['sentTo', 'Sent to'],
                ['completedFrom', 'Completed from'],
                ['completedTo', 'Completed to'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1.5 text-sm font-medium text-heading">
                {label}
                <input
                  type="date"
                  name={k}
                  defaultValue={f[k] ?? ''}
                  className="h-10 rounded-lg border border-border bg-white px-3 text-sm font-normal"
                />
              </label>
            ))}
          </div>
        </details>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="submit" className={buttonClass('primary', 'sm')}>
            Apply
          </button>
          {filtered ? (
            <Link
              href={href({
                q: '',
                type: '',
                owner: 'all',
                sentFrom: '',
                sentTo: '',
                completedFrom: '',
                completedTo: '',
                page: 1,
              })}
              className={buttonClass('ghost', 'sm')}
            >
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>

      {lib.rows.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title={
            filtered
              ? 'No documents match'
              : f.tab === 'all'
                ? 'No documents yet'
                : `Nothing in ${TAB_LABELS[f.tab]}`
          }
          action={!filtered && f.tab === 'all' ? newButton : null}
        >
          {filtered
            ? 'Try a different search or clear the filters.'
            : f.tab !== 'all'
              ? 'Documents move here as their status changes.'
              : canCreate
                ? 'Upload a PDF to start preparing your first signing request.'
                : 'Documents shared with you in this workspace will appear here.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-card">
          <table className="w-full min-w-[960px] text-left text-sm">
            <caption className="sr-only">
              {TAB_LABELS[f.tab]} documents, page {f.page} of {lib.pages}
            </caption>
            <thead className="border-b border-border bg-blush/40 text-xs uppercase tracking-wide text-heading">
              <tr>
                <th scope="col" className="px-4 py-3" aria-sort={ariaSort('title')}>
                  {sortLink('title', 'Name')}
                </th>
                <th scope="col" className="px-4 py-3">
                  Owner
                </th>
                <th scope="col" className="px-4 py-3">
                  Signers
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3" aria-sort={ariaSort('sent')}>
                  {sortLink('sent', 'Sent')}
                </th>
                <th scope="col" className="px-4 py-3" aria-sort={ariaSort('expires')}>
                  {sortLink('expires', 'Expires')}
                </th>
                <th scope="col" className="px-4 py-3" aria-sort={ariaSort('activity')}>
                  {sortLink('activity', 'Last activity')}
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lib.rows.map((d) => (
                <tr key={d.id} className="align-top hover:bg-blush/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/documents/${d.id}`}
                      className="font-semibold text-heading hover:underline"
                    >
                      {d.title}
                    </Link>
                    <p className="text-xs">{typeLabel(d.documentType)}</p>
                  </td>
                  <td className="px-4 py-3">
                    {d.createdBy === user.id ? 'You' : (d.ownerName ?? '—')}
                  </td>
                  <td className="max-w-48 truncate px-4 py-3" title={d.signers ?? ''}>
                    {d.signers ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      status={d.status as DocumentStatus}
                      requestStatus={d.requestStatus}
                      isTest={d.isTest}
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{day(d.sentAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {d.requestId && d.bucket === 'in_progress' ? day(d.expiresAt) : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{day(d.lastActivity)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-end gap-1">
                      <Link
                        href={`/app/documents/${d.id}`}
                        className={buttonClass('ghost', 'sm')}
                        aria-label={`View ${d.title}`}
                      >
                        View
                      </Link>
                      {d.canDownload && d.requestId ? (
                        <a
                          href={`/api/requests/${d.requestId}/file?kind=signed`}
                          className={buttonClass('ghost', 'sm')}
                          aria-label={`Download signed copy of ${d.title}`}
                        >
                          <Download className="size-4" aria-hidden /> Download
                        </a>
                      ) : null}
                      {d.bucket === 'archived' ||
                      ['completed', 'declined', 'expired', 'cancelled', 'drafts'].includes(
                        d.bucket,
                      ) ? (
                        <ArchiveButton
                          documentId={d.id}
                          archived={d.bucket === 'archived'}
                          title={d.title}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link
          href="/app/documents/deleted"
          className="inline-flex items-center gap-1.5 text-primary hover:underline"
        >
          <Trash2 className="size-4" aria-hidden /> Recently deleted drafts
        </Link>
        {lib.pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center gap-2">
            {f.page > 1 ? (
              <Link href={href({ page: f.page - 1 })} className={buttonClass('secondary', 'sm')}>
                Previous
              </Link>
            ) : null}
            <span>
              Page {f.page} of {lib.pages} · {lib.total} documents
            </span>
            {f.page < lib.pages ? (
              <Link href={href({ page: f.page + 1 })} className={buttonClass('secondary', 'sm')}>
                Next
              </Link>
            ) : null}
          </nav>
        ) : (
          <span>
            {lib.total} {lib.total === 1 ? 'document' : 'documents'}
          </span>
        )}
      </div>
    </div>
  );
}
