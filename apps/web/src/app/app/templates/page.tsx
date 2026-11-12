import Link from 'next/link';
import { Layers, Plus, Search } from 'lucide-react';
import { listTemplates, hasPermission, DOCUMENT_TYPES } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { AddCategory } from './template-client';

export const metadata = { title: 'Templates' };
const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const TABS = [
  ['all', 'All templates'],
  ['active', 'Active'],
  ['drafts', 'Drafts'],
  ['shared', 'Shared'],
  ['archived', 'Archived'],
] as const;
const STATUS = {
  active: ['Active', 'success'],
  draft: ['Draft', 'warning'],
  archived: ['Archived', 'neutral'],
} as const;

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { user, membership } = await requireWorkspace();
  if (!hasPermission(membership.permissions, 'templates.view'))
    return (
      <div>
        <PageHeader title="Templates" />
        <Alert tone="info">Your role does not include templates.</Alert>
      </div>
    );
  const res = await listTemplates(db(), { userId: user.id }, membership.workspace.id, {
    tab: one(sp.tab) as 'all',
    category: one(sp.category),
    q: one(sp.q),
  });
  const f = res.query;
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams(
      Object.entries({ tab: f.tab, category: f.category, q: f.q, ...patch }).filter(
        ([k, v]) => v && !(k === 'tab' && v === 'all'),
      ),
    ).toString();
    return `/app/templates${p ? `?${p}` : ''}`;
  };
  const typeLabel = (v: string) => DOCUMENT_TYPES.find((d) => d.value === v)?.label ?? v;
  const counts: Record<string, number> = res.metrics;

  return (
    <div>
      <PageHeader
        title="Templates"
        description="Save a document with its roles and fields once, then reuse it. Each use creates a new draft you review before sending."
        actions={
          res.canManage ? (
            <Link href="/app/templates/new" className={buttonClass('primary')}>
              <Plus className="size-4" aria-hidden /> Create Template
            </Link>
          ) : null
        }
      />
      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['Templates', res.metrics.all],
            ['Active', res.metrics.active],
            ['Drafts', res.metrics.drafts],
            ['Shared', res.metrics.shared],
          ] as const
        ).map(([l, n]) => (
          <div key={l} className="rounded-2xl border border-border bg-white p-4 shadow-card">
            <dt className="text-xs uppercase tracking-wide">{l}</dt>
            <dd className="mt-1 font-display text-2xl text-heading">{n}</dd>
          </div>
        ))}
      </dl>
      <nav aria-label="Template lists" className="mb-4">
        <ul className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map(([v, l]) => (
            <li key={v}>
              <Link
                href={href({ tab: v })}
                aria-current={f.tab === v ? 'page' : undefined}
                className={cn(
                  '-mb-px block border-b-2 px-3 py-2 text-sm',
                  f.tab === v
                    ? 'border-primary font-semibold text-primary-dark'
                    : 'border-transparent text-heading hover:border-border',
                )}
              >
                {l} ({counts[v] ?? 0})
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside aria-label="Categories" className="flex flex-col gap-1 text-sm">
          <Link
            href={href({ category: '' })}
            aria-current={!f.category ? 'true' : undefined}
            className={cn(
              'rounded-lg px-3 py-2',
              !f.category ? 'bg-primary-surface font-semibold text-primary-dark' : 'hover:bg-blush',
            )}
          >
            All categories
          </Link>
          {res.categories.map((c) => (
            <Link
              key={c}
              href={href({ category: c })}
              aria-current={f.category === c ? 'true' : undefined}
              className={cn(
                'rounded-lg px-3 py-2',
                f.category === c
                  ? 'bg-primary-surface font-semibold text-primary-dark'
                  : 'hover:bg-blush',
              )}
            >
              {c}
            </Link>
          ))}
          {res.canManage ? <AddCategory /> : null}
        </aside>
        <div>
          <form
            method="get"
            action="/app/templates"
            role="search"
            aria-label="Search templates"
            className="mb-4 flex gap-2"
          >
            {f.tab !== 'all' ? <input type="hidden" name="tab" value={f.tab} /> : null}
            {f.category ? <input type="hidden" name="category" value={f.category} /> : null}
            <label className="relative flex-1">
              <span className="sr-only">Search templates</span>
              <Search className="absolute left-3 top-3 size-4 text-slate-400" aria-hidden />
              <input
                type="search"
                name="q"
                defaultValue={f.q}
                placeholder="Search templates"
                className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm"
              />
            </label>
            <button type="submit" className={buttonClass('secondary', 'sm')}>
              Search
            </button>
          </form>
          {res.rows.length === 0 ? (
            <EmptyState
              icon={<Layers className="size-5" />}
              title={f.q || f.category ? 'No templates match' : 'No templates here yet'}
            >
              {res.canManage
                ? 'Create a template from any PDF you send often.'
                : 'Templates shared with you appear here.'}
            </EmptyState>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Templates">
              {res.rows.map((t) => {
                const [label, tone] = STATUS[t.status];
                return (
                  <li
                    key={t.id}
                    className="flex flex-col rounded-2xl border border-border bg-white p-4 shadow-card"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <Link
                        href={`/app/templates/${t.id}`}
                        className="font-semibold text-heading hover:underline"
                      >
                        {t.title}
                      </Link>
                      <Badge tone={tone}>{label}</Badge>
                    </div>
                    {t.description ? (
                      <p className="mb-2 line-clamp-2 text-sm">{t.description}</p>
                    ) : null}
                    <p className="text-xs">
                      {t.category} · {typeLabel(t.documentType)}
                    </p>
                    <p className="mt-1 text-xs">
                      {t.ownerName} · {t.shared ? 'Shared' : 'Only the owner'} · Updated{' '}
                      {fmt.format(t.updatedAt)}
                      {t.publishedVersion ? ` · v${t.publishedVersion}` : ''}
                      {t.hasDraft && t.publishedVersion ? ' · Unpublished changes' : ''}
                    </p>
                    <div className="mt-auto flex gap-2 pt-3">
                      <Link
                        href={`/app/templates/${t.id}`}
                        className={buttonClass('secondary', 'sm')}
                        aria-label={`Open ${t.title}`}
                      >
                        Open
                      </Link>
                      {t.status === 'active' ? (
                        <Link
                          href={`/app/templates/${t.id}/use`}
                          className={buttonClass('primary', 'sm')}
                          aria-label={`Use ${t.title}`}
                        >
                          Use
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
