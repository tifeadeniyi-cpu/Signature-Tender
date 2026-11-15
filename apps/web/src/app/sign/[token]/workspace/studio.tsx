'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Eraser,
  ImageUp,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import {
  FAMILIES,
  INKS,
  hasInk,
  initialsOf,
  renderSignature,
  trim,
  type Ink,
  type StyleParams,
} from './render';

export type Font = { id: string; family: string };
type Method = 'typed' | 'drawn' | 'uploaded';
export type Adopted = {
  method: Method;
  pngBase64: string;
  typedText?: string;
  font?: string;
  style?: { family: string; variation: number; params: Record<string, number | string> };
};
export type Mark = { id: string; dataUrl: string };
/** A Signature Studio design the signer bought (server-rendered preview). */
export type PurchasedDesign = { id: string; name: string; svg: string };

const PAD_W = 1200;
const PAD_H = 400;

type Point = { x: number; y: number; p: number };

function strokePath(ctx: CanvasRenderingContext2D, pts: Point[], color: string) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0]!.x, pts[0]!.y, 4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Midpoint quadratic smoothing; width follows stylus pressure where the device reports it.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const prevMid = i > 1 ? mid(pts[i - 2]!, a) : a;
    const m = mid(a, b);
    ctx.beginPath();
    ctx.lineWidth = 3 + 6 * ((a.p + b.p) / 2);
    ctx.moveTo(prevMid.x, prevMid.y);
    ctx.quadraticCurveTo(a.x, a.y, m.x, m.y);
    ctx.stroke();
  }
}
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: b.p });

const toBase64 = (c: HTMLCanvasElement) => c.toDataURL('image/png').split(',')[1]!;

/**
 * Signature Studio, embedded in the signing panel. Type (six families with deterministic
 * customization), Draw or Upload. Nothing becomes a signature until "Use This Signature".
 */
