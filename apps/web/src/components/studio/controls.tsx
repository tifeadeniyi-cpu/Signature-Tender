'use client';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Called while dragging (no history step). */
  onChange: (v: number) => void;
  /** Called when the drag ends (one history step). */
  onCommit?: () => void;
  format?: (v: number) => string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <label htmlFor={id} className="font-medium text-heading">
          {label}
        </label>
        <span className="tabular-nums text-xs text-slate-text">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        className="h-6 w-full cursor-pointer accent-[#0D1B33]"
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-text">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start justify-between gap-3', disabled && 'opacity-60')}>
      <div>
        <label htmlFor={id} className="text-sm font-medium text-heading">
          {label}
        </label>
        {hint ? <p className="text-xs text-slate-text">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-slate-300',
        )}
      >
        <span
          className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')}
        />
      </button>
    </div>
  );
}

export function PanelSection({
  title,
  children,
  action,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  if (collapsible)
    return (
      <details open={defaultOpen} className="group border-t border-border pt-4 first:border-t-0 first:pt-0">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold uppercase tracking-wide text-heading">
          {title}
          <span aria-hidden className="text-slate-text transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-4">{children}</div>
      </details>
    );
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-heading">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ChipButton({
  active,
  children,
  className,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
        active ? 'border-primary bg-primary text-white' : 'border-border bg-white text-heading hover:border-primary/40 hover:bg-ivory',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
