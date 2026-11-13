'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { retryJobAction } from '../actions';

export function RetryJobForm({
  jobId,
  needsReconnect,
  provider,
}: {
  jobId: string;
  needsReconnect: boolean;
  provider: string;
}) {
  const [state, act, pending] = useActionState(retryJobAction, null);
  return (
    <form action={act} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="jobId" value={jobId} />
      {needsReconnect ? (
        <p className="text-sm">
          <Link
            href={`/app/integrations/${provider}`}
            className="font-semibold text-primary underline"
          >
            Reconnect
          </Link>{' '}
          first, then retry.
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Retry
      </Button>
      {state ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
    </form>
  );
}