export function SignatureStudio({
  kind,
  name,
  fonts,
  adopted,
  activeField,
  unappliedCount,
  onAdopt,
  purchased = [],
  onApply,
  busy,
  error,
  autoAdvance,
  onAutoAdvance,
}: {
  kind: 'signature' | 'initials';
  name: string;
  fonts: Font[];
  adopted: Mark | undefined;
  /** The signer's purchased Studio designs of this kind. */
  purchased?: PurchasedDesign[];
  /** The selected field of this kind, if any, and whether the adopted mark is already on it. */
  activeField: { id: string; applied: boolean } | null;
  /** This recipient's fields of this kind that do not have the adopted mark yet. */
  unappliedCount: number;
  onAdopt: (a: Adopted | { designId: string }, scope: 'field' | 'none') => void;
  onApply: (scope: 'field' | 'all') => void;
  busy: boolean;
  error: string | null;
  autoAdvance: boolean;
  onAutoAdvance: (v: boolean) => void;
}) {
  const label = kind === 'initials' ? 'initials' : 'signature';
  const Label = kind === 'initials' ? 'Initials' : 'Signature';
  // The parent keys this component by kind and adopted mark, so a new adoption resets it.
  const [wantCreate, setWantCreate] = useState(false);
  const creating = !adopted || wantCreate;
  // Confirmation applies only to the field that was selected when it was opened.
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const here = activeField?.id ?? 'none';
  const confirmAll = confirmFor === here;
  const setConfirmAll = (v: boolean) => setConfirmFor(v ? here : null);

  if (adopted && !creating) {
    return (
      <section aria-labelledby="studio-title" className="flex flex-col gap-3">
        <StudioHeading id="studio-title" />
        <p className="text-sm">Your adopted {label} for this document:</p>
        <div className="flex h-28 items-center justify-center rounded-xl border border-border bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={adopted.dataUrl}
            alt={`Your adopted ${label}`}
            className="max-h-full max-w-full object-contain"
          />
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {activeField && !activeField.applied ? (
          <Button type="button" size="lg" loading={busy} onClick={() => onApply('field')}>
            Apply to selected field <Check className="size-4" aria-hidden />
          </Button>
        ) : activeField ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <Check className="size-4" aria-hidden /> Applied to the selected field.
          </p>
        ) : (
          <p className="text-sm">Select a {label} field on the document to apply it.</p>
        )}
        {unappliedCount > (activeField && !activeField.applied ? 1 : 0) ? (
          confirmAll ? (
            <div className="rounded-lg border border-rose-gold bg-blush/50 p-3 text-sm">
              <p className="text-heading">
                Apply this {label} to all {unappliedCount} of your remaining {label} fields in this
                document? Only fields assigned to you are changed.
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  loading={busy}
                  onClick={() => {
                    onApply('all');
                    setConfirmAll(false);
                  }}
                >
                  Apply to all {unappliedCount}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirmAll(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setConfirmAll(true)}>
              Apply to all my {label} fields…
            </Button>
          )
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <button
            type="button"
            className="font-semibold text-primary underline-offset-2 hover:underline"
            onClick={() => setWantCreate(true)}
          >
            Change {label} style
          </button>
        </div>
        <AutoAdvance value={autoAdvance} onChange={onAutoAdvance} />
      </section>
    );
  }

  return (
    <Creator
      key={kind}
      kind={kind}
      label={label}
      Label={Label}
      name={name}
      fonts={fonts}
      busy={busy}
      error={error}
      hasActiveField={Boolean(activeField)}
      onCancel={adopted ? () => setWantCreate(false) : undefined}
      onAdopt={(a) => onAdopt(a, activeField ? 'field' : 'none')}
      purchased={purchased}
      autoAdvance={autoAdvance}
      onAutoAdvance={onAutoAdvance}
    />
  );
}

function StudioHeading({ id }: { id: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 id={id} className="font-display text-2xl text-primary">
        Signature Studio
      </h2>
      <Sparkles className="size-5 text-rose-gold" aria-hidden />
    </div>
  );
}

function AutoAdvance({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-text">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary"
      />
      Go to the next required field after applying
    </label>
  );
}

function Creator({
  kind,
  label,
  Label,
  name,
  fonts,
  busy,
  error,
  hasActiveField,
  onCancel,
  onAdopt,
  purchased,
  autoAdvance,
  onAutoAdvance,
}: {
  kind: 'signature' | 'initials';
  label: string;
  Label: string;
  name: string;
  fonts: Font[];
  busy: boolean;
  error: string | null;
  hasActiveField: boolean;
  onCancel?: () => void;
  onAdopt: (a: Adopted | { designId: string }) => void;
  purchased: PurchasedDesign[];
  autoAdvance: boolean;
  onAutoAdvance: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<Method | 'library'>(purchased.length ? 'library' : 'typed');
  const [localError, setLocalError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(purchased[0]?.id ?? null);
  const tabs: { id: Method | 'library'; label: string }[] = [
    ...(purchased.length ? [{ id: 'library' as const, label: 'Mine' }] : []),
    { id: 'typed', label: 'Type' },
    { id: 'drawn', label: 'Draw' },
    { id: 'uploaded', label: 'Upload' },
  ];
  const typed = useRef<() => Adopted | string>(() => 'Type your name.');
  const drawn = useRef<() => Adopted | string>(() => `Draw your ${label} in the box.`);
  const uploaded = useRef<() => Adopted | string>(() => 'Choose an image to upload.');

  function adopt() {
    setLocalError(null);
    if (tab === 'library') {
      if (!chosen) return setLocalError(`Choose one of your ${label}s.`);
      return onAdopt({ designId: chosen });
    }
    const get = tab === 'typed' ? typed : tab === 'drawn' ? drawn : uploaded;
    try {
      const r = get.current();
      if (typeof r === 'string') return setLocalError(r);
      onAdopt(r);
    } catch {
      setLocalError(`Your ${label} could not be created. Try again, or use another tab.`);
    }
  }

  const onKeyTabs = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
    setTab(next.id);
    document.getElementById(`studio-tab-${next.id}`)?.focus();
  };

  return (
    <section aria-labelledby="studio-title" className="flex flex-col gap-3">
      <StudioHeading id="studio-title" />
      {kind === 'initials' ? <p className="text-sm text-heading">Create your initials.</p> : null}
      <div
        role="tablist"
        aria-label={`How to create your ${label}`}
        className={cn('grid gap-1 rounded-full bg-blush/60 p-1', tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}
        onKeyDown={onKeyTabs}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`studio-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`studio-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
              tab === t.id ? 'bg-primary text-white shadow-card' : 'text-heading hover:bg-white',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        id={`studio-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`studio-tab-${tab}`}
        className="flex flex-col gap-3"
      >
        {tab === 'library' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm text-heading">
              My Signatures from Signature Studio. Using one adds no fee.
            </legend>
            {purchased.map((d) => (
              <label
                key={d.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-2',
                  chosen === d.id ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="studio-design"
                  value={d.id}
                  checked={chosen === d.id}
                  onChange={() => setChosen(d.id)}
                  className="size-4 accent-primary"
                />
                <span
                  aria-hidden
                  className="flex h-14 flex-1 items-center justify-center [&>svg]:h-auto [&>svg]:max-h-14 [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: d.svg }}
                />
                <span className="sr-only">{d.name}</span>
              </label>
            ))}
          </fieldset>
        ) : tab === 'typed' ? (
          <TypePanel kind={kind} label={label} name={name} fonts={fonts} getterRef={typed} />
        ) : tab === 'drawn' ? (
          <DrawPanel label={label} getterRef={drawn} />
        ) : (
          <UploadPanel label={label} getterRef={uploaded} />
        )}
      </div>

      {localError || error ? <Alert tone="error">{localError || error}</Alert> : null}
      <Button type="button" size="lg" onClick={adopt} loading={busy} className="w-full">
        Use This {Label === 'Initials' ? 'Initials' : 'Signature'}{' '}
        <Check className="size-4" aria-hidden />
      </Button>
      <p className="text-xs">
        By selecting &ldquo;Use This {Label === 'Initials' ? 'Initials' : 'Signature'}&rdquo;, I
        agree that this mark is my electronic {label} for this document
        {hasActiveField ? ', and it will be placed in the selected field' : ''}. It is not applied
        to any other field unless I choose to.
      </p>
      <AutoAdvance value={autoAdvance} onChange={onAutoAdvance} />
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="self-start text-sm font-semibold text-primary hover:underline"
        >
          Keep my current {label}
        </button>
      ) : null}
    </section>
  );
}

const DEFAULT_FAMILY = 'modern';

function TypePanel({
  kind,
  label,
  name,
  fonts,
  getterRef,
}: {
  kind: 'signature' | 'initials';
  label: string;
  name: string;
  fonts: Font[];
  getterRef: React.MutableRefObject<() => Adopted | string>;
}) {
  const [text, setText] = useState(kind === 'initials' ? initialsOf(name) : name);
  const [familyId, setFamilyId] = useState(DEFAULT_FAMILY);
  const [base, setBase] = useState(0);
  const [variation, setVariation] = useState(0);
  const family = FAMILIES.find((f) => f.id === familyId)!;
  const [params, setParams] = useState<StyleParams>(family.defaults);
  const [customize, setCustomize] = useState(false);
  const [ready, setReady] = useState(false);
  const fontOf = useCallback(
    (fontId: string) => fonts.find((f) => f.id === fontId)?.family ?? 'cursive',
    [fonts],
  );

  // Wait for every face so previews (and the adopted image) use the real font, not a fallback.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      FAMILIES.map((f) =>
        document.fonts.load(`80px ${fontOf(f.font).split(',')[0]}`).catch(() => null),
      ),
    ).finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [fontOf]);

  const shown = text.trim() || (kind === 'initials' ? 'AM' : 'Your Name');
  const seed = base + variation;
  const preview = useMemo(() => {
    if (!ready || typeof document === 'undefined') return null;
    return renderSignature(shown, fontOf(family.font), family.scale, params, seed);
  }, [ready, shown, fontOf, family, params, seed]);
  const thumbs = useMemo(() => {
    if (!ready) return [];
    return [0, 1, 2].map((v) =>
      renderSignature(shown, fontOf(family.font), family.scale, params, base + v).toDataURL(),
    );
  }, [ready, shown, fontOf, family, params, base]);

  useEffect(() => {
    getterRef.current = () => {
      if (!text.trim()) return `Type your ${label}.`;
      if (!preview) return `Your ${label} is still loading. Try again in a moment.`;
      return {
        method: 'typed',
        typedText: text.trim(),
        font: family.font,
        pngBase64: toBase64(preview),
        style: { family: family.id, variation: seed, params: { ...params } },
      };
    };
  });

  const set = <K extends keyof StyleParams>(k: K, v: StyleParams[K]) =>
    setParams((p) => ({ ...p, [k]: v }));

  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-medium text-heading">
        {kind === 'initials' ? 'Your initials' : 'Your full name'}
        <input
          value={text}
          maxLength={kind === 'initials' ? 6 : 80}
          onChange={(e) => setText(e.target.value)}
          className="h-10 rounded-lg border border-border px-3 font-normal"
          autoComplete="name"
        />
      </label>
      <div
        className="flex h-28 items-center justify-center overflow-hidden rounded-xl border border-border bg-white px-3"
        aria-live="polite"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.toDataURL()}
            alt={`Preview of your ${label} in ${family.label} style`}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-sm">Loading styles…</span>
        )}
      </div>
      <label className="flex items-center gap-3 text-sm font-medium text-heading">
        Style
        <select
          value={familyId}
          onChange={(e) => {
            const f = FAMILIES.find((x) => x.id === e.target.value)!;
            setFamilyId(f.id);
            setParams(f.defaults);
            setVariation(0);
          }}
          className="h-10 flex-1 rounded-lg border border-border bg-white px-3 font-normal"
        >
          {FAMILIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div role="radiogroup" aria-label="Variation" className="grid grid-cols-3 gap-2">
        {thumbs.map((src, v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={variation === v}
            aria-label={`Variation ${v + 1}`}
            onClick={() => setVariation(v)}
            className={cn(
              'flex h-14 items-center justify-center rounded-lg border bg-white p-1.5',
              variation === v ? 'border-2 border-primary' : 'border-border hover:border-rose-gold',
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="max-h-full max-w-full object-contain" />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setBase((b) => b + 3);
            setVariation(0);
          }}
        >
          <RefreshCw className="size-3.5" aria-hidden /> New variations
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={customize}
          aria-controls="studio-customize"
          onClick={() => setCustomize((c) => !c)}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden /> Customize Style
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setParams(family.defaults);
            setBase(0);
            setVariation(0);
          }}
        >
          <RotateCcw className="size-3.5" aria-hidden /> Reset
        </Button>
      </div>
      {customize ? (
        <fieldset
          id="studio-customize"
          className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-ivory p-3 sm:grid-cols-2"
        >
          <legend className="px-1 text-sm font-semibold text-heading">Customize style</legend>
          <Range
            label="Letter slant"
            min={-15}
            max={25}
            value={params.slant}
            onChange={(v) => set('slant', v)}
            unit="°"
          />
          <Range
            label="Stroke thickness"
            min={0}
            max={3}
            step={0.2}
            value={params.thickness}
            onChange={(v) => set('thickness', v)}
          />
          <Range
            label="Character spacing"
            min={0}
            max={10}
            value={params.spacing}
            onChange={(v) => set('spacing', v)}
          />
          <Range
            label="Curve intensity"
            min={0}
            max={100}
            step={5}
            value={params.curve}
            onChange={(v) => set('curve', v)}
          />
          <Range
            label="Baseline movement"
            min={0}
            max={10}
            value={params.baseline}
            onChange={(v) => set('baseline', v)}
          />
          <Choice
            label="Loop style"
            value={params.loop}
            onChange={(v) => set('loop', v)}
            options={[
              ['none', 'None'],
              ['single', 'Single loop'],
              ['double', 'Double loop'],
            ]}
          />
          <Choice
            label="Capital letters"
            value={params.capitals}
            onChange={(v) => set('capitals', v)}
            options={[
              ['natural', 'Natural'],
              ['large', 'Enlarged'],
              ['swash', 'Swash'],
            ]}
          />
          <Choice
            label="Underline flourish"
            value={params.underline}
            onChange={(v) => set('underline', v)}
            options={[
              ['none', 'None'],
              ['simple', 'Simple'],
              ['swoosh', 'Swoosh'],
            ]}
          />
          <Choice
            label="Finishing stroke"
            value={params.finish}
            onChange={(v) => set('finish', v)}
            options={[
              ['none', 'None'],
              ['tail', 'Tail'],
            ]}
          />
          <Choice
            label="Ink"
            value={params.ink}
            onChange={(v) => set('ink', v as Ink)}
            options={Object.entries(INKS).map(([k, i]) => [k, i.label])}
          />
          <p className="text-xs sm:col-span-2">
            Loop style applies when an underline flourish is on.
          </p>
        </fieldset>
      ) : null}
    </>
  );
}

function Range({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-heading">
      <span className="flex justify-between">
        {label}
        <span className="font-normal text-slate-text">
          {Number.isInteger(step) ? value : value.toFixed(1)}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-primary"
      />
    </label>
  );
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-heading">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 rounded-lg border border-border bg-white px-2 font-normal"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function DrawPanel({
  label,
  getterRef,
}: {
  label: string;
  getterRef: React.MutableRefObject<() => Adopted | string>;
}) {
  const pad = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const current = useRef<Point[] | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const color = INKS.navy.color;

  const redraw = useCallback(
    (all: Point[][]) => {
      const c = pad.current;
      if (!c) return;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, PAD_W, PAD_H);
      for (const s of all) strokePath(ctx, s, color);
    },
    [color],
  );
  useEffect(() => redraw(strokes), [strokes, redraw]);

  function point(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return {
      x: ((e.clientX - r.left) / r.width) * PAD_W,
      y: ((e.clientY - r.top) / r.height) * PAD_H,
      p,
    };
  }

  useEffect(() => {
    getterRef.current = () => {
      const c = pad.current;
      if (!c || strokes.length === 0 || !hasInk(c)) return `Draw your ${label} in the box.`;
      return { method: 'drawn', pngBase64: toBase64(trim(c, 12)) };
    };
  });

  return (
    <>
      <canvas
        ref={pad}
        width={PAD_W}
        height={PAD_H}
        aria-label={`Drawing area for your ${label}. Use a mouse, finger, stylus or trackpad. If you can't draw, use the Type tab.`}
        role="img"
        className="aspect-[3/1] w-full touch-none rounded-xl border border-dashed border-primary bg-white"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          current.current = [point(e)];
          setPreview(null);
        }}
        onPointerMove={(e) => {
          if (!current.current) return;
          const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
          const r = e.currentTarget.getBoundingClientRect();
          for (const ev of events) {
            current.current.push({
              x: ((ev.clientX - r.left) / r.width) * PAD_W,
              y: ((ev.clientY - r.top) / r.height) * PAD_H,
              p: ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5,
            });
          }
          redraw([...strokes, current.current]);
        }}
        onPointerUp={() => {
          if (current.current) setStrokes((s) => [...s, current.current!]);
          current.current = null;
        }}
        onPointerCancel={() => {
          current.current = null;
          redraw(strokes);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!strokes.length}
          onClick={() => setStrokes((s) => s.slice(0, -1))}
        >
          <Undo2 className="size-3.5" aria-hidden /> Undo stroke
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!strokes.length}
          onClick={() => {
            setStrokes([]);
            setPreview(null);
          }}
        >
          <Eraser className="size-3.5" aria-hidden /> Clear
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!strokes.length}
          onClick={() => pad.current && setPreview(trim(pad.current, 12).toDataURL())}
        >
          Preview
        </Button>
      </div>
      {preview ? (
        <div className="flex h-20 items-center justify-center rounded-lg border border-border bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt={`Preview of your drawn ${label}`}
            className="max-h-full object-contain"
          />
        </div>
      ) : null}
    </>
  );
}

const MAX_UPLOAD = 5 * 1024 * 1024;

function UploadPanel({
  label,
  getterRef,
}: {
  label: string;
  getterRef: React.MutableRefObject<() => Adopted | string>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [removeBg, setRemoveBg] = useState(true);
  const [size, setSize] = useState(100);
  const [problem, setProblem] = useState<string | null>(null);

  const processed = useMemo(() => {
    if (!img) return null;
    // Redrawing on a canvas converts JPEG to PNG and drops metadata; the server sanitizes again.
    const scale = Math.min(PAD_W / img.width, PAD_H / img.height, 1) * (size / 100);
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(img.width * scale));
    c.height = Math.max(8, Math.round(img.height * scale));
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (removeBg) {
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const lum = (d.data[i]! + d.data[i + 1]! + d.data[i + 2]!) / 3;
        if (lum > 215) d.data[i + 3] = 0;
      }
      ctx.putImageData(d, 0, 0);
    }
    return trim(c, 8);
  }, [img, removeBg, size]);

  function choose(f: File | undefined) {
    setProblem(null);
    if (!f) return;
    if (!['image/png', 'image/jpeg'].includes(f.type))
      return setProblem('Upload a PNG or JPEG image.');
    if (f.size > MAX_UPLOAD) return setProblem('The image must be 5 MB or smaller.');
    const url = URL.createObjectURL(f);
    const el = new Image();
    el.onload = () => {
      URL.revokeObjectURL(url);
      if (el.width < 20 || el.height < 10) return setProblem('That image is too small to use.');
      if (el.width * el.height > 40_000_000) return setProblem('That image is too large.');
      setImg(el);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      setProblem('That file could not be read as an image.');
    };
    el.src = url;
  }

  useEffect(() => {
    getterRef.current = () => {
      if (problem) return problem;
      if (!processed || !hasInk(processed))
        return img
          ? 'No signature was found in that image. Try another one.'
          : 'Choose an image to upload.';
      return { method: 'uploaded', pngBase64: toBase64(processed) };
    };
  });

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        aria-label={`${label === 'initials' ? 'Initials' : 'Signature'} image (PNG or JPEG, up to 5 MB)`}
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
          <ImageUp className="size-3.5" aria-hidden /> {img ? 'Replace image' : 'Upload image'}
        </Button>
        {img ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setImg(null)}>
            Clear
          </Button>
        ) : null}
      </div>
      <p className="text-xs">PNG or JPEG, up to 5 MB.</p>
      {problem ? <Alert tone="error">{problem}</Alert> : null}
      {processed ? (
        <>
          <div className="flex h-28 items-center justify-center rounded-xl border border-border bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={processed.toDataURL()}
              alt="Uploaded signature preview"
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-heading">
            Resize ({size}%)
            <input
              type="range"
              min={30}
              max={100}
              step={5}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="accent-primary"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-heading">
            <input
              type="checkbox"
              checked={removeBg}
              onChange={(e) => setRemoveBg(e.target.checked)}
              className="size-4 accent-primary"
            />
            Remove white background
          </label>
        </>
      ) : null}
      <p className="text-xs">
        An uploaded image is a picture of your mark. It does not by itself prove who you are.
      </p>
    </>
  );
}
