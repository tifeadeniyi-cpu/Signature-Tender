'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';

export type Font = { id: string; family: string; className: string };
type Method = 'typed' | 'drawn' | 'uploaded';
export type Adopted = { method: Method; pngBase64: string; typedText?: string; font?: string };

const W = 600;
const H = 200;

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .join('')
    .slice(0, 4);
}

/**
 * Uploaded images are redrawn onto a canvas: this converts JPEG to PNG, strips metadata and can
 * lift a white background so the mark sits cleanly on the page.
 */
function processUpload(img: HTMLImageElement, removeBg: boolean): string {
  const scale = Math.min(W / img.width, H / img.height, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(img.width * scale));
  c.height = Math.max(8, Math.round(img.height * scale));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  if (removeBg) {
    const data = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const lum = (data.data[i]! + data.data[i + 1]! + data.data[i + 2]!) / 3;
      if (lum > 215) data.data[i + 3] = 0;
    }
    ctx.putImageData(data, 0, 0);
  }
  return c.toDataURL('image/png');
}

async function renderTyped(text: string, font: Font): Promise<string> {
  const primary = font.family.split(',')[0]!.trim();
  try {
    await document.fonts.load(`72px ${primary}`);
  } catch {
    // Rendering still works with whatever face is available; the preview showed the same.
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  let size = 96;
  ctx.font = `${size}px ${font.family}`;
  while (size > 24 && ctx.measureText(text).width > W - 40) {
    size -= 4;
    ctx.font = `${size}px ${font.family}`;
  }
  ctx.fillStyle = '#0f1733';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, H / 2);
  return c.toDataURL('image/png').split(',')[1]!;
}

