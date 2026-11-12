'use client';
import { useActionState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import type { PreviewKey } from '@/lib/email/previews';
import { sendTestEmailAction } from './actions';

export function SendTestButton({ variant }: { variant: PreviewKey }) {
  const [state, run, pending] = useActionState(sendTestEmailAction.bind(null, variant), null);
  return (
    <form action={run} className="flex flex-col gap-2">
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        <Send className="size-4" aria-hidden /> Send this preview to me
      </Button>
      {state ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
    </form>
  );
}
