'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, List, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/cn';

import { DOCS_VIEW_COOKIE, type DocsView } from '@/lib/board-types';

/** Values that are the default, so they stay out of the address bar. */
const DEFAULTS: Record<string, string> = {
  tab: 'all',
  sort: 'activity',
  dir: 'desc',
  owner: 'all',
  range: 'any',
  recipient: 'all',
  page: '1',
};

function useQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    next.delete('selected');
    next.delete('page');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || DEFAULTS[k] === v) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    start(() => router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false }));
  };
  return { sp, set, pending };
}

function rememberView(v: DocsView) {
  document.cookie = `${DOCS_VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
}

/** Kanban / List. The choice is remembered in a cookie; filters stay in the address bar. */
export function ViewSwitch({ view }: { view: DocsView }) {
  const { set, pending } = useQuery();
  const choose = (v: DocsView) => {
    rememberView(v);
    set({ view: v, tab: null, status: null });
  };
  const item = (v: DocsView, label: string, Icon: typeof List) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => view !== v && choose(v)}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 px-3.5 text-sm font-semibold',
        view === v ? 'bg-soft-gold text-heading' : 'bg-white text-heading hover:bg-blush',
      )}
    >
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  );
  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Documents view"
        className="inline-flex divide-x divide-border overflow-hidden rounded-lg border border-border"
      >
        {item('kanban', 'Kanban', LayoutGrid)}
        {item('list', 'List', List)}
      </div>
      {pending ? (
        <Loader2 className="size-4 text-slate-text motion-safe:animate-spin" aria-label="Loading" />
      ) : null}
    </div>
  );
}

/** Debounced search, shared by both views. */
export function DocumentSearch({ initial }: { initial: string }) {
  const { sp, set, pending } = useQuery();
  const [value, setValue] = useState(initial);
  const first = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const urlQ = sp.get('q') ?? '';
  // "Clear" elsewhere empties the address bar; follow it unless the person is typing here.
  useEffect(() => {
    if (document.activeElement !== input.current && urlQ !== value.trim()) {
      first.current = true;
      setValue(urlQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => set({ q: value.trim() || null }), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div role="search" className="relative w-full sm:w-96">
      <Search
        className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Search documents, recipients, or reference"
        placeholder="Search documents, recipients, or reference..."
        className="h-11 w-full rounded-xl border border-border bg-white pl-9 pr-9 text-sm shadow-card"
      />
      {pending ? (
        <Loader2
          className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 motion-safe:animate-spin"
          aria-hidden
        />
      ) : null}
    </div>
  );
}

const SELECT =
  'h-9 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-heading';

/** Board filters: recipient, date range, and a Filters panel for type, owner, custom dates and sort. */
export function BoardFilters({
  types,
  recipients,
}: {
  types: { value: string; label: string }[];
  recipients: string[];
}) {
  const { sp, set } = useQuery();
  const [open, setOpen] = useState(false);
  const recipient = sp.get('recipient') ?? 'all';
  const rcpt = sp.get('rcpt') ?? '';
  const range = sp.get('range') ?? 'any';
  const sortKey = `${sp.get('sort') ?? 'activity'}:${sp.get('dir') ?? 'desc'}`;
  const extra = [
    sp.get('type'),
    sp.get('owner') === 'me' ? 'me' : null,
    sortKey !== 'activity:desc' ? 1 : null,
  ].filter(Boolean).length;
  const any =
    extra > 0 ||
    recipient !== 'all' ||
    range !== 'any' ||
    Boolean(sp.get('q')) ||
    Boolean(sp.get('status'));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="board-recipient">
        Recipients
      </label>
      <select
        id="board-recipient"
        className={cn(SELECT, 'max-w-52')}
        value={recipient === 'email' ? `email:${rcpt}` : recipient}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith('email:')) set({ recipient: 'email', rcpt: v.slice(6) });
          else set({ recipient: v, rcpt: null });
        }}
      >
        <option value="all">All recipients</option>
        <option value="me">Assigned to me</option>
        <option value="sent">Sent by me</option>
        {recipients.length ? (
          <optgroup label="Specific recipient">
            {recipients.map((r) => (
              <option key={r} value={`email:${r}`}>
                {r}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <label className="sr-only" htmlFor="board-range">
        Date range
      </label>
      <select
        id="board-range"
        className={SELECT}
        value={range}
        onChange={(e) =>
          set({
            range: e.target.value,
            ...(e.target.value !== 'custom' ? { from: null, to: null } : {}),
          })
        }
      >
        <option value="any">Any time</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="year">This year</option>
        <option value="custom">Custom range</option>
      </select>
      {range === 'custom' ? (
        <span className="flex items-center gap-1.5 text-sm">
          <label className="sr-only" htmlFor="board-from">
            From
          </label>
          <input
            id="board-from"
            type="date"
            defaultValue={sp.get('from') ?? ''}
            onChange={(e) => set({ from: e.target.value || null })}
            className="h-9 rounded-lg border border-border bg-white px-2 text-sm"
          />
          <span aria-hidden>–</span>
          <label className="sr-only" htmlFor="board-to">
            To
          </label>
          <input
            id="board-to"
            type="date"
            defaultValue={sp.get('to') ?? ''}
            onChange={(e) => set({ to: e.target.value || null })}
            className="h-9 rounded-lg border border-border bg-white px-2 text-sm"
          />
        </span>
      ) : null}
      <div className="relative">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="board-filters"
          onClick={() => setOpen((o) => !o)}
          className={cn(SELECT, 'inline-flex items-center gap-1.5')}
        >
          <SlidersHorizontal className="size-4" aria-hidden /> Filters
          {extra ? (
            <span className="rounded-full bg-gold px-1.5 text-xs text-heading">{extra}</span>
          ) : null}
        </button>
        {open ? (
          <div
            id="board-filters"
            className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-border bg-white p-4 shadow-[0_12px_32px_rgba(13,27,51,0.16)]"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          >
            <div className="flex flex-col gap-3 text-sm font-medium text-heading">
              <label className="flex flex-col gap-1.5">
                Sort cards by
                <select
                  className="h-9 rounded-lg border border-border bg-white px-2 font-normal"
                  value={sortKey}
                  onChange={(e) => {
                    const [sort, dir] = e.target.value.split(':');
                    set({ sort: sort!, dir: dir! });
                  }}
                >
                  <option value="activity:desc">Most recently updated</option>
                  <option value="activity:asc">Oldest updated</option>
                  <option value="created:desc">Date created</option>
                  <option value="sent:desc">Date sent</option>
                  <option value="completed:desc">Date completed</option>
                  <option value="title:asc">Document name</option>
                  <option value="expires:asc">Due date</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                Document type
                <select
                  className="h-9 rounded-lg border border-border bg-white px-2 font-normal"
                  value={sp.get('type') ?? ''}
                  onChange={(e) => set({ type: e.target.value || null })}
                >
                  <option value="">All types</option>
                  {types.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                Owner
                <select
                  className="h-9 rounded-lg border border-border bg-white px-2 font-normal"
                  value={sp.get('owner') ?? 'all'}
                  onChange={(e) => set({ owner: e.target.value })}
                >
                  <option value="all">Anyone</option>
                  <option value="me">Me</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-1 h-9 rounded-lg bg-primary text-sm font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {any ? (
        <button
          type="button"
          onClick={() =>
            set({
              q: null,
              type: null,
              owner: null,
              recipient: null,
              rcpt: null,
              range: null,
              from: null,
              to: null,
              sort: null,
              dir: null,
              status: null,
            })
          }
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-semibold text-heading hover:bg-white"
        >
          <X className="size-4" aria-hidden /> Clear
        </button>
      ) : null}
    </div>
  );
}
