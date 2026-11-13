'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronsLeftRight,
  ChevronsRightLeft,
  Clock,
  Info,
  Layers,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Tag,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  BOARD_COLLAPSE_COOKIE,
  type BoardAction,
  type BoardCardDTO,
  type BoardColumnId,
  type BoardData,
} from '@/lib/board-types';
import { remindAction } from '@/app/app/documents/drawer-actions';
import { archiveAction } from '@/app/app/documents/library-actions';

interface ColumnDef {
  id: BoardColumnId;
  label: string;
  icon: LucideIcon;
  /** Header tint, column wash and icon colour. Washes stay pale so the board reads bright. */
  head: string;
  wash: string;
  iconCls: string;
  empty: string;
}

export const COLUMNS: ColumnDef[] = [
  {
    id: 'drafts',
    label: 'Drafts',
    icon: Pencil,
    head: 'bg-[#fbeed3]',
    wash: 'bg-[#fdf8ee]',
    iconCls: 'text-[#9a6412]',
    empty: 'No drafts yet.',
  },
  {
    id: 'sent',
    label: 'Sent',
    icon: Send,
    head: 'bg-[#e2ecfb]',
    wash: 'bg-[#f4f8fe]',
    iconCls: 'text-[#1d4ed8]',
    empty: 'No documents sent yet.',
  },
  {
    id: 'in_progress',
    label: 'In Progress',
    icon: Clock,
    head: 'bg-[#e7e5fb]',
    wash: 'bg-[#f6f5fe]',
    iconCls: 'text-[#4c3fc4]',
    empty: 'No documents currently in progress.',
  },
  {
    id: 'completed',
    label: 'Completed',
    icon: CheckCircle2,
    head: 'bg-[#daf2e2]',
    wash: 'bg-[#f2faf5]',
    iconCls: 'text-[#15803d]',
    empty: 'No completed agreements yet.',
  },
  {
    id: 'declined_expired',
    label: 'Declined / Expired',
    icon: XCircle,
    head: 'bg-[#fbe2e2]',
    wash: 'bg-[#fdf4f4]',
    iconCls: 'text-[#b91c1c]',
    empty: 'No declined or expired documents.',
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    icon: Ban,
    head: 'bg-[#eceef2]',
    wash: 'bg-[#f7f8fa]',
    iconCls: 'text-slate-600',
    empty: 'No cancelled requests.',
  },
];
const METRICS: [BoardColumnId | 'all', string, LucideIcon, string][] = [
  ['all', 'All documents', Layers, 'bg-[#fbeed3] text-[#9a6412]'],
  ['drafts', 'Drafts', Pencil, 'bg-[#fbeed3] text-[#9a6412]'],
  ['sent', 'Sent', Send, 'bg-[#e2ecfb] text-[#1d4ed8]'],
  ['in_progress', 'In progress', Clock, 'bg-[#e7e5fb] text-[#4c3fc4]'],
  ['completed', 'Completed', CheckCircle2, 'bg-[#daf2e2] text-[#15803d]'],
  ['declined_expired', 'Declined / Expired', XCircle, 'bg-[#fbe2e2] text-[#b91c1c]'],
];

const COLUMN_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label])) as Record<
  BoardColumnId,
  string
>;

const ACTION_LABEL: Record<BoardAction, string> = {
  details: 'View details',
  continue_editing: 'Continue editing',
  view_page: 'Open document page',
  send_reminder: 'Send reminder',
  view_activity: 'View activity',
  cancel_request: 'Cancel request…',
  view_completed: 'View completed document',
  download_package: 'Download complete package',
  download_signed: 'Download signed agreement only',
  view_certificate: 'View Certificate of Completion',
  view_audit: 'View audit trail',
  send_again: 'Edit and send again',
  archive: 'Archive',
};

/** What to try instead, when someone drags a card toward another status. */
const NEXT_STEP: Partial<Record<BoardColumnId, string>> = {
  drafts: 'To send a draft, open it and finish preparing it.',
  sent: 'Recipients move it forward when they open and sign it. You can send a reminder.',
  in_progress: 'It moves to Completed by itself once every signer has finished.',
  declined_expired: 'To try again, open it and choose Edit and send again.',
};

const docs = (n: number) => `${n} ${n === 1 ? 'document' : 'documents'}`;
const PAGE = 15;
const REFRESH_MS = 30_000;

type Columns = Record<BoardColumnId, BoardCardDTO[]>;
function group(cards: BoardCardDTO[]): Columns {
  const out = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as BoardCardDTO[]])) as Columns;
  for (const c of cards) out[c.column].push(c);
  return out;
}

