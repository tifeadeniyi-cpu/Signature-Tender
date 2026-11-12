'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { FileText, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import type { DocumentSummary } from '@/lib/document-summary-types';
import { remindAction } from '@/app/app/documents/drawer-actions';
import { cancelRequestAction } from '@/app/app/documents/actions';
import { DrawerSkeleton, Skeleton, StatusPill } from './drawer-ui';
import {
  ActivityPanel,
  EvidencePanel,
  FilesPanel,
  OverviewPanel,
  SignersPanel,
  type ActionHandlers,
  type DrawerTab,
} from './drawer-panels';

const TABS: [DrawerTab, string][] = [
  ['overview', 'Overview'],
  ['signers', 'Signers'],
  ['activity', 'Activity'],
  ['files', 'Files'],
  ['evidence', 'Evidence'],
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string; code: number }
  | { state: 'ready'; data: DocumentSummary };

/** Keeps `?selected=<id>` in the address bar so the drawer survives a refresh and can be linked. */
function syncUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('selected', id);
  else url.searchParams.delete('selected');
  window.history.replaceState(window.history.state, '', url);
}

/**
 * Wraps the documents table. Clicking a row, a document name or its View link opens the
 * details drawer; opening another document swaps the content instead of stacking drawers.
 * Links keep their real href, so Ctrl/Cmd-click and middle-click still open the full page.
 */
export function DocumentDrawerHost({
  initialId,
  children,
}: {
  initialId: string | null;
  children: ReactNode;
}) {
  const [id, setId] = useState<string | null>(initialId && UUID.test(initialId) ? initialId : null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const open = useCallback((docId: string, from: HTMLElement | null) => {
    returnFocus.current = from;
    setId(docId);
    syncUrl(docId);
  }, []);
  const close = useCallback(() => {
    setId(null);
    syncUrl(null);
    const el = returnFocus.current;
    returnFocus.current = null;
    // Back to whatever opened it, once the dialog has gone.
    requestAnimationFrame(() => el?.focus());
  }, []);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const target = e.target as HTMLElement;
    const trigger = target.closest<HTMLElement>('[data-drawer-open]');
    if (trigger) {
      // Capture phase, so this runs before next/link's own navigation handler.
      e.preventDefault();
      e.stopPropagation();
      open(trigger.dataset.drawerOpen!, trigger);
      return;
    }
    // Row clicks, but never when the click was on another control in the row.
    if (target.closest('a, button, input, select, textarea, label, form')) return;
    const row = target.closest<HTMLElement>('[data-doc-id]');
    if (row) {
      const focusable = row.querySelector<HTMLElement>('[data-drawer-open]');
      open(row.dataset.docId!, focusable ?? row);
    }
  };

  return (
    <>
      {/* The row click is a mouse shortcut; the document name link is the keyboard path. */}
      <div onClickCapture={onClick}>{children}</div>
      {id ? <DocumentDrawer key="drawer" id={id} onClose={close} /> : null}
    </>
  );
}

function DocumentDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [tab, setTab] = useState<DrawerTab>('overview');
  const [person, setPerson] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [message, setMessage] = useState<ActionHandlers['message']>(null);
  const [reminding, startRemind] = useTransition();
  const [cancelling, startCancel] = useTransition();
  const [nonce, setNonce] = useState(0);
  const [shownId, setShownId] = useState(id);

  // A different document resets the view to its overview.
  if (shownId !== id) {
    setShownId(id);
    setTab('overview');
    setPerson(null);
    setMessage(null);
    setLoad({ state: 'loading' });
  }

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/documents/${id}/summary`, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          (DocumentSummary & { error?: string }) | null;
        if (!res.ok || !body || body.error)
          setLoad({
            state: 'error',
            code: res.status,
            message:
              res.status === 404
                ? 'This document is not available. It may have been deleted, or you may not have access to it.'
                : res.status === 401
                  ? 'Your session has ended. Sign in again to see this document.'
                  : (body?.error ?? 'We could not load this document.'),
          });
        else setLoad({ state: 'ready', data: body });
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setLoad({
          state: 'error',
          code: 0,
          message: 'We could not reach Signature Tender. Check your connection and try again.',
        });
      });
    return () => ctrl.abort();
  }, [id, nonce]);

  // Slide in after mount; lock page scroll; focus the close button.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prev;
    };
  }, []);

  // Escape and the focus trap listen on the document, so they still work when focus has
  // fallen to the page body (for example after a button disables itself while it works).
  const closeRefFn = useRef(onClose);
  useEffect(() => {
    closeRefFn.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRefFn.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]![0]);
    tabRefs.current[next]?.focus();
  };

  const reload = () => {
    setLoad({ state: 'loading' });
    setNonce((n) => n + 1);
  };
  const data = load.state === 'ready' ? load.data : null;
  const handlers: ActionHandlers = {
    reminding,
    cancelling,
    message,
    remind: () =>
      startRemind(async () => {
        if (!data?.requestId) return;
        const r = await remindAction(data.id, data.requestId);
        setMessage({ ok: Boolean(r?.ok), text: r?.message ?? 'Something went wrong.' });
        if (r?.ok) setNonce((n) => n + 1);
      }),
    cancel: (reason) =>
      startCancel(async () => {
        if (!data?.requestId) return;
        const fd = new FormData();
        fd.set('reason', reason);
        const r = await cancelRequestAction(data.id, data.requestId, null, fd);
        setMessage({ ok: Boolean(r?.ok), text: r?.message ?? 'Something went wrong.' });
        if (r?.ok) {
          setNonce((n) => n + 1);
          router.refresh();
        }
      }),
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className={cn(
          'absolute inset-0 bg-heading/30 transition-opacity duration-200 motion-reduce:transition-none',
          shown ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full flex-col bg-ivory shadow-[0_0_48px_rgba(39,15,23,0.22)] transition-transform duration-300 ease-out motion-reduce:transition-none sm:w-[440px] sm:rounded-l-3xl lg:w-[480px]',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="border-b border-border bg-white px-5 pb-0 pt-4 sm:rounded-tl-3xl">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-blush text-primary"
              aria-hidden
            >
              <FileText className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              {data ? (
                <>
                  <h2
                    id={titleId}
                    className="truncate font-display text-xl leading-tight text-heading"
                  >
                    {data.title}
                  </h2>
                  <p className="font-mono text-xs text-slate-text">#{data.reference}</p>
                  <span className="mt-1.5 inline-flex sm:hidden">
                    <StatusPill status={data.status} label={data.statusLabel} />
                  </span>
                </>
              ) : (
                <>
                  <h2 id={titleId} className="sr-only">
                    Document details
                  </h2>
                  {load.state === 'loading' ? (
                    <div aria-hidden className="flex flex-col gap-2 pt-1">
                      <Skeleton className="h-5 w-44" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  ) : (
                    <p className="pt-1 font-display text-xl text-heading" aria-hidden>
                      Document details
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {data ? (
                <span className="hidden sm:inline-flex">
                  <StatusPill status={data.status} label={data.statusLabel} />
                </span>
              ) : null}
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="flex size-10 items-center justify-center rounded-full text-heading hover:bg-blush focus-visible:outline-2 focus-visible:outline-primary"
                aria-label="Close document details"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
          </div>
          <div
            role="tablist"
            aria-label="Document details"
            className="-mx-5 mt-3 flex gap-0.5 overflow-x-auto px-3 sm:gap-1 sm:px-4 [scrollbar-width:none]"
          >
            {TABS.map(([t, label], i) => (
              <button
                key={t}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`drawer-tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`drawer-panel-${t}`}
                tabIndex={tab === t ? 0 : -1}
                disabled={!data}
                onClick={() => {
                  setTab(t);
                  if (t !== 'activity') setPerson(null);
                }}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cn(
                  '-mb-px min-h-11 shrink-0 border-b-2 px-2 text-sm sm:px-3 transition-colors disabled:opacity-60',
                  tab === t
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent text-heading hover:border-rose-gold hover:text-primary',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <div
          className="flex-1 overflow-y-auto overscroll-contain"
          aria-busy={load.state === 'loading'}
        >
          {load.state === 'loading' ? (
            <>
              <p className="sr-only" role="status">
                Loading document details
              </p>
              <DrawerSkeleton />
            </>
          ) : load.state === 'error' ? (
            <div className="flex flex-col gap-4 p-5">
              <Alert tone="error">{load.message}</Alert>
              <Button type="button" variant="secondary" onClick={reload} className="self-start">
                <RotateCw className="size-4" aria-hidden /> Try again
              </Button>
            </div>
          ) : (
            <div
              role="tabpanel"
              id={`drawer-panel-${tab}`}
              aria-labelledby={`drawer-tab-${tab}`}
              tabIndex={0}
              className="p-5 focus-visible:outline-none"
            >
              {tab === 'overview' ? (
                <OverviewPanel d={load.data} h={handlers} go={setTab} />
              ) : tab === 'signers' ? (
                <SignersPanel
                  d={load.data}
                  h={handlers}
                  onActivity={(name) => {
                    setPerson(name);
                    setTab('activity');
                  }}
                />
              ) : tab === 'activity' ? (
                <ActivityPanel d={load.data} person={person} clearPerson={() => setPerson(null)} />
              ) : tab === 'files' ? (
                <FilesPanel d={load.data} />
              ) : (
                <EvidencePanel d={load.data} go={setTab} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
