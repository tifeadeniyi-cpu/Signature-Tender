'use client';
import { useActionState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { payForDesignAction } from '../../actions';

export function PayButton({ designId, label }: { designId: string; label: string }) {
  const [state, action, pending] = useActionState(payForDesignAction.bind(null, designId), null);
  return (
    <form action={action} className="flex flex-col gap-3">
      {state && !state.ok ? <Alert tone="error">{state.message}</Alert> : null}
      <Button type="submit" size="lg" loading={pending} className="w-full">
        <Lock className="size-4" aria-hidden /> {label}
      </Button>
    </form>
  );
}
