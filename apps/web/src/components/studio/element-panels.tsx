'use client';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, FlipHorizontal2, FlipVertical2, Link2, PenLine, RotateCcw, Spline, Trash2 } from 'lucide-react';
import {
  DEFAULT_SMART,
  ELEMENT_TYPES,
  emptyDesign,
  fitAnchors,
  newElement,
  renderDesign,
  smartStrokePoints,
  suggestConnection,
  type Anchor,
  type Design,
  type DesignElement,
  type ElementType,
  type Rendered,
  type SmartSettings,
} from '@st/core/studio/index';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { ArtworkSvg } from './canvas';
import { ChipButton, PanelSection, Slider, Toggle } from './controls';
import { clamp, newId, round1, updateElement, type DesignHistory } from './state';

const noFonts = { get: () => undefined };

function thumb(type: ElementType): Rendered {
  const d = emptyDesign();
  d.text = null;
  d.method = 'design';
  d.elements = [newElement(type, 'th00', { x: 600, y: 200, scale: 0.8 })];
  return renderDesign(d, noFonts);
}

/** Where a new element goes: under the signature for underlines, beside it for flourishes. */
function placeFor(type: ElementType, r: Rendered) {
  const b = r.boxes.text ?? r.boxes.drawing ?? r.boxes.upload;
  if (!b || !isFinite(b.minX)) return { x: 600, y: 300, scale: 0.8 };
  const w = b.maxX - b.minX;
  const g = ELEMENT_TYPES.find((e) => e.id === type)!.group;
  if (g === 'underline') return { x: (b.minX + b.maxX) / 2, y: Math.min(380, b.maxY + 18), scale: clamp((w * 1.05) / 600, 0.3, 1.6) };
  if (type === 'f-opening' || type === 'l-initial') return { x: b.minX + 40, y: (b.minY + b.maxY) / 2, scale: 0.5 };
  return { x: Math.min(1120, b.maxX + 30), y: (b.minY + b.maxY) / 2 + 20, scale: 0.55 };
}

