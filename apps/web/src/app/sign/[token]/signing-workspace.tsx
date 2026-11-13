'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CloudOff,
  Download,
  FileText,
  Loader2,
  Maximize,
  Minimize,
  Minus,
  PanelLeft,
  PenLine,
  Plus,
  Rows3,
  Square,
  Wrench,
  X,
} from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { roleLabel, type SignatureDisplayFormat } from '@st/core/signature-block/layout';
import { cn } from '@/lib/cn';
import { adoptAction, completeAction, saveProgressAction } from './actions';
import { DeclineForm } from './stages';
import { SignHeader } from './sign-header';
import { usePdf, PdfPageView } from './workspace/pdf';
import {
  FieldLayer,
  FieldControls,
  fieldName,
  fieldProblem,
  type BlockSettings,
  type Field,
  type OtherField,
} from './workspace/fields';
import { SignatureStudio, type Adopted, type Font, type Mark } from './workspace/studio';
import { FinishDialog, HelpPanel, RetryDialog } from './workspace/dialogs';

type Data = {
  requestId: string;
  documentId: string;
  documentVersion: string;
  sentAt: Date | string;
  pageCount: number;
  allowDownload: boolean;
  signatureBlock: { format: SignatureDisplayFormat; timeZone: string };
  role: string;
  name: string;
  email: string;
  resumePage: number;
  fields: Field[];
  completedByOthers: OtherField[];
  signatures: { id: string; kind: string; method: string; dataUrl: string }[];
};

/** pdf.js convention: 100% shows a PDF point as 96/72 CSS pixels. */
const CSS_UNITS = 96 / 72;
const ZOOMS = [50, 75, 100, 125, 150, 200];
type Zoom = { mode: 'width' | 'page' } | { mode: 'custom'; pct: number };
type SaveState = 'saved' | 'saving' | 'error' | 'idle';

const dateFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

const ACTION_COPY: Record<string, { title: string; body: string }> = {
  signature: {
    title: 'Add Your Signature',
    body: 'Select the signature field to create or add your signature.',
  },
  initials: { title: 'Add Initials', body: 'Select the initials field to add your initials.' },
  name: { title: 'Confirm Your Name', body: 'Check your full name in the highlighted field.' },
  email: { title: 'Confirm Your Email', body: 'Check your email in the highlighted field.' },
  text: { title: 'Complete Text Field', body: 'Type the requested information.' },
  number: { title: 'Enter a Number', body: 'Type the requested number.' },
  checkbox: { title: 'Select Checkbox', body: 'Read the statement and check the box.' },
  dropdown: { title: 'Choose an Option', body: 'Pick one of the listed options.' },
  radio: { title: 'Choose an Option', body: 'Pick one of the listed options.' },
};

