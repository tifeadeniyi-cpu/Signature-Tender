'use client';
import { useActionState } from 'react';
import { CreditCard } from 'lucide-react';
import { saveCardAction } from '@/app/app/billing/actions';
import { Button } from '@/components/ui/button';

/** Opens Stripe to save the company's card (nothing is charged). */
export function SaveCardButton({
  returnPath,
  label = 'Add a card',
  variant = 'primary',
}: {
  returnPath: string;
  label?: string;
  variant?: 'primary' | 'secondary' | 'gold';
}) {
  const [state, act, pending] = useActionState(saveCardAction.bind(null, returnPath), null);
  return (
    <form action={act} className="flex flex-col items-start gap-2">
      <Button type="submit" variant={variant} disabled={pending}>
        <CreditCard className="size-4" aria-hidden /> {pending ? 'Opening Stripe…' : label}
      </Button>
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-error">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