export function ElementsPanel({
  history,
  rendered,
  disabled,
  onSelect,
  onDrawFreehand,
}: {
  history: DesignHistory;
  rendered: Rendered;
  disabled: string[];
  onSelect: (id: string) => void;
  onDrawFreehand: () => void;
}) {
  const thumbs = useMemo(() => Object.fromEntries(ELEMENT_TYPES.filter((e) => e.id !== 'freehand').map((e) => [e.id, thumb(e.id)])), []);
  const groups = [
    ['underline', 'Underlines'],
    ['loop', 'Loops'],
    ['flourish', 'Flourishes'],
  ] as const;
  const add = (type: ElementType) => {
    const id = newId();
    history.set((d) => ({ ...d, method: d.method === 'type' || d.method === 'draw' || d.method === 'upload' ? 'design' : d.method, elements: [...d.elements, newElement(type, id, placeFor(type, rendered))].slice(0, 40) }));
    onSelect(id);
  };
  return (
    <PanelSection title="Signature elements">
      <p className="text-sm text-slate-text">Add an element, then drag it into place. Adding elements switches you to Custom Design so your signature and elements show together.</p>
      {groups.map(([g, label]) => (
        <div key={g}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-text">{label}</p>
          <ul className="grid grid-cols-3 gap-2">
            {ELEMENT_TYPES.filter((e) => e.group === g && !disabled.includes(e.id)).map((e) =>
              e.id === 'freehand' ? (
                <li key={e.id}>
                  <button type="button" onClick={onDrawFreehand} className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-primary/40 bg-ivory/60 p-1 text-center hover:border-primary">
                    <PenLine className="size-5 text-primary" aria-hidden />
                    <span className="text-[11px] font-medium leading-tight text-heading">{e.label}</span>
                  </button>
                </li>
              ) : (
                <li key={e.id}>
                  <button type="button" onClick={() => add(e.id)} className="flex h-20 w-full flex-col justify-between rounded-lg border border-border bg-white p-1 hover:border-primary/40" aria-label={`Add ${e.label}`}>
                    <ArtworkSvg rendered={thumbs[e.id]!} className="h-10 [&>svg]:mx-auto [&>svg]:h-10 [&>svg]:w-auto" label="" />
                    <span className="truncate text-[11px] font-medium text-heading">{e.label}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </PanelSection>
  );
}

export function ElementInspector({
  history,
  element,
  onSelect,
}: {
  history: DesignHistory;
  element: DesignElement;
  onSelect: (id: string | null) => void;
}) {
  const e = element;
  const set = (patch: Partial<DesignElement>, commit = false) => history.set((d) => updateElement(d, e.id, patch), commit);
  const end = () => history.endDrag();
  const idx = history.design.elements.findIndex((x) => x.id === e.id);
  const move = (dir: -1 | 1) =>
    history.set((d) => {
      const els = [...d.elements];
      const j = idx + dir;
      if (j < 0 || j >= els.length) return d;
      [els[idx], els[j]] = [els[j]!, els[idx]!];
      return { ...d, elements: els };
    });
  const label = ELEMENT_TYPES.find((t) => t.id === e.type)?.label ?? 'Element';
  return (
    <PanelSection title={label}>
      <div className="flex flex-wrap gap-1.5">
        <ChipButton onClick={() => set({ flipX: !e.flipX }, true)} active={e.flipX} aria-label="Flip horizontally">
          <FlipHorizontal2 className="size-4" aria-hidden /> Flip
        </ChipButton>
        <ChipButton onClick={() => set({ flipY: !e.flipY }, true)} active={e.flipY} aria-label="Flip vertically">
          <FlipVertical2 className="size-4" aria-hidden /> Flip vertical
        </ChipButton>
        <ChipButton onClick={() => move(1)} disabled={idx === history.design.elements.length - 1} aria-label="Bring forward">
          <ArrowUp className="size-4" aria-hidden /> Forward
        </ChipButton>
        <ChipButton onClick={() => move(-1)} disabled={idx === 0} aria-label="Send backward">
          <ArrowDown className="size-4" aria-hidden /> Back
        </ChipButton>
        <ChipButton
          onClick={() => {
            const id = newId();
            history.set((d) => ({ ...d, elements: [...d.elements, { ...e, id, x: e.x + 24, y: e.y + 16 }].slice(0, 40) }));
            onSelect(id);
          }}
          aria-label="Duplicate element"
        >
          <Copy className="size-4" aria-hidden /> Duplicate
        </ChipButton>
        <ChipButton
          onClick={() => {
            history.set((d) => ({ ...d, elements: d.elements.filter((x) => x.id !== e.id) }));
            onSelect(null);
          }}
          className="text-error"
          aria-label="Delete element"
        >
          <Trash2 className="size-4" aria-hidden /> Delete
        </ChipButton>
      </div>
      <Slider label="Size" value={e.scale} min={0.1} max={3} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ scale: v })} onCommit={end} />
      <Slider label="Rotation" value={e.rotate} min={-180} max={180} format={(v) => `${v}°`} onChange={(v) => set({ rotate: v })} onCommit={end} />
      {e.type !== 'freehand' ? <Slider label="Curve" value={e.curve} min={0} max={100} onChange={(v) => set({ curve: v })} onCommit={end} /> : null}
      <Slider label="Thickness" value={e.thickness} min={0.3} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ thickness: v })} onCommit={end} />
      <Slider label="Opacity" value={e.opacity} min={0.2} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ opacity: v })} onCommit={end} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-heading">Ink color</span>
        <span className="flex items-center gap-2">
          <ChipButton active={e.color === null} onClick={() => set({ color: null }, true)} className="min-h-8 px-2 text-xs">
            Match signature
          </ChipButton>
          <input
            type="color"
            aria-label="Element ink color"
            value={e.color ?? history.design.ink}
            onChange={(ev) => set({ color: ev.target.value.toUpperCase() })}
            onBlur={end}
            className="size-8 cursor-pointer rounded border border-border bg-white p-0.5"
          />
        </span>
      </div>
    </PanelSection>
  );
}

/**
 * Smart Stroke: refines a hand-drawn stroke to match the signature. The original points are
 * always kept, so before/after, undo and Restore Original are exact.
 */