export function SigningWorkspace({
  token,
  title,
  senderName,
  isTest,
  authMethod,
  today,
  data,
  fonts,
}: {
  token: string;
  title: string;
  senderName: string;
  isTest: boolean;
  authMethod: string;
  /** Today's date from the server, shown in date-signed fields until the server sets it. */
  today: string;
  data: Data;
  fonts: Font[];
}) {
  const router = useRouter();
  const { pdf, sizes, error: pdfError, retry: retryPdf } = usePdf(`/api/sign/${token}/file`);
  const block: BlockSettings = useMemo(
    () => ({ ...data.signatureBlock, name: data.name, role: roleLabel(data.role) }),
    [data.signatureBlock, data.name, data.role],
  );
  const sigById = useMemo(
    () => new Map(data.signatures.map((s) => [s.id, { id: s.id, dataUrl: s.dataUrl }])),
    [data.signatures],
  );

  // ---------------------------------------------------------------------------------------------
  // Field state (restored from saved progress)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      data.fields.map((f) => [
        f.id,
        f.savedValue ??
          (f.type === 'name'
            ? data.name
            : f.type === 'email'
              ? data.email
              : f.type === 'checkbox'
                ? 'false'
                : ''),
      ]),
    ),
  );
  const [applied, setApplied] = useState<Record<string, Mark>>(() => {
    const out: Record<string, Mark> = {};
    for (const f of data.fields) {
      const m = f.savedSignatureId ? sigById.get(f.savedSignatureId) : undefined;
      if (m) out[f.id] = m;
    }
    return out;
  });
  const [marks, setMarks] = useState<{ signature?: Mark; initials?: Mark }>(() => {
    const pick = (k: string) => {
      const s = data.signatures.find((x) => x.kind === k);
      return s ? { id: s.id, dataUrl: s.dataUrl } : undefined;
    };
    return { signature: pick('signature'), initials: pick('initials') };
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  const sequence = useMemo(
    () => data.fields.filter((f) => f.type !== 'date_signed'),
    [data.fields],
  );
  const required = useMemo(() => sequence.filter((f) => f.required), [sequence]);
  const isDone = useCallback(
    (f: Field) => {
      if (f.type === 'date_signed') return true;
      if (f.type === 'signature' || f.type === 'initials') return Boolean(applied[f.id]);
      const v = values[f.id] ?? '';
      if (f.type === 'checkbox') return f.required ? v === 'true' : true;
      return Boolean(v.trim()) && !fieldProblem(f, v);
    },
    [applied, values],
  );
  const doneCount = required.filter(isDone).length;
  const remaining = required.filter((f) => !isDone(f));
  const allDone = remaining.length === 0;
  const pct = required.length ? Math.round((doneCount / required.length) * 100) : 100;
  const active = data.fields.find((f) => f.id === activeId) ?? null;

  // ---------------------------------------------------------------------------------------------
  // Viewer state
  const scroller = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScroller = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
    setScrollEl(el);
  }, []);
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>({ mode: 'width' });
  const [single, setSingle] = useState(false);
  const [page, setPage] = useState(Math.min(data.resumePage, Math.max(1, data.pageCount)));
  const [fullscreen, setFullscreen] = useState(false);
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const numPages = pdf?.numPages ?? data.pageCount;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setBox({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxW = sizes.length ? Math.max(...sizes.map((s) => s.width)) : 612;
  const cur = sizes[page - 1] ?? { width: 612, height: 792 };
  const fitWidth = box.w ? Math.max(0.2, (box.w - 32) / maxW) : 1;
  const fitPage = box.h ? Math.min(fitWidth, Math.max(0.2, (box.h - 32) / cur.height)) : fitWidth;
  const scale =
    zoom.mode === 'custom'
      ? (zoom.pct / 100) * CSS_UNITS
      : zoom.mode === 'page'
        ? fitPage
        : fitWidth;
  const zoomPct = Math.round((scale / CSS_UNITS) * 100);
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const pageEl = (n: number) =>
    scroller.current?.querySelector<HTMLElement>(`[data-pdf-page="${n}"]`) ?? null;

  const goToPage = useCallback(
    (n: number) => {
      const target = Math.min(Math.max(1, n), numPages || 1);
      setPage(target);
      if (!single)
        pageEl(target)?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    },
    [numPages, single, reduced],
  );

  // Restore the saved page once the document has laid out.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !pdf || !box.w) return;
    restored.current = true;
    if (page > 1) requestAnimationFrame(() => pageEl(page)?.scrollIntoView({ block: 'start' }));
  }, [pdf, box.w, page]);

  // Track the page in view while scrolling.
  useEffect(() => {
    const el = scroller.current;
    if (!el || single) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // The page taking up the most of the viewer is the current one.
        const r = el.getBoundingClientRect();
        let best = 1;
        let most = -1;
        el.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach((p) => {
          const b = p.getBoundingClientRect();
          const seen = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
          if (seen > most) {
            most = seen;
            best = Number(p.dataset.pdfPage);
          }
        });
        setPage(best);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [single, pdf]);

  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.().catch(() => {});
  }

  function zoomStep(dir: 1 | -1) {
    const next =
      dir > 0
        ? (ZOOMS.find((z) => z > zoomPct + 1) ?? 200)
        : ([...ZOOMS].reverse().find((z) => z < zoomPct - 1) ?? 50);
    setZoom({ mode: 'custom', pct: next });
  }

  // ---------------------------------------------------------------------------------------------
  // Field navigation
  const isDesktop = () =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

  const goToField = useCallback(
    (f: Field, opts: { openSheet?: boolean } = {}) => {
      setActiveId(f.id);
      setStudioError(null);
      setPage(f.page);
      if (opts.openSheet !== false && !isDesktop()) setSheetOpen(true);
      // The field may not exist yet (document still loading, or a page not yet rendered), so
      // retry briefly until it does.
      const reveal = (tries: number) => {
        const el = document.getElementById(`field-${f.id}`);
        if (!el) {
          if (tries === 0) pageEl(f.page)?.scrollIntoView({ block: 'start' });
          if (tries < 40) setTimeout(() => reveal(tries + 1), 100);
          return;
        }
        // On phones the tools sheet covers the lower part of the viewer, so keep the field high.
        el.scrollIntoView({
          block: isDesktop() ? 'center' : 'start',
          behavior: reduced ? 'auto' : 'smooth',
        });
        // Re-query: the field may have re-rendered while scrolling.
        setTimeout(
          () => document.getElementById(`field-${f.id}`)?.focus({ preventScroll: true }),
          reduced ? 0 : 350,
        );
      };
      setTimeout(() => reveal(0), 0);
    },
    [reduced],
  );

  const nextRequired = useCallback(
    (fromId: string | null, pool = remaining) => {
      if (!pool.length) return null;
      const idx = fromId ? sequence.findIndex((f) => f.id === fromId) : -1;
      const after = sequence.slice(idx + 1).find((f) => pool.some((p) => p.id === f.id));
      return after ?? pool[0]!;
    },
    [remaining, sequence],
  );

  function goNext() {
    const n = nextRequired(activeId);
    if (n) goToField(n);
  }
  function goPrev() {
    if (!sequence.length) return;
    const idx = activeId ? sequence.findIndex((f) => f.id === activeId) : sequence.length;
    const prev = sequence[Math.max(0, idx - 1)]!;
    goToField(prev);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------------------------------------
  // Saving: text-like values autosave (debounced); marks are saved as they are applied.
  const dirty = useRef(new Map<string, number>());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [exitState, setExitState] = useState<'idle' | 'saving' | 'error' | 'done'>('idle');
  const [exitError, setExitError] = useState<string | null>(null);
  const valuesRef = useRef(values);
  const pageRef = useRef(page);
  useEffect(() => {
    valuesRef.current = values;
    pageRef.current = page;
  }, [values, page]);

  const flush = useCallback(
    async (exit = false): Promise<{ ok: true } | { ok: false; message: string }> => {
      const snapshot = new Map(dirty.current);
      if (!snapshot.size && !exit) return { ok: true };
      setSaveState('saving');
      const r = await saveProgressAction(token, {
        values: [...snapshot.keys()].map((id) => ({
          fieldId: id,
          value: valuesRef.current[id] ?? '',
        })),
        page: pageRef.current,
        exit,
      }).catch(() => ({ ok: false as const, message: 'Connection problem.', ended: false }));
      if (!r.ok) {
        setSaveState('error');
        if ('ended' in r && r.ended) setSessionEnded(true);
        return { ok: false, message: r.message };
      }
      for (const [id, ver] of snapshot) if (dirty.current.get(id) === ver) dirty.current.delete(id);
      setSaveState(dirty.current.size ? 'idle' : 'saved');
      setSavedAt(new Date(r.savedAt));
      return { ok: true };
    },
    [token],
  );

  useEffect(() => {
    if (saveState !== 'idle' || !dirty.current.size) return;
    const t = setTimeout(() => void flush(), 1200);
    return () => clearTimeout(t);
  }, [values, saveState, flush]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (exitState === 'done') return;
      if (dirty.current.size || saveState === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState, exitState]);

  function change(f: Field, v: string) {
    setValues((s) => ({ ...s, [f.id]: v }));
    dirty.current.set(f.id, (dirty.current.get(f.id) ?? 0) + 1);
    setSaveState((s) => (s === 'saving' ? s : 'idle'));
    if (autoAdvance && f.type === 'checkbox' && v === 'true') {
      const n = nextRequired(
        f.id,
        remaining.filter((x) => x.id !== f.id),
      );
      if (n) setTimeout(() => goToField(n), 150);
    }
  }

  async function saveAndExit() {
    setExitState('saving');
    setExitError(null);
    const r = await flush(true);
    if (r.ok) setExitState('done');
    else {
      setExitState('error');
      setExitError(r.message);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Signatures
  const studioKind: 'signature' | 'initials' | null =
    active?.type === 'signature' || active?.type === 'initials'
      ? active.type
      : !active
        ? data.fields.some((f) => f.type === 'signature')
          ? 'signature'
          : data.fields.some((f) => f.type === 'initials')
            ? 'initials'
            : null
        : null;

  function afterApply(appliedIds: string[]) {
    if (!autoAdvance) return;
    const pool = remaining.filter((f) => !appliedIds.includes(f.id));
    const n = nextRequired(activeId, pool);
    if (n) setTimeout(() => goToField(n), 150);
  }

  async function adopt(a: Adopted, scope: 'field' | 'none') {
    if (!studioKind) return;
    const kind = studioKind;
    setBusy(true);
    setStudioError(null);
    // A new mark also replaces the earlier one wherever this recipient already applied it.
    const applyTo = data.fields
      .filter((f) => f.type === kind && (applied[f.id] || (scope === 'field' && f.id === activeId)))
      .map((f) => f.id);
    const r = await adoptAction(token, { kind, ...a, applyTo }).catch(() => ({
      ok: false as const,
      message: 'Connection problem. Your signature was not saved. Please try again.',
    }));
    setBusy(false);
    if (!r.ok) {
      if (/session has ended/i.test(r.message)) setSessionEnded(true);
      return setStudioError(r.message);
    }
    const mark = { id: r.id, dataUrl: r.dataUrl };
    setMarks((m) => ({ ...m, [kind]: mark }));
    setApplied((prev) => {
      const next = { ...prev };
      for (const id of r.applied) next[id] = mark;
      return next;
    });
    afterApply(r.applied);
  }

  async function applyExisting(scope: 'field' | 'all') {
    if (!studioKind) return;
    const mark = marks[studioKind];
    if (!mark) return;
    const ids =
      scope === 'all'
        ? data.fields
            .filter((f) => f.type === studioKind && applied[f.id]?.id !== mark.id)
            .map((f) => f.id)
        : activeId
          ? [activeId]
          : [];
    if (!ids.length) return;
    setBusy(true);
    setStudioError(null);
    const r = await saveProgressAction(token, {
      values: ids.map((id) => ({ fieldId: id, signatureId: mark.id })),
      page,
    }).catch(() => ({
      ok: false as const,
      message: 'Connection problem. Please try again.',
      ended: false,
    }));
    setBusy(false);
    if (!r.ok) {
      if ('ended' in r && r.ended) setSessionEnded(true);
      return setStudioError(`${r.message} The ${studioKind} was not applied.`);
    }
    setApplied((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = mark;
      return next;
    });
    setSavedAt(new Date(r.savedAt));
    afterApply(ids);
  }

  // ---------------------------------------------------------------------------------------------
  // Finish
  async function complete() {
    setBusy(true);
    setFinishError(null);
    const r = await completeAction(token, {
      intent: true,
      documentVersion: data.documentVersion,
      values: data.fields
        .filter((f) => f.type !== 'date_signed')
        .map((f) =>
          f.type === 'signature' || f.type === 'initials'
            ? { fieldId: f.id, signatureId: applied[f.id]?.id ?? null }
            : { fieldId: f.id, value: values[f.id] ?? '' },
        ),
    }).catch(() => ({
      ok: false,
      message: 'Connection problem. Your signing was not submitted. Please try again.',
    }));
    if (r?.ok) {
      dirty.current.clear();
      setExitState('done');
      router.refresh();
      return;
    }
    setBusy(false);
    const msg = r?.message ?? 'Something went wrong. Your signing was not submitted.';
    if (/session has ended/i.test(msg)) setSessionEnded(true);
    setFinishError(msg);
  }

  // ---------------------------------------------------------------------------------------------
  // Render
  if (exitState === 'done' && !finishing)
    return <SavedScreen title={title} senderName={senderName} authMethod={authMethod} />;
  if (sessionEnded) return <EndedScreen authMethod={authMethod} senderName={senderName} />;

  const nextAction =
    active && active.required && !isDone(active)
      ? active
      : remaining[0]
        ? (nextRequired(activeId) ?? remaining[0])
        : null;
  const activeRequiredPos = active?.required
    ? required.findIndex((f) => f.id === active.id) + 1
    : 0;
  const pagesWithWork = new Set(remaining.map((f) => f.page));
  const signaturePreview = marks.signature?.dataUrl ?? marks.initials?.dataUrl ?? null;

  const header = (
    <SignHeader
      step={2}
      actions={
        <>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-white hover:bg-white/10"
          >
            <CircleHelp className="size-5" aria-hidden />
            <span className="hidden sm:inline">Help</span>
            <span className="sr-only sm:hidden">Help</span>
          </button>
          <span aria-hidden className="hidden h-6 w-px bg-white/30 sm:block" />
          <button
            type="button"
            onClick={saveAndExit}
            disabled={exitState === 'saving'}
            className="flex h-9 items-center gap-2 rounded-lg border border-white/80 px-3 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60 sm:h-10 sm:px-4"
          >
            {exitState === 'saving' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            Save &amp; Exit
          </button>
        </>
      }
    />
  );

  const thumbnails = (
    <div className="flex h-full flex-col">
      <div className="m-3 flex gap-3 rounded-2xl bg-white p-4 shadow-card">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-blush text-primary">
          <FileText className="size-6" aria-hidden />
          <span className="sr-only">PDF document</span>
        </div>
        <div className="min-w-0 text-sm">
          <p className="font-display text-lg leading-tight text-primary">{title}</p>
          <p className="mt-1">From: {senderName}</p>
          <p>Sent: {dateFmt.format(new Date(data.sentAt))}</p>
          <p>Pages: {numPages}</p>
        </div>
      </div>
      <h2 className="px-5 pt-2 pb-2 text-sm font-semibold text-heading">
        Document Pages ({numPages})
      </h2>
      <ol className="flex-1 space-y-3 overflow-y-auto px-5 pb-6" aria-label="Pages">
        {pdf
          ? sizes.map((s, i) => {
              const n = i + 1;
              const current = n === page;
              return (
                <li key={n}>
                  <button
                    type="button"
                    onClick={() => {
                      goToPage(n);
                      setThumbsOpen(false);
                    }}
                    aria-current={current ? 'page' : undefined}
                    aria-label={`Go to page ${n}${pagesWithWork.has(n) ? ', has required fields for you' : ''}`}
                    className="group flex w-full items-center gap-3"
                  >
                    <span
                      className={cn(
                        'rounded-md border-2 p-0.5 transition-colors',
                        current
                          ? 'border-primary'
                          : 'border-transparent group-hover:border-rose-gold',
                      )}
                    >
                      <PdfPageView
                        pdf={pdf}
                        pageNumber={n}
                        box={s}
                        scale={120 / s.width}
                        thumbnail
                      />
                    </span>
                    <span
                      className={cn(
                        'relative flex size-7 items-center justify-center rounded-md text-xs font-semibold',
                        current ? 'bg-primary text-white' : 'bg-blush text-heading',
                      )}
                    >
                      {n}
                      {pagesWithWork.has(n) ? (
                        <span
                          aria-hidden
                          className="absolute -top-1 -right-1 size-2.5 rounded-full bg-rose-gold ring-2 ring-white"
                        />
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })
          : Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-40 w-32" />)}
      </ol>
    </div>
  );

  const tools = (
    <div className="flex flex-col gap-4 p-4">
      {isTest ? (
        <Alert tone="warning">
          Test request from a non-production environment. Not for real agreements.
        </Alert>
      ) : null}
      <section
        className="rounded-2xl border border-border bg-white p-4 shadow-card"
        aria-labelledby="progress-title"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="progress-title" className="font-display text-xl text-primary">
            Your Signing Progress
          </h2>
          <p className="text-sm">
            {doneCount} of {required.length} completed
          </p>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-blush"
          role="progressbar"
          aria-label="Required fields completed"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${doneCount} of ${required.length} required fields, ${pct}%`}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ol className="mt-3 grid grid-cols-3 text-center text-xs font-medium text-heading">
          <li className="flex items-center justify-center gap-1">
            Review <CircleCheck className="size-3.5 text-success" aria-label="done" />
          </li>
          <li className="text-primary" aria-current="step">
            Sign · {pct}%
          </li>
          <li className="text-slate-text">Complete</li>
        </ol>
      </section>

      {nextAction ? (
        <section className="rounded-2xl border border-border bg-white p-4 shadow-card">
          <h2 className="font-display text-lg text-heading">Next Required Action</h2>
          <button
            type="button"
            onClick={() => goToField(nextAction, { openSheet: false })}
            className="mt-2 flex w-full items-start gap-3 rounded-xl p-2 text-left hover:bg-blush/50"
          >
            <PenLine className="mt-0.5 size-7 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block font-semibold text-primary">
                {ACTION_COPY[nextAction.type]?.title ?? `Complete ${fieldName(nextAction)}`}
              </span>
              <span className="block text-sm">
                {ACTION_COPY[nextAction.type]?.body ?? 'Complete the highlighted field.'}{' '}
                <span className="whitespace-nowrap">(page {nextAction.page})</span>
              </span>
            </span>
          </button>
        </section>
      ) : (
        <section className="rounded-2xl border border-success/40 bg-success-bg/40 p-4">
          <h2 className="font-display text-lg text-heading">Review Required Information</h2>
          <p className="mt-1 text-sm">
            {required.length
              ? 'All required fields are complete. Review the document, then select Finish Signing.'
              : data.role === 'reviewer'
                ? 'Read the document, then finish your review.'
                : 'There are no required fields for you. Review the document, then finish.'}
          </p>
          <Button type="button" className="mt-3 w-full" onClick={() => setFinishing(true)}>
            {finishLabel(data.role)}
          </Button>
        </section>
      )}

      {studioKind ? (
        <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
          <SignatureStudio
            key={`${studioKind}-${marks[studioKind]?.id ?? 'none'}`}
            kind={studioKind}
            name={data.name}
            fonts={fonts}
            adopted={marks[studioKind]}
            activeField={
              active && active.type === studioKind
                ? { id: active.id, applied: applied[active.id]?.id === marks[studioKind]?.id }
                : null
            }
            unappliedCount={
              data.fields.filter(
                (f) => f.type === studioKind && applied[f.id]?.id !== marks[studioKind]?.id,
              ).length
            }
            onAdopt={adopt}
            onApply={applyExisting}
            busy={busy}
            error={studioError}
            autoAdvance={autoAdvance}
            onAutoAdvance={setAutoAdvance}
          />
        </div>
      ) : active ? (
        <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
          <FieldControls
            field={active}
            value={values[active.id] ?? ''}
            today={today}
            onChange={(v) => change(active, v)}
          />
          {active.type !== 'date_signed' ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-3 w-full"
              onClick={goNext}
              disabled={allDone && isDone(active)}
            >
              Next Field <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-center">
        <DeclineForm token={token} compact />
      </div>
    </div>
  );

  const saveBadge = (
    <span className="flex items-center gap-1.5 text-xs" aria-live="polite">
      {saveState === 'saving' ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
        </>
      ) : saveState === 'error' ? (
        <>
          <CloudOff className="size-3.5 text-error" aria-hidden />
          <span className="text-error">Not saved.</span>
          <button
            type="button"
            className="font-semibold text-primary underline"
            onClick={() => void flush()}
          >
            Retry
          </button>
        </>
      ) : savedAt ? (
        <>
          <CircleCheck className="size-3.5 text-success" aria-hidden /> Saved
        </>
      ) : null}
    </span>
  );

  return (
    <div ref={root} className="flex h-dvh flex-col overflow-hidden bg-ivory">
      {header}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {`${doneCount} of ${required.length} required fields completed.`}
      </p>
      <div className="flex min-h-0 flex-1">
        {/* Left: document navigation */}
        <aside
          aria-label="Document pages"
          className="hidden w-[264px] shrink-0 border-r border-border bg-ivory lg:block"
        >
          {thumbnails}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Toolbar */}
          <div
            role="toolbar"
            aria-label="Document viewer"
            className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-white px-2 py-2 sm:gap-2 sm:px-4"
          >
            <button
              type="button"
              onClick={() => setThumbsOpen(true)}
              className={cn(tool, 'lg:hidden')}
              aria-label="Show pages"
            >
              <PanelLeft className="size-4" aria-hidden />
            </button>
            <div className="flex items-center rounded-lg border border-border">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className={toolInner}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <span className="px-1 text-sm whitespace-nowrap text-heading" aria-live="polite">
                Page {page} of {numPages}
              </span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= numPages}
                className={toolInner}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            <div className="flex items-center rounded-lg border border-border">
              <button
                type="button"
                onClick={() => zoomStep(-1)}
                disabled={zoomPct <= 50}
                className={toolInner}
                aria-label="Zoom out"
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <span
                className="w-12 text-center text-sm text-heading"
                aria-label={`Zoom ${zoomPct}%`}
              >
                {zoomPct}%
              </span>
              <button
                type="button"
                onClick={() => zoomStep(1)}
                disabled={zoomPct >= 200}
                className={toolInner}
                aria-label="Zoom in"
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
            <label className="sr-only" htmlFor="zoom-mode">
              Zoom level
            </label>
            <select
              id="zoom-mode"
              value={zoom.mode === 'custom' ? String(zoom.pct) : zoom.mode}
              onChange={(e) => {
                const v = e.target.value;
                setZoom(
                  v === 'width' || v === 'page' ? { mode: v } : { mode: 'custom', pct: Number(v) },
                );
              }}
              className="h-9 rounded-lg border border-border bg-white px-2 text-sm text-heading"
            >
              <option value="width">Fit Width</option>
              <option value="page">Fit Page</option>
              {ZOOMS.map((z) => (
                <option key={z} value={z}>
                  {z}%
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSingle((s) => !s)}
              className={tool}
              aria-pressed={single}
              aria-label={
                single
                  ? 'Single page view (select for continuous scroll)'
                  : 'Continuous scroll (select for single page view)'
              }
              title={single ? 'Single page' : 'Continuous scroll'}
            >
              {single ? (
                <Square className="size-4" aria-hidden />
              ) : (
                <Rows3 className="size-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className={tool}
              aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {fullscreen ? (
                <Minimize className="size-4" aria-hidden />
              ) : (
                <Maximize className="size-4" aria-hidden />
              )}
            </button>
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden sm:flex">{saveBadge}</span>
              {data.allowDownload ? (
                <a
                  href={`/api/sign/${token}/file?download=1`}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-primary hover:bg-blush"
                >
                  <Download className="size-4" aria-hidden />
                  <span className="hidden md:inline">Download</span>
                  <span className="sr-only md:hidden">Download</span>
                </a>
              ) : null}
            </div>
          </div>

          {banner ? (
            <Alert tone="error" className="m-3">
              {banner}{' '}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => setBanner(null)}
              >
                Dismiss
              </button>
            </Alert>
          ) : null}

          {/* Center: document (the phone/tablet tools sheet opens over it, above the field bar) */}
          <div className="relative min-h-0 flex-1">
            <div
              ref={setScroller}
              className="absolute inset-0 overflow-auto bg-[#f3ecea]"
              tabIndex={-1}
            >
              {pdfError ? (
                <div className="mx-auto max-w-md p-6">
                  <Alert tone="error">{pdfError}</Alert>
                  <Button type="button" variant="secondary" className="mt-3" onClick={retryPdf}>
                    Try again
                  </Button>
                </div>
              ) : !pdf || !box.w ? (
                <div className="p-4">
                  <Skeleton className="mx-auto aspect-[8.5/11] w-full max-w-[820px]" />
                </div>
              ) : (
                <div className="flex min-w-fit flex-col items-center gap-6 p-4 pb-10">
                  {sizes.map((s, i) => {
                    const n = i + 1;
                    if (single && n !== page) return null;
                    return (
                      <PdfPageView
                        key={n}
                        pdf={pdf}
                        pageNumber={n}
                        box={s}
                        scale={scale}
                        root={scrollEl}
                      >
                        <FieldLayer
                          page={n}
                          pageHeight={s.height * scale}
                          pageWidth={s.width * scale}
                          pagePt={s}
                          block={block}
                          fields={data.fields}
                          others={data.completedByOthers}
                          values={values}
                          applied={applied}
                          activeId={activeId}
                          isDone={isDone}
                          today={today}
                          onActivate={(f) => {
                            setActiveId(f.id);
                            setStudioError(null);
                            if (
                              !isDesktop() &&
                              (f.type === 'signature' ||
                                f.type === 'initials' ||
                                f.type === 'radio')
                            )
                              setSheetOpen(true);
                          }}
                          onChange={change}
                        />
                      </PdfPageView>
                    );
                  })}
                </div>
              )}
            </div>
            {sheetOpen ? (
              <div
                role="dialog"
                aria-modal="false"
                aria-label="Signing tools"
                className="absolute inset-x-0 bottom-0 z-30 max-h-[88%] overflow-y-auto rounded-t-2xl border-t border-border bg-ivory shadow-[0_-8px_30px_rgba(39,15,23,0.18)] md:inset-y-0 md:left-auto md:max-h-none md:w-[400px] md:rounded-none md:border-t-0 md:border-l lg:hidden"
              >
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-ivory/95 px-4 py-2 backdrop-blur">
                  <span className="mx-auto h-1 w-10 rounded-full bg-border md:hidden" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    className={cn(tool, 'absolute right-3')}
                    aria-label="Close signing tools"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
                {tools}
              </div>
            ) : null}
          </div>

          {/* Bottom: required-field navigation */}
          <nav
            aria-label="Field navigation"
            className="flex shrink-0 items-center gap-2 border-t border-border bg-white px-3 py-2.5 sm:px-5 sm:py-3"
          >
            <Button
              type="button"
              variant="secondary"
              onClick={goPrev}
              disabled={!sequence.length}
              className="border-primary/40 text-primary"
            >
              <ArrowLeft className="size-4" aria-hidden />{' '}
              <span className="hidden sm:inline">Previous Field</span>
              <span className="sr-only sm:hidden">Previous Field</span>
            </Button>
            <p className="flex-1 text-center text-sm text-heading">
              {required.length === 0
                ? 'No required fields'
                : allDone
                  ? 'All required fields complete'
                  : `${activeRequiredPos || required.indexOf(nextAction ?? required[0]!) + 1} of ${required.length} required fields`}
            </p>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className={cn(tool, 'lg:hidden')}
              aria-label="Signing tools"
            >
              <Wrench className="size-4" aria-hidden />
            </button>
            {allDone ? (
              <Button type="button" onClick={() => setFinishing(true)}>
                {finishLabel(data.role)}
              </Button>
            ) : (
              <Button type="button" onClick={goNext}>
                Next Field <ArrowRight className="size-4" aria-hidden />
              </Button>
            )}
          </nav>
        </div>

        {/* Right: signing tools */}
        <aside
          aria-label="Signing tools"
          className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-border bg-ivory lg:block xl:w-[400px]"
        >
          {tools}
        </aside>
      </div>

      {/* Tablet and phone: page drawer and tools sheet */}
      {thumbsOpen ? (
        <div
          className="fixed inset-0 z-50 bg-heading/40 lg:hidden"
          onClick={() => setThumbsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Document pages"
            className="h-full w-72 max-w-[85vw] overflow-hidden bg-ivory shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => setThumbsOpen(false)}
                className={tool}
                aria-label="Close pages"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="h-[calc(100%-3rem)]">{thumbnails}</div>
          </div>
        </div>
      ) : null}
      {helpOpen ? (
        <HelpPanel
          onClose={() => setHelpOpen(false)}
          senderName={senderName}
          authMethod={authMethod}
        />
      ) : null}
      {exitState === 'error' ? (
        <RetryDialog
          message={exitError ?? 'Something went wrong.'}
          busy={false}
          onRetry={saveAndExit}
          onClose={() => setExitState('idle')}
        />
      ) : null}
      {finishing ? (
        <FinishDialog
          title={title}
          recipientName={data.name}
          role={data.role}
          requiredDone={doneCount}
          requiredTotal={required.length}
          signaturePreview={signaturePreview}
          error={finishError}
          busy={busy}
          onBack={() => {
            setFinishing(false);
            setFinishError(null);
          }}
          onComplete={complete}
        />
      ) : null}
    </div>
  );
}

const tool =
  'flex size-9 items-center justify-center rounded-lg border border-border bg-white text-heading hover:bg-blush disabled:opacity-40';
const toolInner =
  'flex size-9 items-center justify-center text-heading hover:bg-blush disabled:opacity-40 rounded-lg';

function finishLabel(role: string) {
  return role === 'reviewer'
    ? 'Finish Review'
    : role === 'approver'
      ? 'Finish Approval'
      : 'Finish Signing';
}

function SavedScreen({
  title,
  senderName,
  authMethod,
}: {
  title: string;
  senderName: string;
  authMethod: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      <SignHeader step={2} />
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <div className="rounded-2xl border border-border bg-white p-6 text-center shadow-card sm:p-8">
          <div
            className="mx-auto flex size-12 items-center justify-center rounded-full bg-blush text-primary"
            aria-hidden
          >
            <CircleCheck className="size-6" />
          </div>
          <h1 className="mt-3 font-display text-3xl">Your progress is saved</h1>
          <p className="mt-2 text-sm">
            &ldquo;{title}&rdquo; is not signed yet. Your completed fields and adopted signature are
            saved, and you have been signed out of this document.
          </p>
          <div className="mt-5 rounded-xl bg-ivory p-4 text-left text-sm">
            <p className="font-semibold text-heading">To continue later</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Open the invitation email from {senderName}.</li>
              <li>
                Select the signing link again
                {authMethod === 'email_code' ? ' and confirm the new code we email you' : ''}.
              </li>
              <li>You&apos;ll return to where you left off.</li>
            </ol>
          </div>
          <Link href="/" className={buttonClass('secondary', 'md', 'mt-5')}>
            Return to Signature Tender homepage
          </Link>
        </div>
      </main>
    </div>
  );
}

function EndedScreen({ authMethod, senderName }: { authMethod: string; senderName: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      <SignHeader step={2} />
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <div className="rounded-2xl border border-border bg-white p-6 text-center shadow-card sm:p-8">
          <h1 className="font-display text-3xl">Your signing session has ended</h1>
          <p className="mt-2 text-sm">
            For your security, signing sessions are short. Anything that showed as saved is kept.
            Open the link in your email from {senderName} again
            {authMethod === 'email_code' ? ' and confirm a new code' : ''} to continue.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={buttonClass('primary', 'md', 'mt-5')}
          >
            Start again
          </button>
        </div>
      </main>
    </div>
  );
}
