'use client';
import { Check, PenLine, Lock, CalendarDays } from 'lucide-react';
import { roleLabel, type SignatureDisplayFormat } from '@st/core/signature-block/layout';
import { cn } from '@/lib/cn';
import { SignatureBlock } from '@/components/signature-block/signature-block';
import type { Mark } from './studio';

/** The sender's signature block choice, the zone for signing times, and who is signing. */
export type BlockSettings = {
  format: SignatureDisplayFormat;
  timeZone: string;
  name: string;
  role: string;
};

export type Field = {
  id: string;
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label: string | null;
  options: string[] | null;
  savedValue: string | null;
  savedSignatureId: string | null;
};

export type OtherField = {
  id: string;
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string | null;
  value: string | null;
  dataUrl: string | null;
  recipientName: string;
  recipientRole: string | null;
  signedAt: string | null;
};

export const TYPE_LABEL: Record<string, string> = {
  signature: 'Signature',
  initials: 'Initials',
  date_signed: 'Date signed',
  name: 'Full name',
  email: 'Email',
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  dropdown: 'Dropdown',
  radio: 'Choice',
};

export const fieldName = (f: { type: string; label: string | null }) =>
  f.label || TYPE_LABEL[f.type] || f.type;

/** Client-side check mirroring the server's rules; the server validates again on completion. */
export function fieldProblem(f: Field, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email.';
  if (f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(v)) return 'Enter a number.';
  if ((f.type === 'dropdown' || f.type === 'radio') && !f.options?.includes(v))
    return 'Choose one of the options.';
  return null;
}

const pos = (f: { x: number; y: number; width: number; height: number }) => ({
  left: `${f.x * 100}%`,
  top: `${f.y * 100}%`,
  width: `${f.width * 100}%`,
  height: `${f.height * 100}%`,
});

/**
 * The fields on one page, positioned with page-relative percentages so they stay aligned at any
 * zoom, fit mode or screen size. `pageHeight` is the rendered page height in CSS pixels, and
 * `pagePt` the page size in PDF points (signature blocks are laid out in points, like the PDF).
 * Applied marks show the same signature block the signed PDF will carry, with the time pending.
 */
