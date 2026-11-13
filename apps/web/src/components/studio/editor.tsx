'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookmarkCheck,
  Columns2,
  Copy,
  FolderOpen,
  HelpCircle,
  History,
  Maximize2,
  MousePointer2,
  PenLine,
  PenTool,
  Redo2,
  RotateCcw,
  Save,
  Shapes,
  Signature,
  Type,
  Undo2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  emptyDesign,
  hasContent,
  normalizeDesign,
  renderDesign,
  type Design,
  type PublicStudioSettings,
} from '@st/core/studio/index';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import {
  continueToCheckoutAction,
  saveStudioDraftAction,
  studioEventAction,
  uploadStudioImageAction,
} from '@/app/(marketing)/signature-studio/actions';
import { ArtworkSvg, BACKGROUNDS, StudioCanvas, backgroundStyle, type Background, type CanvasMode } from './canvas';
import { ChipButton } from './controls';
import { ElementInspector, ElementsPanel, SmartStrokePanel } from './element-panels';
import { DrawPanel, InkPicker, PenPanel, UploadPanel } from './ink-panels';
import { useOutlines } from './fonts';
import { useDesignHistory } from './state';
import { FontLibrary, NameField, Personalize, StylePicker, Variations } from './type-panels';

type Kind = 'signature' | 'initials';
type Section = 'signature' | 'initials' | 'fonts' | 'elements' | 'saved' | 'help';

export interface SavedDesign {
  id: string;
  name: string;
  status: string;
  style: string;
  kind: Kind;
  design: Design;
}

const LOCAL_KEY = 'st_studio_draft_v1';

const METHODS: { id: Design['method']; label: string; icon: typeof Type }[] = [
  { id: 'type', label: 'Type & Style', icon: Type },
  { id: 'draw', label: 'Draw Signature', icon: PenLine },
  { id: 'upload', label: 'Upload Signature', icon: Upload },
  { id: 'design', label: 'Custom Design', icon: Wand2 },
];

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function starter(kind: Kind): Design {
  const d = emptyDesign(kind);
  if (kind === 'initials' && d.text) d.text = { ...d.text, font: 'great-vibes' };
  return d;
}

function initialsFrom(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, '').charAt(0).toUpperCase())
    .filter(Boolean)
    .slice(0, 3)
    .join('');
}

