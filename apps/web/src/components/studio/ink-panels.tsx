'use client';
import { useEffect, useRef, useState } from 'react';
import { Eraser, ImageUp, Undo2 } from 'lucide-react';
import { PENS, STUDIO_INKS, type Design, type PublicStudioSettings } from '@st/core/studio/index';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { ChipButton, PanelSection, Slider, Toggle } from './controls';
import { clamp, type DesignHistory } from './state';

export function InkPicker({ history, settings }: { history: DesignHistory; settings: PublicStudioSettings }) {
  const { design } = history;
  const inks = settings.inks.map((c) => ({ color: c.toUpperCase(), label: STUDIO_INKS.find((i) => i.color.toUpperCase() === c.toUpperCase())?.label ?? c }));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-heading">Ink color</p>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Ink color">
        {inks.map((i) => (
          <button
            key={i.color}
            type="button"
            role="radio"
            aria-checked={design.ink.toUpperCase() === i.color}
            aria-label={i.label}
            title={i.label}
            onClick={() => history.set((d) => ({ ...d, ink: i.color }))}
            className={cn('size-9 rounded-full border-2 border-white shadow ring-2', design.ink.toUpperCase() === i.color ? 'ring-gold' : 'ring-border')}
            style={{ background: i.color }}
          />
        ))}
        {settings.customInk ? (
          <label className="flex items-center gap-2 text-xs font-medium text-heading">
            <input
              type="color"
              value={design.ink}
              onChange={(e) => history.set((d) => ({ ...d, ink: e.target.value.toUpperCase() }), false)}
              onBlur={() => history.endDrag()}
              className="size-9 cursor-pointer rounded-full border border-border bg-white p-0.5"
              aria-label="Custom ink color"
            />
            Custom
          </label>
        ) : null}
      </div>
    </div>
  );
}

export function PenPanel({ history, settings }: { history: DesignHistory; settings: PublicStudioSettings }) {
  const { design } = history;
  const pens = PENS.filter((p) => !settings.disabledPens.includes(p.id));
  const setPen = (patch: Partial<Design['penSettings']>) => history.set((d) => ({ ...d, penSettings: { ...d.penSettings, ...patch } }), false);
  const end = () => history.endDrag();
  return (
    <PanelSection title="Pen and ink">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pen">
        {pens.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={design.pen === p.id}
            onClick={() => history.set((d) => ({ ...d, pen: p.id }))}
            className={cn(
              'rounded-lg border px-2.5 py-2 text-left',
              design.pen === p.id ? 'border-primary bg-primary text-white' : 'border-border bg-white hover:border-primary/40',
            )}
          >
            <span className="block text-sm font-semibold">{p.label}</span>
            <span className={cn('block text-xs', design.pen === p.id ? 'text-white/80' : 'text-slate-text')}>{p.hint}</span>
          </button>
        ))}
      </div>
      <InkPicker history={history} settings={settings} />
      <PanelSection title="Pen controls" collapsible defaultOpen={false}>
        <Slider label="Pen width" value={design.thickness} min={0.3} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => history.set((d) => ({ ...d, thickness: v }), false)} onCommit={end} />
        <Slider label="Pressure variation" value={design.penSettings.pressure} min={0} max={100} onChange={(v) => setPen({ pressure: v })} onCommit={end} />
        <Slider label="Opacity" value={design.penSettings.opacity} min={0.3} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setPen({ opacity: v })} onCommit={end} />
        <Slider label="Texture" value={design.penSettings.texture} min={0} max={100} onChange={(v) => setPen({ texture: v })} onCommit={end} hint="Dry-ink grain on the edges." />
        <Slider label="Stroke taper" value={design.penSettings.taper} min={0} max={100} onChange={(v) => setPen({ taper: v })} onCommit={end} />
        <Slider label="Smoothness" value={design.smoothing} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => history.set((d) => ({ ...d, smoothing: v }), false)} onCommit={end} hint="Smooths hand-drawn strokes." />
      </PanelSection>
    </PanelSection>
  );
}

export function DrawPanel({ history, onUseDraw }: { history: DesignHistory; onUseDraw: () => void }) {
  const { design } = history;
  return (
    <PanelSection title="Draw your signature">
      <p className="text-sm text-slate-text">Draw in the white area with your mouse, finger or stylus. Pens that report pressure make thicker and thinner strokes.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onUseDraw}>
          Draw
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!design.strokes.length}
          onClick={() => history.set((d) => ({ ...d, strokes: d.strokes.slice(0, -1) }))}
        >
          <Undo2 className="size-4" aria-hidden /> Remove last stroke
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={!design.strokes.length} onClick={() => history.set((d) => ({ ...d, strokes: [] }))}>
          <Eraser className="size-4" aria-hidden /> Clear drawing
        </Button>
      </div>
      <p className="text-xs text-slate-text">To move, resize or rotate the drawing, choose Select and drag it.</p>
    </PanelSection>
  );
}

/**
 * Upload: validated in the browser, cropped, background removed and converted to PNG before it
 * is sent. The server checks and rebuilds the PNG again.
 */
