'use client';
import { useState } from 'react';
import { Calendar, FileText, ListChecks, PenLine, RotateCcw, Type, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppFrame, PaperPage, PrepareSteps } from './mocks';
import { DemoLabel } from './primitives';

const SIGNERS = [
  {
    id: 'a',
    name: 'Avery Lane',
    role: 'Signer 1',
    box: 'border-gold bg-soft-gold/85 text-primary',
    dot: 'bg-gold',
  },
  {
    id: 'b',
    name: 'Sam Ortiz',
    role: 'Signer 2',
    box: 'border-sky-500 bg-sky-50/90 text-sky-800',
    dot: 'bg-sky-500',
  },
] as const;

const TYPES = [
  { id: 'signature', label: 'Signature', icon: PenLine, w: 34, h: 9 },
  { id: 'initials', label: 'Initials', icon: Type, w: 16, h: 9 },
  { id: 'date', label: 'Date signed', icon: Calendar, w: 22, h: 7 },
  { id: 'text', label: 'Text', icon: FileText, w: 30, h: 7 },
  { id: 'checkbox', label: 'Checkbox', icon: ListChecks, w: 7, h: 6 },
] as const;

type Field = {
  key: number;
  type: (typeof TYPES)[number]['id'];
  signer: 'a' | 'b';
  x: number;
  y: number;
};

const START: Field[] = [
  { key: 1, type: 'signature', signer: 'a', x: 6, y: 74 },
  { key: 2, type: 'date', signer: 'a', x: 44, y: 76 },
];

/**
 * Read-only preparation demo: choose a field type and a demo signer, then click the page to place
 * it. Everything stays in this browser tab; no document or signature is created.
 */
export function PrepDemo({ signatureFont }: { signatureFont: string }) {
  const [signer, setSigner] = useState<'a' | 'b'>('b');
  const [type, setType] = useState<Field['type']>('signature');
  const [fields, setFields] = useState<Field[]>(START);
  const [next, setNext] = useState(3);

  const place = (x: number, y: number) => {
    const t = TYPES.find((t) => t.id === type)!;
    setFields((f) => [
      ...f,
      {
        key: next,
        type,
        signer,
        x: Math.min(Math.max(x - t.w / 2, 2), 98 - t.w),
        y: Math.min(Math.max(y - t.h / 2, 12), 96 - t.h),
      },
    ]);
    setNext((n) => n + 1);
  };
  const s = SIGNERS.find((x) => x.id === signer)!;

  return (
    <figure className="flex flex-col gap-3">
      <AppFrame active="Documents" compact interactive className="border-border">
        <div className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-base">Place fields</p>
            <PrepareSteps />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="relative">
              <PaperPage title="Service Agreement" className="aspect-[8.5/9] select-none">
                {fields.map((f) => {
                  const t = TYPES.find((t) => t.id === f.type)!;
                  const owner = SIGNERS.find((x) => x.id === f.signer)!;
                  return (
                    <span
                      key={f.key}
                      className={cn(
                        'absolute flex items-center justify-center overflow-hidden rounded border-2 border-dashed text-[10px] font-semibold',
                        owner.box,
                      )}
                      style={{
                        left: `${f.x}%`,
                        top: `${f.y}%`,
                        width: `${t.w}%`,
                        height: `${t.h}%`,
                      }}
                    >
                      {f.type === 'signature' ? (
                        <span
                          className="truncate text-base leading-none"
                          style={{ fontFamily: signatureFont }}
                        >
                          {owner.name}
                        </span>
                      ) : f.type === 'checkbox' ? (
                        '☐'
                      ) : (
                        t.label
                      )}
                    </span>
                  );
                })}
              </PaperPage>
              <button
                type="button"
                className="absolute inset-0 cursor-crosshair rounded-md focus-visible:outline-offset-4"
                aria-label={`Place a ${TYPES.find((t) => t.id === type)!.label} field for ${s.name} on the page`}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  // Keyboard activation has no pointer position: use the lower part of the page.
                  if (e.detail === 0)
                    return place(10 + ((next * 17) % 60), 40 + ((next * 11) % 40));
                  place(
                    ((e.clientX - r.left) / r.width) * 100,
                    ((e.clientY - r.top) / r.height) * 100,
                  );
                }}
              />
            </div>
            <div className="flex flex-col gap-3">
              <fieldset>
                <legend className="text-[11px] font-semibold text-heading">Recipient</legend>
                <div className="mt-1.5 flex flex-col gap-1">
                  {SIGNERS.map((x) => (
                    <label
                      key={x.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-[11px]',
                        signer === x.id ? 'border-primary bg-primary-surface' : 'border-border',
                      )}
                    >
                      <input
                        type="radio"
                        name="demo-signer"
                        className="sr-only"
                        checked={signer === x.id}
                        onChange={() => setSigner(x.id)}
                      />
                      <span className={cn('size-2.5 rounded-full', x.dot)} aria-hidden />
                      <span>
                        <span className="block font-semibold">{x.name}</span>
                        <span className="text-slate-text">{x.role}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-[11px] font-semibold text-heading">Field</legend>
                <div className="mt-1.5 grid grid-cols-2 gap-1 sm:grid-cols-1">
                  {TYPES.map((t) => (
                    <label
                      key={t.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px]',
                        type === t.id
                          ? 'border-primary bg-primary-surface font-semibold text-primary'
                          : 'border-border',
                      )}
                    >
                      <input
                        type="radio"
                        name="demo-field"
                        className="sr-only"
                        checked={type === t.id}
                        onChange={() => setType(t.id)}
                      />
                      <t.icon className="size-3.5" aria-hidden /> {t.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setFields((f) => f.slice(0, -1))}
                  disabled={!fields.length}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] disabled:opacity-40"
                >
                  <X className="size-3" aria-hidden /> Undo
                </button>
                <button
                  type="button"
                  onClick={() => setFields(START)}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px]"
                >
                  <RotateCcw className="size-3" aria-hidden /> Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      </AppFrame>
      <figcaption className="flex flex-wrap items-center gap-2 text-sm">
        <DemoLabel />
        <span aria-live="polite">
          {fields.length} field{fields.length === 1 ? '' : 's'} placed. Click the page to add a
          field for {s.name}. Nothing is saved.
        </span>
      </figcaption>
    </figure>
  );
}
