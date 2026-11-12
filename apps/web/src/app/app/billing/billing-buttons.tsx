'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import type { BillingActionState } from './actions';

/** A form button for a billing server action, with its error shown right below it. */
export function ActionButton({
  action,
  label,
  variant = 'primary',
  disabled,
  describedBy,
  className,
}: {
  action: (prev: BillingActionState) => Promise<BillingActionState>;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={className}>
      <Button
        type="submit"
        variant={variant}
        loading={pending}
        disabled={disabled}
        aria-describedby={describedBy}
        className="w-full"
      >
        {label}
      </Button>
      {state ? (
        <Alert tone={state.ok ? 'success' : 'error'} className="mt-2">
          {state.message}
        </Alert>
      ) : null}
    </form>
  );
}