export function UploadPanel({
  history,
  upload,
  onUploaded,
}: {
  history: DesignHistory;
  upload: (file: Blob) => Promise<{ ok: true; ref: string; w: number; h: number } | { ok: false; message: string }>;
  onUploaded: (ref: string, url: string) => void;
}) {
  const { design } = history;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [crop, setCrop] = useState({ l: 0, t: 0, r: 0, b: 0 });
  const [removeBg, setRemoveBg] = useState(true);
  const [threshold, setThreshold] = useState(70);
  const [recolor, setRecolor] = useState(true);
  const [dark, setDark] = useState(50);
  const preview = useRef<HTMLCanvasElement>(null);

  function onFile(f: File | undefined) {
    setError('');
    if (!f) return;
    if (!['image/png', 'image/jpeg'].includes(f.type)) return setError('Upload a PNG or JPEG image.');
    if (f.size > 10_000_000) return setError('That image is too large. Use one under 10 MB.');
    const url = URL.createObjectURL(f);
    const i = new Image();
    i.onload = () => {
      if (i.naturalWidth < 40 || i.naturalHeight < 20) return setError('That image is too small to use.');
      setImg(i);
      setCrop({ l: 0, t: 0, r: 0, b: 0 });
    };
    i.onerror = () => setError('That image could not be read.');
    i.src = url;
  }

  function process(target: HTMLCanvasElement, maxSide: number) {
    if (!img) return;
    const sx = (crop.l / 100) * img.naturalWidth;
    const sy = (crop.t / 100) * img.naturalHeight;
    const sw = Math.max(8, img.naturalWidth * (1 - (crop.l + crop.r) / 100));
    const sh = Math.max(8, img.naturalHeight * (1 - (crop.t + crop.b) / 100));
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    target.width = Math.max(8, Math.round(sw * k));
    target.height = Math.max(8, Math.round(sh * k));
    const ctx = target.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, target.width, target.height);
    if (!removeBg && !recolor) return;
    const data = ctx.getImageData(0, 0, target.width, target.height);
    const px = data.data;
    const ink = parseInt(design.ink.slice(1), 16);
    const [ir, ig, ib] = [(ink >> 16) & 255, (ink >> 8) & 255, ink & 255];
    const cut = 255 * (threshold / 100);
    const soft = 30;
    const gain = 0.6 + dark / 50;
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
      let a = px[i + 3]! / 255;
      if (removeBg) a *= clamp((cut - lum) / soft + 0.5, 0, 1);
      a = clamp(a * gain, 0, 1);
      if (recolor) {
        px[i] = ir;
        px[i + 1] = ig;
        px[i + 2] = ib;
      }
      px[i + 3] = Math.round(a * 255);
    }
    ctx.putImageData(data, 0, 0);
  }

  useEffect(() => {
    if (img && preview.current) process(preview.current, 600);
  });

  async function use() {
    if (!img) return;
    setBusy(true);
    setError('');
    const c = document.createElement('canvas');
    process(c, 1600);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (!blob) {
      setBusy(false);
      return setError('That image could not be prepared.');
    }
    const r = await upload(blob);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    const scale = Math.min(1000 / r.w, 320 / r.h, 2);
    onUploaded(r.ref, URL.createObjectURL(blob));
    history.set((d) => ({
      ...d,
      method: d.method === 'design' ? 'design' : 'upload',
      upload: { ref: r.ref, w: r.w, h: r.h, scale: Math.round(scale * 1000) / 1000, rotate: 0, x: Math.round(600 - (r.w * scale) / 2), y: Math.round(200 - (r.h * scale) / 2) },
    }));
    setImg(null);
  }

  return (
    <PanelSection title="Upload your signature">
      <p className="text-sm text-slate-text">Sign on white paper, take a clear photo or scan, and upload it as a PNG or JPEG.</p>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-ivory/50 px-4 py-6 text-center hover:border-primary/40">
        <ImageUp className="size-6 text-primary" aria-hidden />
        <span className="text-sm font-semibold text-heading">Choose an image</span>
        <span className="text-xs text-slate-text">PNG or JPEG, up to 10 MB</span>
        <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {img ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border p-2" style={{ background: 'repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 50% / 16px 16px' }}>
            <canvas ref={preview} className="mx-auto block max-h-40 w-auto max-w-full" aria-label="Upload preview" />
          </div>
          <p className="text-sm font-semibold text-heading">Crop</p>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['l', 'Left'],
                ['r', 'Right'],
                ['t', 'Top'],
                ['b', 'Bottom'],
              ] as const
            ).map(([k, label]) => (
              <Slider key={k} label={label} value={crop[k]} min={0} max={45} format={(v) => `${v}%`} onChange={(v) => setCrop((c) => ({ ...c, [k]: v }))} />
            ))}
          </div>
          <Toggle label="Remove background" checked={removeBg} onChange={setRemoveBg} hint="Makes the paper transparent." />
          {removeBg ? <Slider label="Background cut-off" value={threshold} min={30} max={95} onChange={setThreshold} /> : null}
          <Toggle label="Use my ink color" checked={recolor} onChange={setRecolor} hint="Recolors the strokes with the ink you picked." />
          <Slider label="Ink strength" value={dark} min={0} max={100} onChange={setDark} />
          <div className="flex gap-2">
            <Button type="button" onClick={use} loading={busy}>
              Use This Image
            </Button>
            <Button type="button" variant="secondary" onClick={() => setImg(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : design.upload ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-text">Drag the image on the canvas to position it. Use the corner handle to resize and the round handle to rotate.</p>
          <ChipButton onClick={() => history.set((d) => ({ ...d, upload: null }))}>Remove uploaded image</ChipButton>
          <p className="text-xs text-slate-text">Uploaded signatures download as PNG and JPEG. SVG is offered only for designs made entirely in the Studio, because a photo cannot be honestly converted to clean vector lines.</p>
        </div>
      ) : null}
    </PanelSection>
  );
}
