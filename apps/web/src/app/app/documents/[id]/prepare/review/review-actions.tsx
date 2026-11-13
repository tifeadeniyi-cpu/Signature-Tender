'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PenLine, Send } from 'lucide-react';
import type { DocumentStatus } from '@st/core';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import {
  markReadyAction,
  deleteDraftAction,
  sendTestAction,
  sendLiveAction,
} from '../../../actions';

export function ReviewActions({
  selfSign = false,
  documentId,
  canEdit,
  ready,
  status,
  sendBlockedReason,
  testEnabled,
  liveNote,
  notice,
}: {
  /** "Sign it yourself": the sender is the only signer, so the button signs instead of sending. */
  selfSign?: boolean;
  documentId: string;
  canEdit: boolean;
  ready: boolean;
  status: DocumentStatus;
  sendBlockedReason: string | null;
  testEnabled: boolean;
  /** Present only when real sending is switched on; explains the credit or price. */
  liveNote: string | null;
  /** Specialized-documents notice from configuration; the sender must confirm it to send. */
  notice: { intro: string; categories: string[]; confirm: string } | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const [ack, setAck] = useState(false);
  const needAck = notice !== null && !ack;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {canEdit && status !== 'ready_to_send' ? (
        <Button
          type="button"
          variant="secondary"
          disabled={!ready}
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await markReadyAction(documentId);
              setMsg({ ok: r.ok, text: r.message ?? '' });
              if (r.ok) router.refresh();
            })
          }
        >
          Mark ready to send
        </Button>
      ) : null}
      {sendBlockedReason ? (
        <>
          <Button type="button" disabled aria-describedby="send-blocked">
            <Send className="size-4" aria-hidden /> Send for signature
          </Button>
          <p id="send-blocked" className="text-xs">
            {sendBlockedReason}
          </p>
        </>
      ) : (
        <>
          {notice ? (
            <div className="rounded-xl border border-warning/30 bg-warning-bg p-3 text-sm">
              <p className="font-semibold text-heading">Check the document type</p>
              <p className="mt-1">{notice.intro}</p>
              <ul className="mt-2 list-disc pl-5 text-xs">
                {notice.categories.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <label className="mt-3 flex items-start gap-2 text-sm text-heading">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                <span>{notice.confirm}</span>
              </label>
            </div>
          ) : null}
          {liveNote !== null ? (
            <>
              <Button
                type="button"
                disabled={status !== 'ready_to_send' || pending || needAck}
                loading={pending}
                aria-describedby="send-live-note"
                onClick={() =>
                  start(async () => {
                    const r = await sendLiveAction(documentId, ack);
                    if (r && !r.ok) setMsg({ ok: false, text: r.message ?? 'Could not send.' });
                  })
                }
              >
                {selfSign ? (
                  <>
                    <PenLine className="size-4" aria-hidden />{' '}
                    {liveNote?.startsWith('Free') ? 'Sign now' : 'Pay and sign now'}
                  </>
                ) : (
                  <>
                    <Send className="size-4" aria-hidden /> Send for signature
                  </>
                )}
              </Button>
              <p id="send-live-note" className="text-xs">
                {status !== 'ready_to_send' ? 'Mark the document ready to send first.' : liveNote}
              </p>
            </>
          ) : null}
          {testEnabled ? (
            <>
              <Button
                type="button"
                variant={liveNote !== null ? 'secondary' : 'primary'}
                disabled={status !== 'ready_to_send' || pending || needAck}
                loading={pending}
                aria-describedby="send-test-note"
                onClick={() =>
                  start(async () => {
                    const r = await sendTestAction(documentId, ack);
                    if (r && !r.ok) setMsg({ ok: false, text: r.message ?? 'Could not send.' });
                  })
                }
              >
                {selfSign ? (
                  <>
                    <PenLine className="size-4" aria-hidden /> Sign a test copy now
                  </>
                ) : (
                  <>
                    <Send className="size-4" aria-hidden /> Send test request
                  </>
                )}
              </Button>
              <p id="send-test-note" className="text-xs">
                {status !== 'ready_to_send'
                  ? 'Mark the document ready to send first.'
                  : liveNote !== null
                    ? 'Test requests are free and marked TEST on every page and email.'
                    : 'Test requests are free and marked TEST on every page and email. Real sending opens after security and legal review.'}
              </p>
            </>
          ) : null}
        </>
      )}
      {msg ? <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}
      {canEdit ? (
        <div className="border-t border-border pt-3">
          {confirmDelete ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-heading">
                Delete this draft? It will be removed from your documents list.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  loading={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteDraftAction(documentId);
                      if (r && !r.ok) setMsg({ ok: false, text: r.message ?? 'Could not delete.' });
                    })
                  }
                >
                  Delete draft
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-error"
              onClick={() => setConfirmDelete(true)}
            >
              Delete draft
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