export function FieldLayer({
  page,
  pageHeight,
  pageWidth,
  pagePt,
  block,
  fields,
  others,
  values,
  applied,
  activeId,
  isDone,
  today,
  onActivate,
  onChange,
}: {
  page: number;
  pageHeight: number;
  pageWidth: number;
  pagePt: { width: number; height: number };
  block: BlockSettings;
  fields: Field[];
  others: OtherField[];
  values: Record<string, string>;
  applied: Record<string, Mark>;
  activeId: string | null;
  isDone: (f: Field) => boolean;
  today: string;
  onActivate: (f: Field) => void;
  onChange: (f: Field, value: string) => void;
}) {
  return (
    <>
      {others
        .filter((o) => o.page === page)
        .map((o) => (
          <div
            key={o.id}
            style={pos(o)}
            className="absolute flex items-center overflow-hidden"
            role="img"
            aria-label={`${fieldName(o)} completed by ${o.recipientName}${o.value ? `: ${o.value}` : ''}. Read-only.`}
            title={`Completed by ${o.recipientName}`}
          >
            {o.dataUrl && (o.type === 'signature' || o.type === 'initials') ? (
              <SignatureBlock
                widthPt={o.width * pagePt.width}
                heightPt={o.height * pagePt.height}
                imageSrc={o.dataUrl}
                name={o.recipientName}
                role={roleLabel(o.recipientRole)}
                format={block.format}
                kind={o.type}
                timestamp={
                  o.signedAt
                    ? { state: 'completed', signedAt: o.signedAt, timeZone: block.timeZone }
                    : { state: 'pending' }
                }
              />
            ) : o.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
            ) : o.type === 'checkbox' ? (
              <span
                className="text-heading"
                style={{ fontSize: Math.max(10, o.height * pageHeight * 0.8) }}
              >
                {o.value === 'true' ? '☑' : '☐'}
              </span>
            ) : (
              <span
                className="truncate text-heading"
                style={{ fontSize: Math.max(9, Math.min(16, o.height * pageHeight * 0.6)) }}
              >
                {o.value}
              </span>
            )}
          </div>
        ))}
      {fields
        .filter((f) => f.page === page)
        .map((f) => {
          const h = f.height * pageHeight;
          const w = f.width * pageWidth;
          const fs = Math.max(8, Math.min(18, h * 0.55));
          // "Sign Here" with its icon must fit on one line, even on a small phone.
          const markFs = Math.max(7, Math.min(fs, w / 7));
          const done = isDone(f);
          const active = activeId === f.id;
          const name = fieldName(f);
          const state = `${f.required ? 'required' : 'optional'}, ${done ? 'complete' : 'not complete'}`;
          const frame = cn(
            'absolute rounded-[3px] border-2 transition-shadow',
            active && 'z-10 ring-4 ring-rose-gold/70 shadow-[0_0_0_6px_rgba(230,184,167,0.25)]',
            done
              ? 'border-success/70 bg-success-bg/30'
              : f.required
                ? 'border-amber-500/80 bg-amber-100/70'
                : 'border-dashed border-slate-400 bg-white/70',
          );
          const badge = (
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white',
                done ? 'bg-success' : f.required ? 'bg-primary' : 'hidden',
              )}
            >
              {done ? <Check className="size-3" /> : '*'}
            </span>
          );

          if (f.type === 'signature' || f.type === 'initials') {
            const mark = applied[f.id];
            return (
              <button
                key={f.id}
                id={`field-${f.id}`}
                data-field-id={f.id}
                type="button"
                style={pos(f)}
                className={cn(frame, 'flex items-center justify-center overflow-visible')}
                onClick={() => onActivate(f)}
                onFocus={() => !active && onActivate(f)}
                aria-label={
                  mark
                    ? `${name} applied (${state}). Select to change.`
                    : `${f.type === 'initials' ? 'Initial here' : 'Sign here'}: ${name} (${state})`
                }
              >
                {mark ? (
                  <SignatureBlock
                    widthPt={f.width * pagePt.width}
                    heightPt={f.height * pagePt.height}
                    imageSrc={mark.dataUrl}
                    name={block.name}
                    role={block.role}
                    format={block.format}
                    kind={f.type === 'initials' ? 'initials' : 'signature'}
                    timestamp={{ state: 'pending' }}
                    className="pointer-events-none"
                  />
                ) : (
                  <span
                    className="flex items-center gap-1.5 font-medium whitespace-nowrap text-heading"
                    style={{ fontSize: markFs }}
                  >
                    {w > 60 ? <PenLine className="size-[1.1em] shrink-0" aria-hidden /> : null}
                    {f.type === 'initials' ? 'Initial' : 'Sign Here'}
                  </span>
                )}
                {badge}
              </button>
            );
          }
          if (f.type === 'date_signed') {
            return (
              <div
                key={f.id}
                id={`field-${f.id}`}
                data-field-id={f.id}
                style={{ ...pos(f), fontSize: fs }}
                className="absolute flex items-center gap-1 rounded-[3px] border border-dashed border-slate-400 bg-white/80 px-1 text-heading"
                role="note"
                aria-label={`Date signed: filled in automatically with the server time when you finish (${today}).`}
                title="Filled in automatically when you finish"
              >
                <CalendarDays className="size-[1em] shrink-0 text-slate-500" aria-hidden />
                <span className="truncate">{today}</span>
                <Lock className="ml-auto size-[0.8em] shrink-0 text-slate-400" aria-hidden />
              </div>
            );
          }
          if (f.type === 'checkbox') {
            return (
              <label
                key={f.id}
                style={pos(f)}
                className={cn(frame, 'flex cursor-pointer items-center justify-center')}
              >
                <span className="sr-only">{`${name} (${state})`}</span>
                <input
                  id={`field-${f.id}`}
                  data-field-id={f.id}
                  type="checkbox"
                  checked={values[f.id] === 'true'}
                  onFocus={() => !active && onActivate(f)}
                  onChange={(e) => onChange(f, e.target.checked ? 'true' : 'false')}
                  className="size-full max-h-5 max-w-5 accent-primary"
                />
                {badge}
              </label>
            );
          }
          if (f.type === 'dropdown' || f.type === 'radio') {
            return (
              <div key={f.id} style={pos(f)} className={frame}>
                <select
                  id={`field-${f.id}`}
                  data-field-id={f.id}
                  aria-label={`${name} (${state})`}
                  style={{ fontSize: fs }}
                  value={values[f.id] ?? ''}
                  onFocus={() => !active && onActivate(f)}
                  onChange={(e) => onChange(f, e.target.value)}
                  className="size-full bg-transparent px-1 text-heading focus:outline-none"
                >
                  <option value="">Choose…</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {badge}
              </div>
            );
          }
          const problem = fieldProblem(f, values[f.id] ?? '');
          return (
            <div key={f.id} style={pos(f)} className={cn(frame, problem && 'border-error')}>
              <input
                id={`field-${f.id}`}
                data-field-id={f.id}
                aria-label={`${name} (${state})`}
                aria-invalid={problem ? true : undefined}
                placeholder={f.label ?? TYPE_LABEL[f.type]}
                type={f.type === 'email' ? 'email' : 'text'}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                maxLength={500}
                style={{ fontSize: fs }}
                value={values[f.id] ?? ''}
                onFocus={() => !active && onActivate(f)}
                onChange={(e) => onChange(f, e.target.value)}
                className="size-full bg-transparent px-1 text-heading placeholder:text-slate-500 focus:outline-none"
              />
              {badge}
            </div>
          );
        })}
    </>
  );
}

