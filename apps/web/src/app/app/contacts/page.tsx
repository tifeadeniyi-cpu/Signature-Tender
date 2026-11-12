import Link from 'next/link';
import { Contact, Download, Search } from 'lucide-react';
import { listContacts, hasPermission, CONTACT_TYPES } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { AddContact, CONTACT_TYPE_LABELS, ImportContacts } from './contact-forms';

export const metadata = { title: 'Contacts' };
const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { user, membership } = await requireWorkspace();
  if (!hasPermission(membership.permissions, 'contacts.view'))
    return (
      <div>
        <PageHeader title="Contacts" />
        <Alert tone="info">Your role does not include contacts.</Alert>
      </div>
    );
  const canManage = hasPermission(membership.permissions, 'contacts.manage');
  const res = await listContacts(db(), { userId: user.id }, membership.workspace.id, {
    q: one(sp.q),
    type: one(sp.type),
    tag: one(sp.tag),
    view: one(sp.view) === 'archived' ? 'archived' : 'active',
    page: Number(one(sp.page) || 1),
  });
  const f = res.query;
  const href = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams(
      Object.entries({
        q: f.q,
        type: f.type,
        tag: f.tag,
        view: f.view,
        page: '',
        ...patch,
      } as Record<string, string | number>)
        .map(([k, v]) => [k, String(v)] as [string, string])
        .filter(
          ([k, v]) => v !== '' && !(k === 'page' && v === '1') && !(k === 'view' && v === 'active'),
        ),
    ).toString();
    return `/app/contacts${p ? `?${p}` : ''}`;
  };
  const filtered = Boolean(f.q || f.type || f.tag);

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Keep the people you send to in one place. Being a contact never gives anyone access to a document."
        actions={
          <>
            {canManage ? <ImportContacts /> : null}
            <a href="/api/contacts/export" className={buttonClass('secondary')}>
              <Download className="size-4" aria-hidden /> Export
            </a>
            {canManage ? <AddContact /> : null}
          </>
        }
      />
      <nav aria-label="Contact lists" className="mb-4">
        <ul className="flex gap-1 border-b border-border">
          {(
            [
              ['active', `Active (${res.counts.active})`],
              ['archived', `Archived (${res.counts.archived})`],
            ] as const
          ).map(([v, l]) => (
            <li key={v}>
              <Link
                href={href({ view: v, page: 1 })}
                aria-current={f.view === v ? 'page' : undefined}
                className={cn(
                  '-mb-px block border-b-2 px-3 py-2 text-sm',
                  f.view === v
                    ? 'border-primary font-semibold text-primary-dark'
                    : 'border-transparent text-heading hover:border-border',
                )}
              >
                {l}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <form
        method="get"
        action="/app/contacts"
        role="search"
        aria-label="Search contacts"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-white p-4 shadow-card"
      >
        {f.view === 'archived' ? <input type="hidden" name="view" value="archived" /> : null}
        <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium text-heading">
          Search
          <span className="relative">
            <Search className="absolute left-3 top-3 size-4 text-slate-400" aria-hidden />
            <input
              type="search"
              name="q"
              defaultValue={f.q}
              placeholder="Name, email or company"
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
            {CONTACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {CONTACT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-heading">
          Tag
          <select
            name="tag"
            defaultValue={f.tag}
            className="h-10 rounded-lg border border-border bg-white px-3 text-sm font-normal"
          >
            <option value="">All tags</option>
            {res.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass('primary', 'sm')}>
          Apply
        </button>
        {filtered ? (
          <Link
            href={href({ q: '', type: '', tag: '', page: 1 })}
            className={buttonClass('ghost', 'sm')}
          >
            Clear
          </Link>
        ) : null}
      </form>

      {res.rows.length === 0 ? (
        <EmptyState
          icon={<Contact className="size-5" />}
          title={filtered ? 'No contacts match' : 'No contacts yet'}
        >
          {filtered
            ? 'Try a different search.'
            : canManage
              ? 'Add contacts one at a time or import a CSV.'
              : 'Contacts shared in this workspace appear here.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-card">
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">Contacts</caption>
            <thead className="border-b border-border bg-blush/40 text-xs uppercase tracking-wide text-heading">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Name
                </th>
                <th scope="col" className="px-4 py-3">
                  Email
                </th>
                <th scope="col" className="px-4 py-3">
                  Phone
                </th>
                <th scope="col" className="px-4 py-3">
                  Company
                </th>
                <th scope="col" className="px-4 py-3">
                  Contact type
                </th>
                <th scope="col" className="px-4 py-3">
                  Last used
                </th>
                <th scope="col" className="px-4 py-3">
                  Tags
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {res.rows.map((c) => (
                <tr key={c.id} className="align-top hover:bg-blush/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/contacts/${c.id}`}
                      className="font-semibold text-heading hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.visibility === 'private' ? <p className="text-xs">Only you</p> : null}
                  </td>
                  <td className="px-4 py-3">{c.email}</td>
                  <td className="px-4 py-3">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3">{c.company ?? '—'}</td>
                  <td className="px-4 py-3">
                    {CONTACT_TYPE_LABELS[c.contactType] ?? c.contactType}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {c.lastUsedAt ? fmt.format(c.lastUsedAt) : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge key={t} tone="neutral">
                          {t}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/app/contacts/${c.id}`}
                      className={buttonClass('ghost', 'sm')}
                      aria-label={`Open ${c.name}`}
                    >
                      {canManage ? 'Edit' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res.pages > 1 ? (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-end gap-2 text-sm">
          {f.page > 1 ? (
            <Link href={href({ page: f.page - 1 })} className={buttonClass('secondary', 'sm')}>
              Previous
            </Link>
          ) : null}
          <span>
            Page {f.page} of {res.pages}
          </span>
          {f.page < res.pages ? (
            <Link href={href({ page: f.page + 1 })} className={buttonClass('secondary', 'sm')}>
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
