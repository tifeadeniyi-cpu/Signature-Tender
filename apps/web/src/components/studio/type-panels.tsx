'use client';
import { useEffect, useMemo, useState } from 'react';
import { Heart, Shuffle, Search, X, Columns3 } from 'lucide-react';
import {
  DEFAULT_TEXT_PARAMS,
  FONT_BY_ID,
  FONT_CATEGORIES,
  FAMILY_BY_ID,
  STUDIO_FONTS,
  STYLE_FAMILIES,
  fontAlternates,
  generateVariations,
  newElement,
  renderDesign,
  unsupportedChars,
  type Design,
  type FontCategory,
  type FontProvider,
  type TextParams,
} from '@st/core/studio/index';
import { cn } from '@/lib/cn';
import { ArtworkSvg } from './canvas';
import { ChipButton, PanelSection, Slider, Toggle } from './controls';
import { cssFamily, useLazyFace, useOutlines } from './fonts';
import type { DesignHistory } from './state';

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, v: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

export function NameField({
  history,
  fonts,
  kind,
  onTrack,
}: {
  history: DesignHistory;
  fonts: FontProvider;
  kind: 'signature' | 'initials';
  onTrack: (event: string) => void;
}) {
  const { design } = history;
  const value = design.text?.value ?? '';
  const font = design.text ? fonts.get(design.text.font) : undefined;
  const missing = font ? unsupportedChars(font, value) : [];
  const max = kind === 'initials' ? 5 : 60;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="studio-name" className="text-sm font-semibold text-heading">
        {kind === 'initials' ? 'Your initials (1 to 3 letters)' : 'Your name'}
      </label>
      <input
        id="studio-name"
        value={value}
        maxLength={max}
        autoComplete="off"
        spellCheck={false}
        placeholder={kind === 'initials' ? 'J.L.' : 'Jordan Lee'}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\p{L}\p{M} .,'’&-]/gu, '');
          history.set((d) => ({ ...d, method: d.method === 'draw' || d.method === 'upload' ? 'type' : d.method, text: d.text ? { ...d.text, value: v } : d.text }), false);
        }}
        onBlur={() => {
          history.endDrag();
          if (value) onTrack('design_started');
        }}
        className="h-12 rounded-lg border border-border bg-white px-3 text-lg text-heading outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      {missing.length ? (
        <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
          {FONT_BY_ID[design.text!.font]?.name} has no {missing.map((c) => `“${c}”`).join(' ')}. Those characters are left out of the
          preview. Choose another style or font to include them.
        </p>
      ) : null}
      {kind === 'initials' && value.replace(/[^\p{L}]/gu, '').length > 3 ? (
        <p role="alert" className="text-sm text-error">
          Initials can have up to three letters.
        </p>
      ) : null}
      <p className="text-xs text-slate-text">Your name stays in your browser while you design. It is saved only when you save or download.</p>
    </div>
  );
}

function applyVariant(d: Design, familyId: string, index: number): Design {
  const fam = FAMILY_BY_ID[familyId]!;
  const v = fam.variants[index]!;
  const keep = d.elements.filter((e) => e.type === 'freehand' || !e.id.startsWith('sv'));
  const elements = v.underline ? [...keep, newElement(v.underline, `sv${index}u`, { x: 600, y: 300, scale: 0.85 })] : keep;
  return {
    ...d,
    method: d.method === 'draw' || d.method === 'upload' ? 'type' : d.method,
    pen: v.pen,
    text: d.text
      ? { ...d.text, family: fam.id, variant: index, font: v.font, params: { ...DEFAULT_TEXT_PARAMS, ...v.params } as TextParams }
      : d.text,
    elements,
  };
}