export function SmartStrokePanel({
  history,
  element,
  rendered,
  curveMode,
  onCurveMode,
  onSelect,
  onTrack,
}: {
  history: DesignHistory;
  element: DesignElement;
  rendered: Rendered;
  curveMode: boolean;
  onCurveMode: (on: boolean) => void;
  onSelect: (id: string | null) => void;
  onTrack: (event: string) => void;
}) {
  const e = element;
  const s: SmartSettings = e.smart ?? { ...DEFAULT_SMART, enabled: false };
  const [preserve, setPreserve] = useState(true);
  const [message, setMessage] = useState('');
  const setSmart = (patch: Partial<SmartSettings>, commit = true) => history.set((d) => updateElement(d, e.id, { smart: { ...s, ...patch } }), commit);
  const end = () => history.endDrag();
  const showOriginal = !s.enabled;

  function connect() {
    const c = suggestConnection(e, rendered.text);
    if (!c) {
      setMessage(rendered.text ? 'No letter is close enough. Move the stroke nearer to the letter you want to join, then try again.' : 'Type your name first, then connect the stroke to a letter.');
      return;
    }
    setMessage(`Connected the ${c.end === 'start' ? 'start' : 'end'} of the stroke to the nearest letter.`);
    history.set((d) => updateElement(d, e.id, { connect: c }));
  }

  function apply() {
    onTrack('smart_stroke_used');
    if (!preserve && e.points) {
      // Bake the refined curve into the stroke (the previous version stays in undo history).
      const refined = smartStrokePoints({ ...e, connect: null }, rendered.text);
      history.set((d) =>
        updateElement(d, e.id, {
          x: 0,
          y: 0,
          scale: 1,
          rotate: 0,
          flipX: false,
          flipY: false,
          points: refined.map(([x, y, p]) => [round1(x), round1(y), Math.round(p * 100) / 100]),
          anchors: undefined,
          smart: { ...s, smoothing: 0, refine: 0, align: false, snap: false },
        }),
      );
    }
    onCurveMode(false);
    onSelect(null);
  }

  function editCurve() {
    if (!e.anchors?.length && e.points?.length) {
      let tol = 3 + (s.refine / 100) * 6;
      let fitted = fitAnchors(e.points as [number, number, number][], tol);
      while (fitted.length > 200) fitted = fitAnchors(e.points as [number, number, number][], (tol *= 1.6));
      const anchors: Anchor[] = fitted.map((a) => ({
        x: round1(a.x),
        y: round1(a.y),
        ix: round1(a.ix),
        iy: round1(a.iy),
        ox: round1(a.ox),
        oy: round1(a.oy),
      }));
      history.set((d) => updateElement(d, e.id, { anchors, smart: { ...s, enabled: true } }));
    }
    onCurveMode(true);
  }

  return (
    <PanelSection title="Smart Stroke">
      <p className="text-sm text-slate-text">Smart Stroke refines your stroke to match your signature&apos;s thickness, color, curves, taper and slant. Your original stroke is always kept.</p>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-cream p-1" role="group" aria-label="Compare stroke">
        <button type="button" aria-pressed={showOriginal} onClick={() => setSmart({ enabled: false })} className={cn('rounded-md px-2 py-1.5 text-sm font-semibold', showOriginal ? 'bg-white shadow' : 'text-slate-text')}>
          Before
        </button>
        <button type="button" aria-pressed={!showOriginal} onClick={() => setSmart({ enabled: true })} className={cn('rounded-md px-2 py-1.5 text-sm font-semibold', !showOriginal ? 'bg-white shadow' : 'text-slate-text')}>
          After
        </button>
      </div>
      <Slider label="Smoothing" value={s.smoothing} min={0} max={100} onChange={(v) => setSmart({ smoothing: v }, false)} onCommit={end} />
      <Slider label="Pressure effect" value={s.pressure} min={0} max={100} onChange={(v) => setSmart({ pressure: v }, false)} onCommit={end} />
      <Slider label="Taper" value={s.taper} min={0} max={100} onChange={(v) => setSmart({ taper: v }, false)} onCommit={end} />
      <Slider label="Curve refinement" value={s.refine} min={0} max={100} onChange={(v) => setSmart({ refine: v }, false)} onCommit={end} />
      <Toggle label="Match signature style" checked={s.match} onChange={(v) => setSmart({ match: v })} hint="Uses the signature's ink, stroke weight and slant." />
      <Toggle label="Auto-align to baseline" checked={s.align} onChange={(v) => setSmart({ align: v })} />
      <Toggle label="Snap to nearby endpoints" checked={s.snap} onChange={(v) => setSmart({ snap: v })} hint="Pulls the stroke ends onto a letter when they are close." />
      <Toggle label="Preserve original" checked={preserve} onChange={setPreserve} hint={preserve ? 'Keeps your drawn stroke so you can restore it.' : 'Apply replaces the stroke with the refined one (you can still undo).'} />
      <div className="flex flex-wrap gap-2">
        <ChipButton onClick={connect}>
          <Link2 className="size-4" aria-hidden /> Connect to Letter
        </ChipButton>
        {e.connect ? (
          <ChipButton onClick={() => history.set((d) => updateElement(d, e.id, { connect: null }))}>Remove connection</ChipButton>
        ) : null}
        <ChipButton onClick={curveMode ? () => onCurveMode(false) : editCurve} active={curveMode}>
          <Spline className="size-4" aria-hidden /> Edit Curve
        </ChipButton>
      </div>
      {message ? (
        <p role="status" className="text-sm text-slate-text">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={apply}>
          Apply
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={!history.canUndo} onClick={history.undo}>
          Undo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            history.set((d) => updateElement(d, e.id, { smart: { ...DEFAULT_SMART, enabled: false }, anchors: undefined, connect: null }));
            onCurveMode(false);
          }}
        >
          <RotateCcw className="size-4" aria-hidden /> Restore Original
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            history.set((d) => ({ ...d, elements: d.elements.filter((x) => x.id !== e.id) }));
            onSelect(null);
          }}
        >
          Reject
        </Button>
      </div>
      {curveMode ? <CurveEditor history={history} element={e} /> : null}
    </PanelSection>
  );
}

