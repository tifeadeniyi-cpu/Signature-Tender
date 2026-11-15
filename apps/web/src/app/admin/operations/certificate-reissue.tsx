'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import type { ActionState } from '@/lib/action-result';
import { reissueCertificatesAction } from './certificate-actions';

export function CertificateReissue({ legacy }: { legacy: number }) {
  const [state, run, pending] = useActionState<ActionState | null>(
    () => reissueCertificatesAction(),
    null,
  );
  return (
    <form action={run} className="flex flex-col gap-3">
      <p className="text-sm">
        {legacy === 0
          ? 'Every completed request has a Certificate of Completion in the current design.'
          : `${legacy} completed ${legacy === 1 ? 'request still has' : 'requests still have'} an old-design certificate.`}
      </p>
      {legacy > 0 ? (
        <Button type="submit" loading={pending} className="self-start">
          Re-issue certificates (25 at a time)
        </Button>
      ) : null}
      {state?.message ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
    </form>
  );
}