/** The 12 style families, each with four variants rendered with the visitor's own name. */
export function StylePicker({
  history,
  fonts,
  disabledFonts,
  onTrack,
}: {
  history: DesignHistory;
  fonts: FontProvider;
  disabledFonts: string[];
  onTrack: (event: string, props?: Record<string, string>) => void;
}) {
  const { design } = history;
  const name = design.text?.value.trim() || 'Jordan Lee';
  const families = STYLE_FAMILIES.map((f) => ({ ...f, variants: f.variants.filter((v) => !disabledFonts.includes(v.font)) })).filter((f) => f.variants.length);
  const [open, setOpen] = useState<string | null>(design.text?.family ?? null);
  const fam = open ? families.find((f) => f.id === open) : null;
  const { ready } = useOutlines(fam ? fam.variants.map((v) => v.font) : []);
  return (
    <PanelSection title="Signature styles">
      <ul className="grid grid-cols-2 gap-2">
        {families.map((f) => (
          <li key={f.id}>
            <FamilyCard
              label={f.label}
              font={f.variants[0]!.font}
              name={name}
              active={design.text?.family === f.id}
              onClick={() => {
                setOpen(f.id);
                history.set((d) => applyVariant(d, f.id, 0));
                onTrack('font_selected', { family: f.id });
              }}
            />
          </li>
        ))}
      </ul>
      {fam ? (
        <div className="rounded-xl border border-border bg-ivory/60 p-3" data-ready={ready}>
          <p className="text-sm font-semibold text-heading">{fam.label} variations</p>
          <p className="text-xs text-slate-text">{fam.description}</p>
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {fam.variants.map((v, i) => {
              const d = applyVariant({ ...design, text: design.text ? { ...design.text, value: name } : design.text, elements: [] }, fam.id, i);
              const r = renderDesign({ ...d, method: 'type' }, fonts);
              const active = design.text?.family === fam.id && design.text.variant === i;
              return (
                <li key={v.label}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => history.set((x) => applyVariant(x, fam.id, i))}
                    className={cn(
                      'flex h-24 w-full flex-col items-stretch justify-between rounded-lg border bg-white p-2 text-left',
                      active ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40',
                    )}
                  >
                    {r.paths.length ? (
                      <ArtworkSvg rendered={r} className="h-14 [&>svg]:mx-auto [&>svg]:h-14 [&>svg]:w-auto" label={`${v.label} preview`} />
                    ) : (
                      <span className="h-14 animate-pulse rounded bg-cream" />
                    )}
                    <span className="truncate text-xs font-medium text-heading">{v.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </PanelSection>
  );
}

function FamilyCard({ label, font, name, active, onClick }: { label: string; font: string; name: string; active: boolean; onClick: () => void }) {
  const { ref, loaded } = useLazyFace(font);
  const meta = FONT_BY_ID[font]!;
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-20 w-full flex-col justify-between overflow-hidden rounded-lg border bg-white px-2 py-1.5 text-left',
        active ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40',
      )}
    >
      <span
        className={cn('block truncate leading-snug text-primary transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
        style={{ fontFamily: cssFamily(font), fontSize: `${1.6 * meta.scale}rem` }}
        aria-hidden
      >
        {name}
      </span>
      <span className="truncate text-xs font-semibold text-heading">{label}</span>
    </button>
  );
}

/** Curated font library: search, categories, favourites, recently used, compare and randomize. */
export function FontLibrary({
  history,
  disabledFonts,
  featured,
  onTrack,
}: {
  history: DesignHistory;
  disabledFonts: string[];
  featured: string[];
  onTrack: (event: string, props?: Record<string, string>) => void;
}) {
  const { design } = history;
  const name = design.text?.value.trim() || 'Jordan Lee';
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<FontCategory | 'all' | 'favorites' | 'recent'>('all');
  const [favs, setFavs] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  // Favourites live in this browser only; read after mount so hydration matches.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setFavs(store.get('st_studio_favs', []));
    setRecent(store.get('st_studio_recent', []));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  const fonts = useMemo(() => {
    const all = STUDIO_FONTS.filter((f) => !disabledFonts.includes(f.id));
    const byQ = all.filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase()));
    const list =
      cat === 'all' ? byQ : cat === 'favorites' ? byQ.filter((f) => favs.includes(f.id)) : cat === 'recent' ? recent.map((id) => byQ.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f) : byQ.filter((f) => f.category === cat);
    return cat === 'all' ? [...list].sort((a, b) => Number(featured.includes(b.id)) - Number(featured.includes(a.id))) : list;
  }, [q, cat, favs, recent, disabledFonts, featured]);

  const choose = (id: string) => {
    history.set((d) => ({ ...d, method: d.method === 'draw' || d.method === 'upload' ? 'type' : d.method, text: d.text ? { ...d.text, font: id, family: null } : d.text }));
    const r = [id, ...recent.filter((x) => x !== id)].slice(0, 8);
    setRecent(r);
    store.set('st_studio_recent', r);
    onTrack('font_selected', { font: id });
  };
  const toggleFav = (id: string) => {
    const f = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    setFavs(f);
    store.set('st_studio_favs', f);
  };
  const randomize = () => {
    const pool = fonts.length ? fonts : STUDIO_FONTS;
    const seed = (Date.now() / 1000) | 0;
    choose(pool[seed % pool.length]!.id);
  };

  return (
    <PanelSection
      title="Font library"
      action={
        <button type="button" onClick={randomize} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          <Shuffle className="size-4" aria-hidden /> Randomize
        </button>
      }
    >
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-text" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search fonts"
          aria-label="Search fonts"
          className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Font categories">
        {(
          [
            ['all', 'All'],
            ...FONT_CATEGORIES.map((c) => [c.id, c.label] as const),
            ['favorites', 'Favorites'],
            ['recent', 'Recently used'],
          ] as const
        ).map(([id, label]) => (
          <ChipButton key={id} active={cat === id} onClick={() => setCat(id)} className="min-h-8 px-2.5 py-1 text-xs">
            {label}
          </ChipButton>
        ))}
      </div>
      {compare.length ? (
        <div className="rounded-xl border border-border bg-ivory/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-heading">Compare</p>
            <button type="button" onClick={() => setCompare([])} className="text-xs font-semibold text-primary hover:underline">
              Clear
            </button>
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {compare.map((id) => (
              <CompareRow key={id} id={id} name={name} onUse={() => choose(id)} onRemove={() => setCompare(compare.filter((x) => x !== id))} />
            ))}
          </ul>
        </div>
      ) : null}
      {fonts.length === 0 ? (
        <p className="text-sm text-slate-text">{cat === 'favorites' ? 'Tap the heart on a font to keep it here.' : 'No fonts match.'}</p>
      ) : (
        <ul className="grid max-h-[28rem] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {fonts.map((f) => (
            <li key={f.id}>
              <FontCard
                id={f.id}
                name={name}
                active={design.text?.font === f.id}
                fav={favs.includes(f.id)}
                comparing={compare.includes(f.id)}
                onChoose={() => choose(f.id)}
                onPreview={() => onTrack('font_previewed', { font: f.id })}
                onFav={() => toggleFav(f.id)}
                onCompare={() => setCompare(compare.includes(f.id) ? compare.filter((x) => x !== f.id) : [...compare, f.id].slice(-3))}
              />
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

function FontCard(p: {
  id: string;
  name: string;
  active: boolean;
  fav: boolean;
  comparing: boolean;
  onChoose: () => void;
  onPreview: () => void;
  onFav: () => void;
  onCompare: () => void;
}) {
  const { ref, loaded } = useLazyFace(p.id);
  const meta = FONT_BY_ID[p.id]!;
  return (
    <div
      ref={ref}
      className={cn('rounded-lg border bg-white p-2', p.active ? 'border-primary ring-2 ring-primary/20' : 'border-border')}
      onMouseEnter={p.onPreview}
    >
      <button type="button" onClick={p.onChoose} aria-pressed={p.active} className="block w-full text-left" aria-label={`Use ${meta.name}`}>
        <span
          aria-hidden
          className={cn('block h-12 truncate leading-[3rem] text-primary transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
          style={{ fontFamily: cssFamily(p.id), fontSize: `${1.7 * meta.scale}rem` }}
        >
          {p.name}
        </span>
      </button>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="truncate text-xs font-medium text-heading">
          {meta.name}
          <span className="ml-1 text-slate-text">· {FONT_CATEGORIES.find((c) => c.id === meta.category)?.label}</span>
        </span>
        <span className="flex shrink-0 gap-0.5">
          <button type="button" onClick={p.onCompare} aria-pressed={p.comparing} aria-label={`Compare ${meta.name}`} className={cn('rounded p-1.5 hover:bg-cream', p.comparing && 'text-primary')}>
            <Columns3 className="size-4" aria-hidden />
          </button>
          <button type="button" onClick={p.onFav} aria-pressed={p.fav} aria-label={`${p.fav ? 'Remove' : 'Add'} ${meta.name} ${p.fav ? 'from' : 'to'} favorites`} className="rounded p-1.5 hover:bg-cream">
            <Heart className={cn('size-4', p.fav && 'fill-[#7F1D3A] text-[#7F1D3A]')} aria-hidden />
          </button>
        </span>
      </div>
    </div>
  );
}

function CompareRow({ id, name, onUse, onRemove }: { id: string; name: string; onUse: () => void; onRemove: () => void }) {
  const { ref, loaded } = useLazyFace(id);
  const meta = FONT_BY_ID[id]!;
  return (
    <li ref={ref} className="flex items-center gap-2 rounded-lg bg-white p-2">
      <span className={cn('min-w-0 flex-1 truncate text-primary', loaded ? 'opacity-100' : 'opacity-0')} style={{ fontFamily: cssFamily(id), fontSize: `${1.5 * meta.scale}rem` }} aria-hidden>
        {name}
      </span>
      <span className="sr-only">{meta.name}</span>
      <button type="button" onClick={onUse} className="text-xs font-semibold text-primary hover:underline">
        Use
      </button>
      <button type="button" onClick={onRemove} aria-label={`Remove ${meta.name} from compare`} className="rounded p-1 hover:bg-cream">
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

/** Letter personalisation: every control maps to a real, deterministic layout parameter. */
export function Personalize({ history, fonts }: { history: DesignHistory; fonts: FontProvider }) {
  const { design } = history;
  if (!design.text) return null;
  const p = design.text.params;
  const font = fonts.get(design.text.font);
  const alts = font ? fontAlternates(font) : { init: false, fina: false };
  const set = (patch: Partial<TextParams>, commit = false) =>
    history.set((d) => (d.text ? { ...d, text: { ...d.text, params: { ...d.text.params, ...patch } } } : d), commit);
  const end = () => history.endDrag();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <>
      <PanelSection title="Personalize letters" collapsible>
        <Slider label="Capital size" value={p.capitals} min={0.8} max={1.9} step={0.05} format={pct} onChange={(v) => set({ capitals: v })} onCommit={end} />
        <Slider label="Lowercase size" value={p.lower} min={0.7} max={1.3} step={0.02} format={pct} onChange={(v) => set({ lower: v })} onCommit={end} />
        <Slider label="Slant" value={p.slant} min={-15} max={30} step={1} format={(v) => `${v}°`} onChange={(v) => set({ slant: v })} onCommit={end} />
        <Slider label="Character spacing" value={p.spacing} min={-0.15} max={0.6} step={0.01} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => set({ spacing: v })} onCommit={end} />
        <Slider label="Name spacing" value={p.wordSpacing} min={0} max={1} step={0.02} format={pct} onChange={(v) => set({ wordSpacing: v })} onCommit={end} />
        <Slider label="Connections" value={p.connect} min={0} max={1} step={0.05} format={pct} onChange={(v) => set({ connect: v })} onCommit={end} hint="Draws letters closer so cursive joins meet." />
        <Slider label="Baseline variation" value={p.baseline} min={0} max={10} step={0.5} onChange={(v) => set({ baseline: v })} onCommit={end} />
      </PanelSection>
      <PanelSection title="Proportions" collapsible defaultOpen={false}>
        <Slider label="Height" value={p.height} min={0.6} max={1.5} step={0.02} format={pct} onChange={(v) => set({ height: v })} onCommit={end} />
        <Slider label="Width" value={p.width} min={0.6} max={1.6} step={0.02} format={pct} onChange={(v) => set({ width: v })} onCommit={end} />
        <Slider label="Ink weight" value={p.weight} min={0} max={3} step={0.1} onChange={(v) => set({ weight: v })} onCommit={end} />
        <Slider label="Descender length" value={p.descenders} min={-0.5} max={1} step={0.05} format={pct} onChange={(v) => set({ descenders: v })} onCommit={end} />
      </PanelSection>
      <PanelSection title="Strokes and letterforms" collapsible defaultOpen={false}>
        <Toggle label="Entry stroke" checked={p.entry} onChange={(v) => set({ entry: v }, true)} hint="A lead-in stroke into the first capital." />
        <Toggle label="Finishing tail" checked={p.tail} onChange={(v) => set({ tail: v }, true)} />
        <Slider label="Curve intensity" value={p.curve} min={0} max={100} onChange={(v) => set({ curve: v })} onCommit={end} />
        <Slider label="Loop intensity" value={p.loop} min={0} max={100} onChange={(v) => set({ loop: v })} onCommit={end} />
        {alts.init || alts.fina ? (
          <>
            {alts.init ? <Toggle label="Initial letter alternates" checked={p.initForms} onChange={(v) => set({ initForms: v }, true)} hint="This font has real starting-letter forms." /> : null}
            {alts.fina ? <Toggle label="Final letter alternates" checked={p.finaForms} onChange={(v) => set({ finaForms: v }, true)} hint="This font has real ending-letter forms." /> : null}
          </>
        ) : (
          <p className="text-xs text-slate-text">This font has no alternate letterforms, so none are offered.</p>
        )}
      </PanelSection>
    </>
  );
}

/** "Generate Variations": deterministic, editable alternatives of the current typed signature. */
export function Variations({ history, fonts, onTrack }: { history: DesignHistory; fonts: FontProvider; onTrack: (e: string) => void }) {
  const [round, setRound] = useState<number | null>(null);
  const { design } = history;
  const vars = useMemo(() => (round === null ? [] : generateVariations(design, round)), [design, round]);
  if (!design.text?.value.trim()) return null;
  return (
    <PanelSection
      title="Variations"
      action={
        <button
          type="button"
          onClick={() => {
            setRound((r) => (r === null ? 0 : r + 1));
            onTrack('variation_generated');
          }}
          className="text-sm font-semibold text-primary hover:underline"
        >
          {round === null ? 'Generate Variations' : 'More'}
        </button>
      }
    >
      {vars.length ? (
        <ul className="grid grid-cols-2 gap-2">
          {vars.map((v) => {
            const r = renderDesign(v.design, fonts);
            return (
              <li key={v.label}>
                <button
                  type="button"
                  onClick={() => history.set(() => v.design)}
                  className="flex h-24 w-full flex-col justify-between rounded-lg border border-border bg-white p-2 text-left hover:border-primary/40"
                >
                  <ArtworkSvg rendered={r} className="h-14 [&>svg]:mx-auto [&>svg]:h-14 [&>svg]:w-auto" label={`${v.label} preview`} />
                  <span className="truncate text-xs font-medium text-heading">{v.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-text">Six fresh takes on your signature in this font. Pick one and keep editing.</p>
      )}
    </PanelSection>
  );
}