/** Freehand curve editor: anchors and handles are dragged on the canvas; these are the tools. */
function CurveEditor({ history, element: e }: { history: DesignHistory; element: DesignElement }) {
  const anchors = e.anchors ?? [];
  const [sel, setSel] = useState(0);
  const i = Math.min(sel, anchors.length - 1);
  const put = (next: Anchor[]) => history.set((d: Design) => updateElement(d, e.id, { anchors: next }));
  const extend = (k: number) => {
    if (anchors.length < 2) return;
    const last = anchors[anchors.length - 1]!;
    const prev = anchors[anchors.length - 2]!;
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    put([...anchors.slice(0, -1), { ...last, x: round1(last.x + (dx / len) * k), y: round1(last.y + (dy / len) * k) }]);
  };
  return (
    <details open className="rounded-xl border border-border bg-ivory/60 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-heading">Advanced curve editor</summary>
      <p className="mt-2 text-xs text-slate-text">Drag the square anchors and round handles on the canvas. Pick an anchor to edit it here.</p>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <label htmlFor="anchor-pick" className="font-medium text-heading">
          Anchor
        </label>
        <input id="anchor-pick" type="number" min={1} max={anchors.length} value={i + 1} onChange={(ev) => setSel(clamp(Number(ev.target.value) - 1, 0, anchors.length - 1))} className="h-8 w-16 rounded border border-border px-2" />
        <span className="text-xs text-slate-text">of {anchors.length}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <ChipButton
          className="min-h-8 text-xs"
          onClick={() => {
            const a = anchors[i];
            const b = anchors[i + 1];
            if (!a || !b) return;
            const mid: Anchor = { x: round1((a.x + b.x) / 2), y: round1((a.y + b.y) / 2), ix: round1((a.x - b.x) / 6), iy: round1((a.y - b.y) / 6), ox: round1((b.x - a.x) / 6), oy: round1((b.y - a.y) / 6) };
            put([...anchors.slice(0, i + 1), mid, ...anchors.slice(i + 1)]);
          }}
        >
          Add point after
        </ChipButton>
        <ChipButton className="min-h-8 text-xs" disabled={anchors.length <= 2} onClick={() => put(anchors.filter((_, k) => k !== i))}>
          Remove point
        </ChipButton>
        <ChipButton
          className="min-h-8 text-xs"
          onClick={() => {
            const a = anchors[i]!;
            const len = (Math.hypot(a.ix, a.iy) + Math.hypot(a.ox, a.oy)) / 2 || 20;
            const ang = Math.atan2(a.oy - a.iy, a.ox - a.ix);
            put(anchors.map((x, k) => (k === i ? { ...x, ox: round1(Math.cos(ang) * len), oy: round1(Math.sin(ang) * len), ix: round1(-Math.cos(ang) * len), iy: round1(-Math.sin(ang) * len) } : x)));
          }}
        >
          Smooth segment
        </ChipButton>
        <ChipButton className="min-h-8 text-xs" onClick={() => put(anchors.map((x, k) => (k === i || k === i + 1 ? { ...x, ...(k === i ? { ox: 0, oy: 0 } : { ix: 0, iy: 0 }) } : x)))}>
          Straighten segment
        </ChipButton>
        <ChipButton className="min-h-8 text-xs" onClick={() => extend(24)}>
          Extend
        </ChipButton>
        <ChipButton className="min-h-8 text-xs" onClick={() => extend(-24)}>
          Shorten
        </ChipButton>
        <ChipButton
          className="min-h-8 text-xs"
          disabled={anchors.length < 3}
          onClick={() => {
            const first = anchors[0]!;
            put([...anchors, { ...first, ix: -first.ox, iy: -first.oy }]);
          }}
        >
          Connect endpoints
        </ChipButton>
        <ChipButton className="min-h-8 text-xs" onClick={() => history.set((d) => updateElement(d, e.id, { anchors: undefined }))}>
          Reset curve
        </ChipButton>
      </div>
      <div className="mt-3">
        <Slider label="Thickness" value={e.thickness} min={0.3} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => history.set((d) => updateElement(d, e.id, { thickness: v }), false)} onCommit={history.endDrag} />
      </div>
    </details>
  );
}