export function StudioEditor({
  settings,
  signedIn,
  saved = [],
  resume,
  context = 'public',
}: {
  settings: PublicStudioSettings;
  signedIn: boolean;
  saved?: SavedDesign[];
  /** A design to open (after sign-in, or from the library). */
  resume?: { id: string | null; design: Design } | null;
  context?: 'public' | 'app';
}) {
  const router = useRouter();
  const sig = useDesignHistory(resume?.design.kind === 'signature' ? resume.design : starter('signature'));
  const ini = useDesignHistory(resume?.design.kind === 'initials' ? resume.design : starter('initials'));
  const [kind, setKind] = useState<Kind>(resume?.design.kind ?? 'signature');
  const history = kind === 'signature' ? sig : ini;
  const { design } = history;
  const [ids, setIds] = useState<Record<Kind, string | null>>({
    signature: resume?.design.kind === 'signature' ? resume.id : null,
    initials: resume?.design.kind === 'initials' ? resume.id : null,
  });
  const [section, setSection] = useState<Section>(resume?.design.kind ?? 'signature');
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<CanvasMode>('select');
  const [anchor, setAnchor] = useState<number | null>(null);
  const [background, setBackground] = useState<Background>('white');
  const [zoom, setZoom] = useState(1);
  const [compareWith, setCompareWith] = useState<Design | null>(null);
  const [sideBySide, setSideBySide] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [restored, setRestored] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const uploads = useRef(new Map<string, string>());

  const track = useCallback((event: string, props: Record<string, string> = {}) => {
    void studioEventAction(event, props).catch(() => undefined);
  }, []);

  // Local draft recovery: the design is kept in this browser (and nowhere else) until saved.
  // Read after mount so the server-rendered editor and the first client render match.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    track('studio_visited');
    if (resume) return;
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as { signature?: unknown; initials?: unknown; ids?: Record<Kind, string | null>; kind?: Kind };
      if (v.signature) sig.load(normalizeDesign(v.signature));
      if (v.initials) ini.load(normalizeDesign(v.initials));
      if (v.ids) setIds(v.ids);
      if (v.kind) {
        setKind(v.kind);
        setSection(v.kind);
      }
      setRestored(Boolean(v.signature || v.initials));
    } catch {
      /* ignore damaged or unavailable storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (!hasContent(sig.design) && !hasContent(ini.design)) localStorage.removeItem(LOCAL_KEY);
        else localStorage.setItem(LOCAL_KEY, JSON.stringify({ signature: sig.design, initials: ini.design, ids, kind }));
      } catch {
        /* private mode */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [sig.design, ini.design, ids, kind]);

  const fontIds = [design.text?.font, compareWith?.text?.font].filter((f): f is string => !!f);
  const { fonts, ready } = useOutlines(fontIds);
  const rendered = useMemo(() => renderDesign(design, fonts), [design, fonts, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const compareRendered = useMemo(() => (compareWith ? renderDesign(compareWith, fonts) : null), [compareWith, fonts, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const imageHref = useCallback((ref: string) => uploads.current.get(ref) ?? `/api/studio/upload/${ref}`, []);
  const selectedEl = design.elements.find((e) => e.id === selected) ?? null;
  const price = money(settings.priceCents, settings.currency);
  const content = hasContent(design);

  // Keyboard: undo/redo, delete the selected element, Escape to deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEl) {
        e.preventDefault();
        history.set((d) => ({ ...d, elements: d.elements.filter((x) => x.id !== selectedEl.id) }));
        setSelected(null);
      } else if (e.key === 'Escape') {
        setSelected(null);
        setMode('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, selectedEl]);

  function switchKind(k: Kind) {
    setKind(k);
    setSection(k);
    setSelected(null);
    setMode('select');
    if (k === 'initials' && !ini.design.text?.value && sig.design.text?.value) {
      const v = initialsFrom(sig.design.text.value);
      ini.load({ ...ini.design, text: { ...ini.design.text!, value: v, font: sig.design.text.font } });
    }
  }

  function setMethod(m: Design['method']) {
    history.set((d) => ({ ...d, method: m }));
    track('method_selected', { method: m });
    setSelected(null);
    setMode(m === 'draw' ? 'draw' : 'select');
  }

  async function save(asCopy = false) {
    setBusy(true);
    setStatus(null);
    const r = await saveStudioDraftAction({ id: asCopy ? null : ids[kind], design });
    setBusy(false);
    if (!r.ok) return setStatus({ tone: 'error', text: r.message });
    setIds((x) => ({ ...x, [kind]: r.id }));
    setStatus({ tone: 'success', text: asCopy ? 'Saved as a new draft.' : signedIn ? 'Draft saved to your account.' : 'Draft saved in this browser. Sign in to keep it in your account.' });
  }

  async function download() {
    if (!content) return setStatus({ tone: 'error', text: 'Create your signature first.' });
    if (rendered.missingChars.length) return setStatus({ tone: 'error', text: 'Some characters are not in this font. Choose another font before downloading.' });
    setBusy(true);
    setStatus(null);
    const r = await continueToCheckoutAction({ id: ids[kind], design });
    setBusy(false);
    if (!r.ok) return setStatus({ tone: 'error', text: r.message });
    setIds((x) => ({ ...x, [kind]: r.id }));
    if (r.needsAuth) setAuthOpen(true);
    else router.push(r.next);
  }

  async function upload(file: Blob) {
    const fd = new FormData();
    fd.set('file', file, 'signature.png');
    return uploadStudioImageAction(fd);
  }

  const methodTab = (
    <div role="tablist" aria-label="How to create" className="grid grid-cols-2 gap-1 rounded-xl bg-cream p-1 sm:grid-cols-4">
      {METHODS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={design.method === m.id}
          onClick={() => setMethod(m.id)}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition-colors',
            design.method === m.id ? 'bg-white text-primary shadow' : 'text-slate-text hover:text-primary',
          )}
        >
          <m.icon className="size-4" aria-hidden /> {m.label}
        </button>
      ))}
    </div>
  );

  const nav: { id: Section; label: string; icon: typeof Type; hidden?: boolean }[] = [
    { id: 'signature', label: 'Signature', icon: Signature },
    { id: 'initials', label: 'Initials', icon: BookmarkCheck, hidden: !settings.initialsEnabled },
    { id: 'fonts', label: 'Fonts', icon: Type },
    { id: 'elements', label: 'Signature Elements', icon: Shapes },
    { id: 'saved', label: 'Saved Designs', icon: FolderOpen },
    { id: 'help', label: 'Help', icon: HelpCircle },
  ];

  function panel() {
    if (section === 'fonts')
      return <FontLibrary history={history} disabledFonts={settings.disabledFonts} featured={settings.featuredFonts} onTrack={track} />;
    if (section === 'elements')
      return (
        <ElementsPanel
          history={history}
          rendered={rendered}
          disabled={settings.disabledElements}
          onSelect={(id) => {
            setSelected(id);
            setMode('select');
          }}
          onDrawFreehand={() => {
            setMode('freehand');
            setSelected(null);
          }}
        />
      );
    if (section === 'saved') return <SavedPanel signedIn={signedIn} saved={saved} onOpen={openSaved} libraryHref={context === 'app' ? '/app/signature-studio/library' : '/signature-studio/library'} />;
    if (section === 'help') return <HelpPanel price={price} />;
    const typeTools = (
      <>
        <NameField history={history} fonts={fonts} kind={kind} onTrack={track} />
        <StylePicker history={history} fonts={fonts} disabledFonts={settings.disabledFonts} onTrack={track} />
        <Variations history={history} fonts={fonts} onTrack={track} />
        <Personalize history={history} fonts={fonts} />
      </>
    );
    switch (design.method) {
      case 'type':
        return (
          <>
            {typeTools}
            <PenPanel history={history} settings={settings} />
          </>
        );
      case 'draw':
        return (
          <>
            <DrawPanel history={history} onUseDraw={() => setMode('draw')} />
            <PenPanel history={history} settings={settings} />
          </>
        );
      case 'upload':
        return (
          <>
            <UploadPanel history={history} upload={upload} onUploaded={(ref, url) => uploads.current.set(ref, url)} />
            <InkPicker history={history} settings={settings} />
          </>
        );
      default:
        return (
          <>
            <NameField history={history} fonts={fonts} kind={kind} onTrack={track} />
            <div className="flex flex-wrap gap-2">
              <ChipButton onClick={() => setMode('draw')} active={mode === 'draw'}>
                <PenLine className="size-4" aria-hidden /> Draw strokes
              </ChipButton>
              <ChipButton onClick={() => setMode('freehand')} active={mode === 'freehand'}>
                <PenTool className="size-4" aria-hidden /> Draw on signature
              </ChipButton>
              <ChipButton onClick={() => setSection('elements')}>
                <Shapes className="size-4" aria-hidden /> Add elements
              </ChipButton>
            </div>
            <StylePicker history={history} fonts={fonts} disabledFonts={settings.disabledFonts} onTrack={track} />
            <Personalize history={history} fonts={fonts} />
            <UploadPanel history={history} upload={upload} onUploaded={(ref, url) => uploads.current.set(ref, url)} />
            <PenPanel history={history} settings={settings} />
          </>
        );
    }
  }

  function openSaved(s: SavedDesign) {
    const k = s.kind;
    setKind(k);
    setSection(k);
    (k === 'signature' ? sig : ini).load(s.design);
    // A purchased design never changes: editing it starts a new draft.
    setIds((x) => ({ ...x, [k]: s.status === 'draft' ? s.id : null }));
    setStatus(s.status === 'draft' ? null : { tone: 'success', text: 'Opened a copy. Your purchased design stays exactly as it is.' });
  }

  const toolbarBtn = 'inline-flex size-9 items-center justify-center rounded-lg text-heading hover:bg-cream disabled:opacity-40';

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-card">
      <div className="grid lg:grid-cols-[13rem_minmax(0,1fr)_22rem]">
        {/* Left navigation */}
        <nav aria-label="Studio" className="border-b border-border bg-ivory/70 p-2 lg:border-b-0 lg:border-r lg:p-3">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {nav
              .filter((n) => !n.hidden)
              .map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    aria-current={section === n.id ? 'page' : undefined}
                    onClick={() => (n.id === 'signature' || n.id === 'initials' ? switchKind(n.id) : setSection(n.id))}
                    className={cn(
                      'flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
                      section === n.id ? 'bg-primary text-white' : 'text-heading hover:bg-white',
                    )}
                  >
                    <n.icon className="size-4 shrink-0" aria-hidden /> {n.label}
                  </button>
                </li>
              ))}
          </ul>
        </nav>

        {/* Canvas */}
        <div className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
          {restored ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-info-bg px-3 py-2 text-sm text-info" role="status">
              <span>We restored your design from this browser. It is stored only on this device until you save it.</span>
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  sig.load(starter('signature'));
                  ini.load(starter('initials'));
                  setIds({ signature: null, initials: null });
                  setRestored(false);
                  try {
                    localStorage.removeItem(LOCAL_KEY);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Start over
              </button>
            </div>
          ) : null}
          {methodTab}
          <div className="sticky top-0 z-10 -mx-3 bg-white px-3 pb-2 pt-1 sm:static sm:mx-0 sm:px-0">
            <div className="mb-2 flex flex-wrap items-center gap-1" role="toolbar" aria-label="Design tools">
              <button type="button" className={cn(toolbarBtn, mode === 'select' && 'bg-cream')} aria-pressed={mode === 'select'} onClick={() => setMode('select')} title="Select and move" aria-label="Select and move">
                <MousePointer2 className="size-4" aria-hidden />
              </button>
              <button type="button" className={cn(toolbarBtn, mode === 'draw' && 'bg-cream')} aria-pressed={mode === 'draw'} onClick={() => { if (design.method === 'type' || design.method === 'upload') setMethod('draw'); setMode('draw'); }} title="Draw" aria-label="Draw">
                <PenLine className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className={cn(toolbarBtn, mode === 'freehand' && 'bg-cream')}
                aria-pressed={mode === 'freehand'}
                onClick={() => setMode('freehand')}
                title="Draw on signature (Smart Stroke)"
                aria-label="Draw on signature with Smart Stroke"
              >
                <PenTool className="size-4" aria-hidden />
              </button>
              <span className="mx-1 h-6 w-px bg-border" aria-hidden />
              <button type="button" className={toolbarBtn} onClick={history.undo} disabled={!history.canUndo} title="Undo" aria-label="Undo">
                <Undo2 className="size-4" aria-hidden />
              </button>
              <button type="button" className={toolbarBtn} onClick={history.redo} disabled={!history.canRedo} title="Redo" aria-label="Redo">
                <Redo2 className="size-4" aria-hidden />
              </button>
              <button type="button" className={toolbarBtn} onClick={() => { history.reset(starter(kind)); setSelected(null); }} title="Reset" aria-label="Reset design">
                <RotateCcw className="size-4" aria-hidden />
              </button>
              <button type="button" className={toolbarBtn} onClick={() => history.reset(history.original)} title="Restore original" aria-label="Restore original design">
                <History className="size-4" aria-hidden />
              </button>
              <button type="button" className={toolbarBtn} onClick={() => void save(true)} disabled={!content || busy} title="Duplicate as a new draft" aria-label="Duplicate as a new draft">
                <Copy className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className={cn(toolbarBtn, compareWith && 'bg-cream')}
                aria-pressed={Boolean(compareWith)}
                onClick={() => setCompareWith(compareWith ? null : design)}
                title={compareWith ? 'Stop comparing' : 'Compare: keep this version to compare with'}
                aria-label={compareWith ? 'Stop comparing' : 'Compare with this version'}
              >
                <Columns2 className="size-4" aria-hidden />
              </button>
              <span className="ml-auto" />
              <Button type="button" variant="secondary" size="sm" onClick={() => void save()} loading={busy} disabled={!content}>
                <Save className="size-4" aria-hidden /> Save Draft
              </Button>
            </div>
            {mode === 'draw' || mode === 'freehand' ? (
              <p className="mb-2 text-xs font-medium text-primary" role="status">
                {mode === 'draw' ? 'Draw your signature in the box.' : 'Draw a stroke on or near your signature. Smart Stroke will refine it to match.'}
              </p>
            ) : null}
            {sideBySide ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <figure>
                  <div className="rounded-xl border border-border p-2" style={backgroundStyle(background)}>
                    <ArtworkSvg rendered={compareRendered ?? rendered} imageHref={imageHref} full />
                  </div>
                  <figcaption className="mt-1 text-center text-xs text-slate-text">{compareWith ? 'Saved for comparison' : 'Current'}</figcaption>
                </figure>
                <figure>
                  <div className="rounded-xl border border-border p-2" style={backgroundStyle(compareWith ? background : 'navy')}>
                    <ArtworkSvg rendered={rendered} imageHref={imageHref} full className={!compareWith ? '[&_path]:fill-white' : undefined} />
                  </div>
                  <figcaption className="mt-1 text-center text-xs text-slate-text">{compareWith ? 'Current' : 'On dark navy (shown in white ink)'}</figcaption>
                </figure>
              </div>
            ) : actualSize ? (
              <ActualSize rendered={rendered} imageHref={imageHref} />
            ) : (
              <StudioCanvas
                history={history}
                rendered={rendered}
                imageHref={imageHref}
                mode={mode === 'select' && selectedEl?.anchors?.length && section !== 'elements' ? 'curve' : mode}
                selected={selected}
                onSelect={(id) => {
                  setSelected(id);
                  setAnchor(null);
                }}
                anchorIndex={anchor}
                onAnchor={setAnchor}
                background={background}
                zoom={zoom}
                marker
                onStrokeAdded={() => {
                  setMode('select');
                  track('custom_stroke_added');
                }}
              />
            )}
          </div>
          {!content ? (
            <p className="text-center text-sm text-slate-text">
              {design.method === 'draw' ? 'Draw your signature above.' : design.method === 'upload' ? 'Upload an image of your signature.' : 'Type your name to see it in your chosen style.'}
            </p>
          ) : null}
          {/* Preview controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Preview background">
              {BACKGROUNDS.map((b) => (
                <ChipButton key={b.id} active={background === b.id} onClick={() => setBackground(b.id)} className="min-h-8 px-2.5 py-1 text-xs">
                  {b.label}
                </ChipButton>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-medium text-heading">
                Zoom
                <input type="range" min={0.5} max={2} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-24 accent-[#0D1B33]" aria-label="Zoom" />
              </label>
              <ChipButton onClick={() => setZoom(1)} className="min-h-8 px-2 text-xs" aria-label="Fit to canvas">
                <Maximize2 className="size-3.5" aria-hidden /> Fit
              </ChipButton>
              <ChipButton onClick={() => setSideBySide((v) => !v)} active={sideBySide} className="min-h-8 px-2 text-xs">
                Side by side
              </ChipButton>
              <ChipButton onClick={() => setActualSize((v) => !v)} active={actualSize} className="min-h-8 px-2 text-xs">
                Actual size
              </ChipButton>
            </div>
          </div>
          {status ? <Alert tone={status.tone}>{status.text}</Alert> : null}
        </div>

        {/* Tools: a side panel on desktop, a sheet under the canvas on phones */}
        <aside aria-label="Design tools" className="flex max-h-none flex-col gap-5 border-t border-border bg-white p-4 lg:max-h-[52rem] lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="mx-auto -mt-2 h-1 w-10 rounded-full bg-border lg:hidden" aria-hidden />
          {selectedEl ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-heading">Selected</p>
                <button type="button" onClick={() => setSelected(null)} className="rounded p-1 hover:bg-cream" aria-label="Done editing element">
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              {selectedEl.type === 'freehand' ? (
                <SmartStrokePanel
                  history={history}
                  element={selectedEl}
                  rendered={rendered}
                  curveMode={Boolean(selectedEl.anchors?.length)}
                  onCurveMode={(on) => {
                    if (!on && selectedEl.anchors?.length) setAnchor(null);
                  }}
                  onSelect={setSelected}
                  onTrack={track}
                />
              ) : null}
              <ElementInspector history={history} element={selectedEl} onSelect={setSelected} />
            </>
          ) : (
            panel()
          )}
        </aside>
      </div>

      {/* Bottom bar */}
      <div className="flex flex-col items-start justify-between gap-3 border-t border-border bg-primary px-4 py-4 text-white sm:flex-row sm:items-center sm:px-6">
        <div>
          <p className="font-display text-lg">Like your design?</p>
          <p className="text-sm text-white/80">
            {signedIn ? `Download it in high resolution for ${price}. No subscription.` : `Sign in and download it for ${price}. No subscription.`}
          </p>
        </div>
        <Button type="button" onClick={() => void download()} loading={busy} disabled={!settings.purchasesEnabled} className="bg-gold text-primary hover:bg-soft-gold">
          {signedIn ? `Download — ${price}` : `Sign In to Download — ${price}`}
        </Button>
      </div>
      {!settings.purchasesEnabled ? (
        <p className="bg-warning-bg px-4 py-2 text-center text-sm text-warning">Downloads are paused right now. You can keep designing and save your draft.</p>
      ) : null}
      {context === 'app' ? (
        <p className="border-t border-border px-4 py-2 text-center text-xs text-slate-text">
          Your purchased designs are in <Link href="/app/signature-studio/library" className="font-semibold text-primary hover:underline">My Signatures</Link>.
        </p>
      ) : null}
      {authOpen ? <AuthModal price={price} onClose={() => setAuthOpen(false)} rendered={rendered} imageHref={imageHref} /> : null}
    </div>
  );
}