function writeCollapsed(set: Set<BoardColumnId>) {
  const v = encodeURIComponent([...set].join(',') || 'none');
  document.cookie = `${BOARD_COLLAPSE_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * The documents Kanban board. Columns mirror each document's real signing status; nothing here
 * changes a status. Cards open the details drawer (via DocumentDrawerHost, which wraps this),
 * columns page with "Load more", and the board refreshes itself while the tab is visible.
 */
export function DocumentBoard({
  initial,
  queryString,
  collapsed: initialCollapsed,
  focus,
  canCreate,
  metricHrefs,
  toolbar,
}: {
  /** Search and filters, shown between the status cards and the columns. */
  toolbar?: ReactNode;
  /** Links for the status cards above the board: a column id (or "all") to its URL. */
  metricHrefs: Record<BoardColumnId | 'all', string>;
  initial: BoardData;
  /** The page's filters, already serialized, so board API calls match what the server rendered. */
  queryString: string;
  collapsed: BoardColumnId[];
  focus: BoardColumnId | null;
  canCreate: boolean;
}) {
  const [cols, setCols] = useState<Columns>(() => group(initial.cards));
  const [counts, setCounts] = useState(initial.counts);
  // New server data (filters changed): start from it. Not a remount, so the toolbar keeps focus.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setCols(group(initial.cards));
    setCounts(initial.counts);
  }
  const [collapsed, setCollapsed] = useState(() => new Set(initialCollapsed));
  const [loadingCol, setLoadingCol] = useState<BoardColumnId | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [busy, startBusy] = useTransition();
  const menuOpen = useRef(false);
  const dragFrom = useRef<BoardColumnId | null>(null);
  const colsRef = useRef(cols);
  useEffect(() => {
    colsRef.current = cols;
  }, [cols]);

  const visible = focus ? COLUMNS.filter((c) => c.id === focus) : COLUMNS;

  const toggle = (id: BoardColumnId, value?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const shut = value ?? !next.has(id);
      if (shut) next.add(id);
      else next.delete(id);
      writeCollapsed(next);
      return next;
    });
  const setAll = (shut: boolean) => {
    const next = new Set<BoardColumnId>(shut ? COLUMNS.map((c) => c.id) : []);
    writeCollapsed(next);
    setCollapsed(next);
  };

  /** Re-reads every column (keeping as many cards as are loaded) and announces moves. */
  const refresh = useCallback(async () => {
    const loaded = Math.max(PAGE, ...Object.values(colsRef.current).map((l) => l.length));
    const res = await fetch(
      `/api/documents/board?${queryString}${queryString ? '&' : ''}limit=${Math.min(loaded, 100)}`,
      { cache: 'no-store', headers: { Accept: 'application/json' } },
    ).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as BoardData;
    const before = new Map<string, BoardColumnId>();
    for (const [col, list] of Object.entries(colsRef.current))
      for (const c of list) before.set(c.id, col as BoardColumnId);
    const moved = data.cards.filter((c) => before.has(c.id) && before.get(c.id) !== c.column);
    setCols(group(data.cards));
    setCounts(data.counts);
    if (moved.length === 1)
      setAnnounce(`${moved[0]!.title} moved to ${COLUMN_LABEL[moved[0]!.column]}.`);
    else if (moved.length > 1) setAnnounce(`${moved.length} documents changed status.`);
  }, [queryString]);

  // Live updates: poll while the tab is visible, and catch up when the tab regains focus.
  // Skipped while a menu or the details drawer is open, so nothing shifts under the pointer.
  useEffect(() => {
    const quiet = () =>
      document.hidden || menuOpen.current || Boolean(document.querySelector('[aria-modal="true"]'));
    const tick = () => {
      if (!quiet()) void refresh();
    };
    const t = window.setInterval(tick, REFRESH_MS);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [refresh]);

  // The drawer can change a document (reminder, cancel); catch up when it closes.
  useEffect(() => {
    let open = false;
    const obs = new MutationObserver(() => {
      const now = Boolean(document.querySelector('[aria-modal="true"]'));
      if (open && !now) void refresh();
      open = now;
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [refresh]);

  const loadMore = async (col: BoardColumnId) => {
    setLoadingCol(col);
    const offset = cols[col].length;
    const res = await fetch(
      `/api/documents/board?${queryString}${queryString ? '&' : ''}column=${col}&offset=${offset}&limit=${PAGE}`,
      { cache: 'no-store', headers: { Accept: 'application/json' } },
    ).catch(() => null);
    setLoadingCol(null);
    if (!res?.ok) {
      setNotice({ text: 'We could not load more documents. Try again.', tone: 'error' });
      return;
    }
    const data = (await res.json()) as BoardData;
    setCols((prev) => {
      const seen = new Set(prev[col].map((c) => c.id));
      return { ...prev, [col]: [...prev[col], ...data.cards.filter((c) => !seen.has(c.id))] };
    });
    setCounts(data.counts);
  };

  const runAction = (card: BoardCardDTO, action: BoardAction) => {
    const openDrawer = () =>
      document
        .querySelector<HTMLElement>(`[data-board-card="${card.id}"] [data-drawer-open]`)
        ?.click();
    if (action === 'details' || action === 'cancel_request') return openDrawer();
    if (action === 'send_reminder' && card.requestId)
      return startBusy(async () => {
        const r = await remindAction(card.id, card.requestId!);
        setNotice({
          text: r?.message ?? (r?.ok ? 'Reminder sent.' : 'Something went wrong.'),
          tone: r?.ok ? 'info' : 'error',
        });
        await refresh();
      });
    if (action === 'archive')
      return startBusy(async () => {
        const r = await archiveAction(card.id, true, { ok: true });
        setNotice({
          text: r?.ok
            ? `${card.title} moved to Archived.`
            : (r?.message ?? 'Something went wrong.'),
          tone: r?.ok ? 'info' : 'error',
        });
        await refresh();
      });
  };

  const onDragStart = (e: DragEvent<HTMLElement>, card: BoardCardDTO) => {
    dragFrom.current = card.column;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.reference);
  };
  const onDrop = (e: DragEvent<HTMLElement>, to: BoardColumnId) => {
    e.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    if (!from || from === to) return;
    // Never a status change: the signing workflow is the only thing that moves a card.
    setNotice({
      text: `Document status updates automatically based on signing activity. ${NEXT_STEP[from] ?? ''}`.trim(),
      tone: 'info',
    });
  };

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const total = COLUMNS.reduce((n, c) => n + counts[c.id], 0);
  return (
    <div aria-busy={busy || undefined}>
      <nav aria-label="Filter by status" className="mb-5">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
          {METRICS.map(([id, label, Icon, tint]) => {
            const active = id === 'all' ? focus === null : focus === id;
            const n = id === 'all' ? total : counts[id];
            return (
              <li key={id}>
                <Link
                  href={metricHrefs[active && id !== 'all' ? 'all' : id]}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex h-full items-center gap-3 rounded-2xl border bg-white p-3.5 shadow-card transition-colors hover:border-gold/70',
                    active ? 'border-gold ring-2 ring-gold/30' : 'border-border',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-full',
                      tint,
                    )}
                    aria-hidden
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight text-heading">
                      {label}
                    </span>
                    <span className="block font-display text-2xl leading-tight text-heading">
                      {n}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {toolbar}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {/* Phones and narrow tablets: jump to a column instead of squeezing five in. */}
        <nav
          aria-label="Jump to a status"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 lg:hidden"
        >
          {visible.map((c) => (
            <a
              key={c.id}
              href={`#board-col-${c.id}`}
              onClick={(e) => {
                e.preventDefault();
                toggle(c.id, false);
                document
                  .getElementById(`board-col-${c.id}`)
                  ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-heading"
            >
              <c.icon className={cn('size-3.5', c.iconCls)} aria-hidden />
              {c.label}
              <span className="text-slate-text">{counts[c.id]}</span>
            </a>
          ))}
        </nav>
        {focus ? null : (
          <div className="ml-auto hidden gap-1 sm:flex">
            <button
              type="button"
              onClick={() => setAll(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-heading hover:bg-white"
            >
              <ChevronsLeftRight className="size-4" aria-hidden /> Expand all
            </button>
            <button
              type="button"
              onClick={() => setAll(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-heading hover:bg-white"
            >
              <ChevronsRightLeft className="size-4" aria-hidden /> Collapse all
            </button>
          </div>
        )}
      </div>

      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'mb-3 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
            notice.tone === 'error'
              ? 'border-error/30 bg-error-bg text-error'
              : 'border-[#c9d6ee] bg-[#eef3fc] text-heading',
          )}
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{notice.text}</span>
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <div
        role="region"
        aria-label="Documents board"
        className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0 lg:snap-none"
      >
        {visible.map((col) =>
          collapsed.has(col.id) && !focus ? (
            <CollapsedColumn
              key={col.id}
              col={col}
              count={counts[col.id]}
              onExpand={() => toggle(col.id, false)}
            />
          ) : (
            <section
              key={col.id}
              id={`board-col-${col.id}`}
              aria-labelledby={`board-col-${col.id}-title`}
              onDragOver={(e) => {
                if (dragFrom.current) e.preventDefault();
              }}
              onDrop={(e) => onDrop(e, col.id)}
              className={cn(
                'relative flex w-[85vw] max-w-[320px] shrink-0 snap-start flex-col rounded-2xl border border-border/70 sm:w-[300px] lg:w-auto lg:min-w-[260px] lg:flex-1',
                focus && 'max-w-none sm:w-full',
                col.wash,
              )}
            >
              <header
                className={cn(
                  'flex items-center gap-2 rounded-t-2xl border-b border-border/60 px-3.5 py-3',
                  col.head,
                )}
              >
                <col.icon className={cn('size-5 shrink-0', col.iconCls)} aria-hidden />
                <h2
                  id={`board-col-${col.id}-title`}
                  aria-label={`${col.label}, ${docs(counts[col.id])}`}
                  className="flex-1 truncate font-sans text-base font-semibold text-heading"
                >
                  {col.label}
                </h2>
                <span
                  aria-hidden
                  className="min-w-7 rounded-full bg-white/80 px-2 py-0.5 text-center text-xs font-bold text-heading"
                >
                  {counts[col.id]}
                </span>
                {focus ? null : (
                  <button
                    type="button"
                    onClick={() => toggle(col.id, true)}
                    aria-label={`Collapse ${col.label}`}
                    title="Collapse column"
                    className="hidden rounded-md p-1 text-heading/70 hover:bg-white/70 hover:text-heading sm:block"
                  >
                    <ChevronsRightLeft className="size-4" aria-hidden />
                  </button>
                )}
              </header>

              {col.id === 'drafts' && canCreate ? (
                <Link
                  href="/app/documents/new"
                  className="mx-3 mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#e2c58f] bg-white/60 py-2 text-sm font-semibold text-heading hover:bg-white"
                >
                  <Plus className="size-4" aria-hidden /> Add document
                </Link>
              ) : null}

              <div className="flex flex-col gap-2.5 p-3 lg:max-h-[calc(100vh-17rem)] lg:min-h-40 lg:overflow-y-auto">
                {cols[col.id].length === 0 ? (
                  <EmptyColumn col={col} canCreate={canCreate} />
                ) : (
                  <ul className="flex flex-col gap-2.5" aria-label={`${col.label} documents`}>
                    {cols[col.id].map((card) => (
                      <li key={card.id}>
                        <Card
                          card={card}
                          onAction={runAction}
                          onDragStart={onDragStart}
                          onMenu={(o) => (menuOpen.current = o)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {counts[col.id] > cols[col.id].length ? (
                  <button
                    type="button"
                    onClick={() => loadMore(col.id)}
                    disabled={loadingCol === col.id}
                    className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-[#1d4ed8] hover:bg-white/70 disabled:opacity-60"
                  >
                    {loadingCol === col.id ? (
                      <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                    ) : null}
                    Load more
                    <span className="font-normal">
                      ({counts[col.id] - cols[col.id].length} more)
                    </span>
                  </button>
                ) : null}
              </div>
            </section>
          ),
        )}
      </div>
    </div>
  );
}

function CollapsedColumn({
  col,
  count,
  onExpand,
}: {
  col: ColumnDef;
  count: number;
  onExpand: () => void;
}) {
  return (
    <section id={`board-col-${col.id}`} className="shrink-0" aria-label={`${col.label}, collapsed`}>
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Expand ${col.label}, ${docs(count)}`}
        className={cn(
          'flex h-full min-h-64 w-12 flex-col items-center gap-3 rounded-2xl border border-border/70 py-3 hover:brightness-[0.98]',
          col.head,
        )}
      >
        <col.icon className={cn('size-5', col.iconCls)} aria-hidden />
        <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-xs font-bold text-heading">
          {count}
        </span>
        <span className="text-sm font-semibold text-heading [writing-mode:vertical-rl]" aria-hidden>
          {col.label}
        </span>
      </button>
    </section>
  );
}

function EmptyColumn({ col, canCreate }: { col: ColumnDef; canCreate: boolean }) {
  const cta =
    canCreate && col.id === 'drafts'
      ? 'Create document'
      : canCreate && col.id === 'sent'
        ? 'Send document'
        : null;
  return (
    <div className="rounded-xl border border-dashed border-border bg-white/50 px-3 py-6 text-center text-sm">
      <p>{col.empty}</p>
      {cta ? (
        <Link
          href="/app/documents/new"
          className="mt-2 inline-block font-semibold text-heading underline underline-offset-2"
        >
          {cta}
        </Link>
      ) : null}
    </div>
  );
}

const TONE: Record<BoardCardDTO['statusTone'], string> = {
  neutral: 'bg-primary-surface text-primary',
  info: 'bg-info-bg text-info',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  error: 'bg-error-bg text-error',
};

function Card({
  card,
  onAction,
  onDragStart,
  onMenu,
}: {
  card: BoardCardDTO;
  onAction: (card: BoardCardDTO, a: BoardAction) => void;
  onDragStart: (e: DragEvent<HTMLElement>, card: BoardCardDTO) => void;
  onMenu: (open: boolean) => void;
}) {
  const pct = card.requiredCount ? Math.round((card.requiredDone / card.requiredCount) * 100) : 0;
  const shown = card.people.slice(0, 3);
  const extra = card.people.length - shown.length;
  const showStatus =
    card.column === 'completed' ||
    card.column === 'declined_expired' ||
    card.column === 'cancelled' ||
    (card.column === 'drafts' && card.statusLabel !== 'Draft');

  return (
    <article
      data-doc-id={card.id}
      data-board-card={card.id}
      draggable
      onDragStart={(e) => onDragStart(e, card)}
      className="group relative cursor-pointer rounded-xl border border-border bg-white p-3.5 shadow-[0_1px_2px_rgba(13,27,51,0.06)] transition-[border-color,box-shadow] hover:border-[#d8af68]/70 hover:shadow-[0_4px_14px_rgba(13,27,51,0.08)] focus-within:border-[#d8af68]"
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-0.5 flex h-7 w-6 shrink-0 items-end justify-center rounded-[4px] border border-[#f1c9c9] bg-[#fdf1f1] pb-0.5 text-[8px] font-bold tracking-wide text-[#c42b2b]"
        >
          PDF
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={card.urls.page}
            data-drawer-open={card.id}
            aria-haspopup="dialog"
            className="line-clamp-2 break-words text-sm font-semibold leading-snug text-heading hover:underline"
          >
            {card.title}
            <span className="sr-only">
              , {card.statusLabel}
              {card.column === 'in_progress' && card.requiredCount
                ? `, ${card.requiredDone} of ${card.requiredCount} signed`
                : ''}
            </span>
          </Link>
          <p className="mt-1 flex items-center gap-1 text-xs">
            <Tag className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{card.typeLabel}</span>
            <span aria-hidden>·</span>
            <span className="font-mono text-[11px]">{card.reference}</span>
          </p>
        </div>
        <CardMenu card={card} onAction={onAction} onOpenChange={onMenu} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
        {showStatus ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold',
              TONE[card.statusTone],
            )}
          >
            {card.column === 'completed' ? <CheckCircle2 className="size-3.5" aria-hidden /> : null}
            {card.statusLabel}
          </span>
        ) : null}
        {card.isTest ? (
          <span className="rounded-md bg-warning-bg px-1.5 py-0.5 font-semibold text-warning">
            Test
          </span>
        ) : null}
        {card.column === 'in_progress' && card.requiredCount ? (
          <span className="rounded-md bg-[#e7e5fb] px-1.5 py-0.5 font-semibold text-[#3b2fa8]">
            {card.requiredDone} of {card.requiredCount} signed
          </span>
        ) : null}
        <time dateTime={card.dateIso} className="text-slate-text">
          {card.column === 'declined_expired' || card.column === 'cancelled'
            ? card.dateLabel.replace(/^(\S+) /, 'on ')
            : card.dateLabel}
        </time>
      </div>

      {card.column === 'in_progress' && card.requiredCount ? (
        <div className="mt-2">
          <div
            role="progressbar"
            aria-label="Required signers completed"
            aria-valuemin={0}
            aria-valuemax={card.requiredCount}
            aria-valuenow={card.requiredDone}
            aria-valuetext={`${card.requiredDone} of ${card.requiredCount} required signers completed (${pct}%)`}
            className="h-1.5 overflow-hidden rounded-full bg-[#e7e5fb]"
          >
            <div className="h-full rounded-full bg-[#5b4fd6]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {card.people.length ? (
            <ul className="flex -space-x-1.5" aria-label={`${card.recipientCount} recipients`}>
              {shown.map((p, i) => (
                <li
                  key={i}
                  title={`${p.name} · ${p.state}`}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold',
                    p.state === 'Signed' || p.state === 'Approved'
                      ? 'bg-[#d6efdd] text-[#14532d]'
                      : p.state === 'Declined'
                        ? 'bg-[#fbdcdc] text-[#7f1d1d]'
                        : i % 2
                          ? 'bg-[#f3deb4] text-[#5c3d0c]'
                          : 'bg-[#dfe5ef] text-heading',
                  )}
                >
                  <span aria-hidden>{p.initials}</span>
                  <span className="sr-only">
                    {p.name}, {p.state}
                  </span>
                </li>
              ))}
              {extra > 0 ? (
                <li className="flex size-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[10px] font-bold text-heading">
                  +{extra}
                </li>
              ) : null}
            </ul>
          ) : (
            <span className="text-xs">No recipients yet</span>
          )}
        </div>
        {card.dueLabel ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 text-xs',
              card.dueSoon ? 'font-semibold text-warning' : 'text-slate-text',
            )}
          >
            <CalendarClock className="size-3.5" aria-hidden />
            {card.dueLabel}
          </span>
        ) : (
          <span className="shrink-0 text-xs">{card.ownerLabel}</span>
        )}
      </div>
    </article>
  );
}

const LINK_FOR: Partial<Record<BoardAction, (c: BoardCardDTO) => string | null>> = {
  continue_editing: (c) => c.urls.edit,
  view_page: (c) => c.urls.page,
  view_activity: (c) => c.urls.activity,
  view_completed: (c) => c.urls.page,
  view_audit: (c) => c.urls.activity,
  send_again: (c) => c.urls.edit,
  download_package: (c) => c.urls.packageDownload,
  download_signed: (c) => c.urls.signedDownload,
  view_certificate: (c) => c.urls.certificateView,
};

/** The three-dot menu. Rendered in a portal with fixed positioning so columns never clip it. */
function CardMenu({
  card,
  onAction,
  onOpenChange,
}: {
  card: BoardCardDTO;
  onAction: (card: BoardCardDTO, a: BoardAction) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = `menu-${card.id}`;

  const close = useCallback(
    (focusButton = true) => {
      setOpen(false);
      setPos(null);
      onOpenChange(false);
      if (focusButton) btn.current?.focus();
    },
    [onOpenChange],
  );

  const place = useCallback(() => {
    if (!btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = 248;
    const h = menu.current?.offsetHeight ?? 280;
    const below = r.bottom + 6 + h < window.innerHeight;
    setPos({
      top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h),
      left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)),
    });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);
  // Focus the first item once the menu is in place, without scrolling (a scroll closes it).
  const focused = useRef(false);
  useEffect(() => {
    if (!open) focused.current = false;
    else if (pos && !focused.current) {
      focused.current = true;
      menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    }
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    // Follow the button if the page or a column scrolls, rather than closing under the pointer.
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) place();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close, place]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Tab') close(false);
  };

  const itemCls =
    'flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-heading hover:bg-primary-surface focus:bg-primary-surface focus:outline-none';

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${card.title}`}
        onClick={() => {
          setOpen((o) => !o);
          onOpenChange(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
            onOpenChange(true);
          }
        }}
        className="-mr-1 -mt-1 rounded-md p-1 text-slate-text hover:bg-primary-surface hover:text-heading"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              id={menuId}
              role="menu"
              aria-label={`Actions for ${card.title}`}
              onKeyDown={onKey}
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
              className="fixed z-50 w-62 rounded-xl border border-border bg-white p-1.5 shadow-[0_12px_32px_rgba(13,27,51,0.16)]"
            >
              {card.actions.map((a) => {
                const href = LINK_FOR[a]?.(card);
                if (href) {
                  const download = a.startsWith('download_');
                  const newTab = a === 'view_certificate';
                  return (
                    <a
                      key={a}
                      role="menuitem"
                      tabIndex={-1}
                      href={href}
                      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
                      onClick={() => close(!download && !newTab ? false : true)}
                      className={itemCls}
                    >
                      {ACTION_LABEL[a]}
                    </a>
                  );
                }
                return (
                  <button
                    key={a}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => {
                      close(false);
                      onAction(card, a);
                    }}
                    className={cn(itemCls, a === 'cancel_request' && 'text-error')}
                  >
                    {ACTION_LABEL[a]}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
