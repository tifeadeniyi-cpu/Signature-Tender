import type { ComponentProps } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/cn';

export function TextField({
  label,
  error,
  hint,
  className,
  id,
  required,
  ...props
}: ComponentProps<'input'> & { label: string; error?: string | undefined; hint?: string }) {
  const auto = useId();
  const inputId = id ?? auto;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-heading">
        {label}
        {required ? <span className="text-error"> *</span> : null}
      </label>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'h-10 rounded-lg border bg-white px-3 text-sm text-heading placeholder:text-slate-400',
          'focus:border-primary-hover focus:outline-none focus:ring-2 focus:ring-primary-surface',
          error ? 'border-error' : 'border-border',
        )}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-sm text-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-slate-text">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  error,
  children,
  className,
  id,
  ...props
}: ComponentProps<'select'> & { label: string; error?: string | undefined }) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={selectId} className="text-sm font-medium text-heading">
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : undefined}
        className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-heading focus:border-primary-hover focus:outline-none focus:ring-2 focus:ring-primary-surface"
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p id={`${selectId}-error`} className="text-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