/** Signature or initials adoption with Type, Draw and Upload. Nothing is applied until "Adopt and use". */
export function SignatureModal({
  kind,
  name,
  fonts,
  onAdopt,
  onClose,
  error,
  busy,
}: {
  kind: 'signature' | 'initials';
  name: string;
  fonts: Font[];
  onAdopt: (a: Adopted) => void;
  onClose: () => void;
  error: string | null;
  busy: boolean;
}) {
  const [tab, setTab] = useState<Method>('typed');
  const [text, setText] = useState(kind === 'initials' ? initialsOf(name) : name);
  const [font, setFont] = useState(fonts[0]!);
  const [localError, setLocalError] = useState<string | null>(null);
  const pad = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [upload, setUpload] = useState<string | null>(null);
  const [removeBg, setRemoveBg] = useState(true);
  const [uploadImg, setUploadImg] = useState<HTMLImageElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const label = kind === 'initials' ? 'initials' : 'signature';

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'drawn' || !pad.current) return;
    const ctx = pad.current.getContext('2d')!;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f1733';
  }, [tab]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  function chooseFile(f: File | undefined) {
    setLocalError(null);
    if (!f) return;
    if (!['image/png', 'image/jpeg'].includes(f.type))
      return setLocalError('Upload a PNG or JPEG image.');
    if (f.size > 5 * 1024 * 1024) return setLocalError('The image must be 5 MB or smaller.');
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      setUploadImg(img);
      setUpload(processUpload(img, removeBg));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => setLocalError('That image could not be read.');
    img.src = url;
  }

  async function adopt() {
    setLocalError(null);
    if (tab === 'typed') {
      if (!text.trim()) return setLocalError(`Type your ${label}.`);
      try {
        onAdopt({
          method: 'typed',
          typedText: text.trim(),
          font: font.id,
          pngBase64: await renderTyped(text.trim(), font),
        });
      } catch {
        setLocalError(`Your ${label} could not be created. Try again, or use Draw.`);
      }
    } else if (tab === 'drawn') {
      if (!hasInk || !pad.current) return setLocalError(`Draw your ${label} in the box.`);
      onAdopt({ method: 'drawn', pngBase64: pad.current.toDataURL('image/png').split(',')[1]! });
    } else {
      if (!upload) return setLocalError('Choose an image to upload.');
      onAdopt({ method: 'uploaded', pngBase64: upload.split(',')[1]! });
    }
  }

  const tabs: { id: Method; label: string }[] = [
    { id: 'typed', label: 'Type' },
    { id: 'drawn', label: 'Draw' },
    { id: 'uploaded', label: 'Upload' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-heading/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="adopt-title"
        className="max-h-[95dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-card sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="adopt-title" className="font-display text-2xl">
          Adopt your {label}
        </h2>
        <div
          role="tablist"
          aria-label={`How to create your ${label}`}
          className="mt-4 flex gap-1 rounded-lg bg-ivory p-1"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 rounded-md px-3 py-2 text-sm font-semibold',
                tab === t.id ? 'bg-white text-primary shadow-card' : 'text-slate-text',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4" role="tabpanel">
          {tab === 'typed' ? (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-heading">
                {kind === 'initials' ? 'Your initials' : 'Your full name'}
                <input
                  data-autofocus
                  value={text}
                  maxLength={kind === 'initials' ? 6 : 80}
                  onChange={(e) => setText(e.target.value)}
                  className="h-10 rounded-lg border border-border px-3 font-normal"
                />
              </label>
              <div role="radiogroup" aria-label="Style" className="flex flex-col gap-2">
                {fonts.map((f) => (
                  <label
                    key={f.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2',
                      font.id === f.id ? 'border-primary bg-primary-surface' : 'border-border',
                    )}
                  >
                    <input
                      type="radio"
                      name="font"
                      checked={font.id === f.id}
                      onChange={() => setFont(f)}
                      className="size-4"
                      aria-label={f.id}
                    />
                    <span className={cn(f.className, 'truncate text-3xl text-heading')}>
                      {text || name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : tab === 'drawn' ? (
            <div className="flex flex-col gap-2">
              <canvas
                ref={pad}
                width={W}
                height={H}
                aria-label={`Draw your ${label} here`}
                className="aspect-[3/1] w-full touch-none rounded-lg border border-dashed border-primary bg-ivory"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drawing.current = point(e);
                }}
                onPointerMove={(e) => {
                  if (!drawing.current) return;
                  const p = point(e);
                  const ctx = e.currentTarget.getContext('2d')!;
                  ctx.beginPath();
                  ctx.moveTo(drawing.current.x, drawing.current.y);
                  ctx.lineTo(p.x, p.y);
                  ctx.stroke();
                  drawing.current = p;
                  setHasInk(true);
                }}
                onPointerUp={() => (drawing.current = null)}
                onPointerCancel={() => (drawing.current = null)}
              />
              <div className="flex justify-between text-xs">
                <span>Use your mouse, finger, stylus or trackpad.</span>
                <button
                  type="button"
                  className="font-semibold text-primary"
                  onClick={() => {
                    pad.current?.getContext('2d')?.clearRect(0, 0, W, H);
                    setHasInk(false);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-heading">
                Signature image (PNG or JPEG, up to 5 MB)
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => chooseFile(e.target.files?.[0])}
                  className="text-sm font-normal"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-heading">
                <input
                  type="checkbox"
                  checked={removeBg}
                  onChange={(e) => {
                    setRemoveBg(e.target.checked);
                    if (uploadImg) setUpload(processUpload(uploadImg, e.target.checked));
                  }}
                  className="size-4"
                />
                Remove white background
              </label>
              {upload ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={upload}
                  alt="Uploaded signature preview"
                  className="max-h-32 self-start rounded border border-border bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2"
                />
              ) : null}
              <p className="text-xs">
                An uploaded image is a picture of your mark. It does not by itself prove who you
                are.
              </p>
            </div>
          )}
        </div>

        {localError || error ? (
          <Alert tone="error" className="mt-3">
            {localError || error}
          </Alert>
        ) : null}
        <p className="mt-4 text-xs">
          By selecting &ldquo;Adopt and use {label}&rdquo;, I agree that this mark is my electronic{' '}
          {label} for this document, and that I will apply it where I choose.
        </p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={adopt} loading={busy}>
            Adopt and use {label}
          </Button>
        </div>
      </div>
    </div>
  );
}