function ActualSize({ rendered, imageHref }: { rendered: ReturnType<typeof renderDesign>; imageHref: (r: string) => string | undefined }) {
  return (
    <div className="rounded-xl border border-border bg-[#f4f1ea] p-4 sm:p-8">
      <div className="mx-auto max-w-md rounded bg-white p-6 shadow">
        <p className="text-[10px] uppercase tracking-wider text-slate-400">Sample agreement</p>
        <div className="mt-2 space-y-1.5" aria-hidden>
          {[92, 100, 84, 96].map((w, i) => (
            <div key={i} className="h-1.5 rounded bg-slate-200" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="mt-6 w-56">
          {/* About 2.3 inches wide: a typical signature line. */}
          <ArtworkSvg rendered={rendered} imageHref={imageHref} className="[&>svg]:h-12 [&>svg]:w-auto" label="Signature at actual signing size" />
          <div className="border-t border-slate-500 pt-1 text-[10px] text-slate-500">Signature</div>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-slate-text">Shown at about the size it appears on a signed document.</p>
    </div>
  );
}

function AuthModal({
  price,
  onClose,
  rendered,
  imageHref,
}: {
  price: string;
  onClose: () => void;
  rendered: ReturnType<typeof renderDesign>;
  imageHref: (r: string) => string | undefined;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    void studioEventAction('auth_started').catch(() => undefined);
  }, []);
  const next = encodeURIComponent('/signature-studio/continue');
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="studio-auth-title"
      className="w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border p-0 shadow-2xl backdrop:bg-primary/50"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="studio-auth-title" className="font-display text-2xl text-heading">
            Your Signature Is Ready
          </h2>
          <button type="button" onClick={() => ref.current?.close()} className="rounded p-1 hover:bg-cream" aria-label="Close">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="mt-4 rounded-xl border border-border bg-white p-3">
          <ArtworkSvg rendered={rendered} imageHref={imageHref} className="[&>svg]:mx-auto [&>svg]:max-h-24 [&>svg]:w-auto" />
        </div>
        <p className="mt-4 text-sm">Create a free account or sign in to save your design and unlock your signature for just {price}.</p>
        <div className="mt-5 flex flex-col gap-2">
          <ButtonLink href={`/sign-up?next=${next}`} size="lg">
            Create Free Account
          </ButtonLink>
          <ButtonLink href={`/sign-in?next=${next}`} size="lg" variant="secondary">
            Sign In
          </ButtonLink>
        </div>
        <p className="mt-4 text-xs text-slate-text">Your design is saved and moves into your account when you sign in.</p>
      </div>
    </dialog>
  );
}

function SavedPanel({ signedIn, saved, onOpen, libraryHref }: { signedIn: boolean; saved: SavedDesign[]; onOpen: (s: SavedDesign) => void; libraryHref: string }) {
  if (!signedIn)
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-heading">Saved designs</h3>
        <p className="text-sm text-slate-text">Your current design is kept in this browser. Sign in to save designs to your account and open them anywhere.</p>
        <ButtonLink href={`/sign-in?next=${encodeURIComponent('/signature-studio/continue')}`} variant="secondary">
          Sign In
        </ButtonLink>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-heading">Saved designs</h3>
      {saved.length === 0 ? <p className="text-sm text-slate-text">Designs you save appear here.</p> : null}
      <ul className="flex flex-col gap-2">
        {saved.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-heading">{s.name}</span>
              <span className="block text-xs text-slate-text">
                {s.style} · {s.status === 'purchased' ? 'Purchased' : 'Draft'}
              </span>
            </span>
            <ChipButton onClick={() => onOpen(s)} className="min-h-8 px-2 text-xs">
              {s.status === 'purchased' ? 'Edit a copy' : 'Open'}
            </ChipButton>
          </li>
        ))}
      </ul>
      <Link href={libraryHref} className="text-sm font-semibold text-primary hover:underline">
        Open My Signatures
      </Link>
    </div>
  );
}

function HelpPanel({ price }: { price: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-heading">Help</h3>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Type your name and pick a style, or draw or upload your signature.</li>
        <li>Personalize letters, add underlines, loops and flourishes, and draw your own strokes with Smart Stroke.</li>
        <li>Check it on different backgrounds and at actual signing size.</li>
        <li>Sign in, pay {price}, and download transparent PNG, SVG and JPEG files.</li>
      </ol>
      <p className="text-slate-text">Designing and previewing are free. The preview marker is not part of your download.</p>
      <p className="text-slate-text">
        While you design, your work is kept in this browser so you do not lose it. It is sent to us only when you save or download.
      </p>
      <p className="text-slate-text">
        A signature design is artwork. Buying one does not verify your identity, and having the file does not sign a document by itself. Signing on Signature Tender
        still uses the signer&apos;s own verified link or account.
      </p>
    </div>
  );
}
