'use client';
import { useActionState, useState, useTransition } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormStatus } from '@/components/ui/form-status';
import {
  cancelRequestAction,
  retryFinalizeAction,
  verifyIntegrityAction,
  type IntegrityReport,
} from '../actions';

export function RequestActions({
  documentId,
  requestId,
  canSend,
  open,
  status,
}: {
  documentId: string;
  requestId: string;
  canSend: boolean;
  open: boolean;
  status: string;
}) {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelRequestAction.bind(null, documentId, requestId),
    null,
  );
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  const row = (label: string, r: { ok: boolean } | null) =>
    r ? (
      <li className={`flex items-center gap-2 ${r.ok ? 'text-success' : 'text-error'}`}>
        {r.ok ? (
          <ShieldCheck className="size-4" aria-hidden />
        ) : (
          <ShieldAlert className="size-4" aria-hidden />
        )}
        {label}: {r.ok ? 'matches its recorded hash' : 'does NOT match its recorded hash'}
      </li>
    ) : null;

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await verifyIntegrityAction(requestId);
            if (r.ok && r.report) setReport(r.report);
            else setError(r.message ?? 'Could not run the check.');
          })
        }
      >
        <ShieldCheck className="size-4" aria-hidden /> Verify integrity
      </Button>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {report ? (
        <ul className="flex flex-col gap-1 text-xs" aria-label="Integrity results">
          {row('Original PDF', report.original)}
          {row('Signed copy', report.signed)}
          {row('Certificate', report.certificate)}
          <li
            className={`flex items-center gap-2 ${report.chain.ok ? 'text-success' : 'text-error'}`}
          >
            {report.chain.ok ? (
              <ShieldCheck className="size-4" aria-hidden />
            ) : (
              <ShieldAlert className="size-4" aria-hidden />
            )}
            Evidence log:{' '}
            {report.chain.ok
              ? `intact (${report.chain.events} events)`
              : `broken at event ${(report.chain.brokenAt ?? 0) + 1}`}
          </li>
        </ul>
      ) : null}
      {canSend && status === 'finalization_failed' ? (
        <Button
          type="button"
          size="sm"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await retryFinalizeAction(documentId, requestId);
              setRetryMsg(r?.message ?? null);
            })
          }
        >
          Try creating the signed copy again
        </Button>
      ) : null}
      {retryMsg ? <Alert tone="info">{retryMsg}</Alert> : null}
      {canSend && open ? (
        confirm ? (
          <form action={cancelAction} className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-heading">
              Reason (optional, kept in the history)
              <input
                name="reason"
                maxLength={500}
                className="h-9 rounded-lg border border-border px-2 font-normal"
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="danger" loading={cancelling}>
                Cancel request
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-error"
            onClick={() => setConfirm(true)}
          >
            Cancel request
          </Button>
        )
      ) : null}
      <FormStatus state={cancelState} />
    </div>
  );
}
