'use client';
import { useRef, useState } from 'react';
import { Info, PenTool, Type as TypeIcon, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import { track } from './analytics';
import { AvailabilityBadge } from './primitives';

export interface StudioFamily {
  id: string;
  label: string;
  font: string;
  family: string;
  inApp: boolean;
  scale: number;
}

const FLOURISHES = [
  { id: 'none', label: 'None' },
  { id: 'underline', label: 'Underline' },
  { id: 'swash', label: 'Swash' },
  { id: 'loop', label: 'Loop' },
] as const;
type Flourish = (typeof FLOURISHES)[number]['id'];

const INKS = [
  { id: 'black', label: 'Black ink', color: '#1F1A1C' },
  { id: 'blue', label: 'Blue ink', color: '#1E3A8A' },
  { id: 'navy', label: 'Navy ink', color: '#1E3A5F' },
] as const;

const WEIGHTS = [
  { id: 'fine', label: 'Fine', stroke: 0 },
  { id: 'regular', label: 'Regular', stroke: 0.4 },
  { id: 'bold', label: 'Bold', stroke: 1.1 },
] as const;

function FlourishMark({ kind, color }: { kind: Flourish; color: string }) {
  if (kind === 'none') return null;
  const d =
    kind === 'underline'
      ? 'M8 20 C120 14 260 14 392 18'
      : kind === 'swash'
        ? 'M6 24 C80 4 150 30 220 16 S340 2 394 14'
        : 'M10 22 C120 18 230 18 300 16 C350 14 372 2 352 0 C330 -2 330 22 394 20';
  return (
    <svg viewBox="0 -4 400 32" preserveAspectRatio="none" className="-mt-3 h-8 w-full" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Public Signature Studio preview. Runs entirely in the browser: the name is never sent, stored
 * or included in analytics, and the preview does not sign anything.
 */
export function StudioDemo({ families }: { families: StudioFamily[] }) {
  const [name, setName] = useState('Jordan Rivera');
  const [familyId, setFamilyId] = useState(families[1]?.id ?? families[0]!.id);
  const [slant, setSlant] = useState(0);
  const [flourish, setFlourish] = useState<Flourish>('underline');
  const [ink, setInk] = useState<(typeof INKS)[number]['id']>('navy');
  const [weight, setWeight] = useState<(typeof WEIGHTS)[number]['id']>('regular');
  const opened = useRef(false);

  const touch = () => {
    if (opened.current) return;
    opened.current = true;
    track('signature_studio_demo_opened');
  };
  const family = families.find((f) => f.id === familyId) ?? families[0]!;
  const color = INKS.find((i) => i.id === ink)!.color;
  const stroke = WEIGHTS.find((w) => w.id === weight)!.stroke;
  const shown = name.trim() || 'Your Name';
  const sigStyle = (f: StudioFamily) => ({
    fontFamily: f.family,
    // Scales down on phones so long names stay inside the preview.
    fontSize: `calc(${f.scale} * clamp(1.9rem, 8vw, 3rem))`,
    color,
    WebkitTextStroke: stroke ? `${stroke}px ${color}` : undefined,
  });

  return (
    <div
      className="overflow-hidden rounded-3xl border border-border bg-white text-heading shadow-2xl"
      onFocusCapture={touch}
      onPointerDownCapture={touch}
    >
      <div className="flex items-center justify-between bg-primary px-5 py-3 text-white">
        <p className="font-display text-lg">Signature Studio</p>
        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold">
          Preview
        </span>
      </div>
      <div className="p-5 sm:p-6">
        <div
          className="grid grid-cols-3 gap-1 rounded-xl bg-ivory p-1 text-sm"
          aria-label="Signature methods"
        >
          <span className="flex items-center justify-center gap-1.5 rounded-lg bg-white py-2 font-semibold text-primary shadow-sm">
            <TypeIcon className="size-4" aria-hidden /> Type
          </span>
          <span className="flex items-center justify-center gap-1.5 py-2 text-slate-text">
            <PenTool className="size-4" aria-hidden /> Draw
          </span>
          <span className="flex items-center justify-center gap-1.5 py-2 text-slate-text">
            <Upload className="size-4" aria-hidden /> Upload
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-text">
          Drawing and uploading a signature are available when you sign a document. This preview
          shows typed styles.
        </p>

        <label className="mt-4 block text-sm font-semibold" htmlFor="studio-name">
          Your name
        </label>
        <input
          id="studio-name"
          value={name}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          className="mt-1 h-11 w-full rounded-lg border border-border bg-white px-3 text-base"
        />

        <div
          className="mt-4 flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-rose-gold bg-ivory px-4 py-6"
          aria-live="polite"
          aria-label={`Preview in ${family.label}`}
        >
          <div
            className="max-w-full overflow-hidden px-2"
            style={{ transform: `skewX(${-slant}deg)` }}
          >
            <p className="whitespace-nowrap leading-tight" style={sigStyle(family)}>
              {shown}
            </p>
            <FlourishMark kind={flourish} color={color} />
          </div>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold">Signature style</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {families.map((f) => (
              <label
                key={f.id}
                className={cn(
                  'flex cursor-pointer flex-col rounded-xl border p-2.5 transition-colors hover:border-primary/60',
                  f.id === familyId ? 'border-primary bg-primary-surface' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="studio-family"
                  value={f.id}
                  className="sr-only"
                  checked={f.id === familyId}
                  onChange={() => {
                    setFamilyId(f.id);
                    track('signature_style_selected', { style: f.id });
                  }}
                />
                <span
                  className="truncate leading-tight"
                  style={{ fontFamily: f.family, fontSize: `${1.5 * f.scale}rem`, color }}
                >
                  {shown}
                </span>
                <span className="mt-1 text-xs font-semibold">{f.label}</span>
                <span className="mt-1">
                  {f.inApp ? (
                    <span className="inline-flex rounded-full bg-success-bg px-2 py-0.5 text-[10px] font-semibold text-success">
                      In the app
                    </span>
                  ) : (
                    <AvailabilityBadge value="soon" className="text-[10px]" />
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Slant <span className="font-normal text-slate-text">({slant}°)</span>
            <input
              type="range"
              min={-6}
              max={18}
              step={1}
              value={slant}
              onChange={(e) => setSlant(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
          </label>
          <fieldset>
            <legend className="text-sm font-semibold">Flourish</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {FLOURISHES.map((f) => (
                <label
                  key={f.id}
                  className={cn(
                    'cursor-pointer rounded-full border px-3 py-1 text-xs',
                    flourish === f.id ? 'border-primary bg-primary text-white' : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    name="studio-flourish"
                    className="sr-only"
                    checked={flourish === f.id}
                    onChange={() => setFlourish(f.id)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold">Ink weight</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {WEIGHTS.map((w) => (
                <label
                  key={w.id}
                  className={cn(
                    'cursor-pointer rounded-full border px-3 py-1 text-xs',
                    weight === w.id ? 'border-primary bg-primary text-white' : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    name="studio-weight"
                    className="sr-only"
                    checked={weight === w.id}
                    onChange={() => setWeight(w.id)}
                  />
                  {w.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold">Ink colour</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {INKS.map((i) => (
                <label
                  key={i.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
                    ink === i.id
                      ? 'border-primary bg-primary-surface font-semibold'
                      : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    name="studio-ink"
                    className="sr-only"
                    checked={ink === i.id}
                    onChange={() => setInk(i.id)}
                  />
                  <span
                    className="size-3 rounded-full"
                    style={{ background: i.color }}
                    aria-hidden
                  />
                  {i.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <p className="mt-5 flex gap-2 rounded-xl bg-blush/60 p-3 text-xs text-heading">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          Preview only. What you type stays in this browser: it is not saved or sent, and nothing is
          signed. Styles marked In the app are available when you sign today; the other styles,
          slant, flourishes, ink weight and colour are coming to Signature Studio.
        </p>
      </div>
    </div>
  );
}