/** The right-panel editor for a non-signature field: a full-size control, easy to use on touch. */
export function FieldControls({
  field,
  value,
  today,
  onChange,
}: {
  field: Field;
  value: string;
  today: string;
  onChange: (v: string) => void;
}) {
  const name = fieldName(field);
  const id = `panel-${field.id}`;
  const problem = fieldProblem(field, value);
  const tag = (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-semibold',
        field.required ? 'bg-primary-surface text-primary' : 'bg-ivory text-slate-text',
      )}
    >
      {field.required ? 'Required' : 'Optional'}
    </span>
  );
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="font-display text-xl text-primary">
          {name}
        </h2>
        {tag}
      </div>
      {field.type === 'date_signed' ? (
        <p className="text-sm">
          This date is filled in automatically with the server&apos;s time when you finish signing
          (today: {today}). You can&apos;t change it.
        </p>
      ) : field.type === 'checkbox' ? (
        <label className="flex items-start gap-3 rounded-lg border border-border bg-white p-3 text-sm text-heading">
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
            className="mt-0.5 size-5 accent-primary"
          />
          {field.label ? `Check: ${field.label}` : 'Check this box'}
        </label>
      ) : field.type === 'radio' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{name}</legend>
          {(field.options ?? []).map((o) => (
            <label
              key={o}
              className={cn(
                'flex items-center gap-3 rounded-lg border bg-white p-3 text-sm text-heading',
                value === o ? 'border-primary' : 'border-border',
              )}
            >
              <input
                type="radio"
                name={id}
                checked={value === o}
                onChange={() => onChange(o)}
                className="size-4 accent-primary"
              />
              {o}
            </label>
          ))}
        </fieldset>
      ) : field.type === 'dropdown' ? (
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          Choose an option
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-11 rounded-lg border border-border bg-white px-3 font-normal"
          >
            <option value="">Choose…</option>
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          {field.type === 'name'
            ? 'Your full name'
            : field.type === 'email'
              ? 'Your email'
              : `Enter ${name.toLowerCase()}`}
          <input
            value={value}
            maxLength={500}
            type={field.type === 'email' ? 'email' : 'text'}
            inputMode={field.type === 'number' ? 'decimal' : undefined}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-err` : undefined}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              'h-11 rounded-lg border bg-white px-3 font-normal',
              problem ? 'border-error' : 'border-border',
            )}
          />
          {problem ? (
            <span id={`${id}-err`} className="text-xs font-normal text-error">
              {problem}
            </span>
          ) : field.type === 'name' || field.type === 'email' ? (
            <span className="text-xs font-normal">
              Filled in from your invitation. Correct it if it is wrong.
            </span>
          ) : null}
        </label>
      )}
    </section>
  );
}
