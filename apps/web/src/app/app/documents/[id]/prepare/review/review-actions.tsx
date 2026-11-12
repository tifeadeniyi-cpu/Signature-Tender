'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
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
  documentId,
  canEdit,
  ready,
  status,
  sendBlockedReason,
  testEnabled,
  liveNote,
}: {
  documentId: string;
  canEdit: boolean;
  ready: boolean;
  status: DocumentStatus;
  sendBlockedReason: string | null;
  testEnabled: boolean;
  /** Present only when real sending is switched on; explains the credit or price. */
  liveNote: string | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

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
          {liveNote !== null ? (
            <>
              <Button
                type="button"
                disabled={status !== 'ready_to_send' || pending}
                loading={pending}
                aria-describedby="send-live-note"
                onClick={() =>
                  start(async () => {
                    const r = await sendLiveAction(documentId);
                    if (r && !r.ok) setMsg({ ok: false, text: r.message ?? 'Could not send.' });
                  })
                }
              >
                <Send className="size-4" aria-hidden /> Send for signature
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
                disabled={status !== 'ready_to_send' || pending}
                loading={pending}
                aria-describedby="send-test-note"
                onClick={() =>
                  start(async () => {
                    const r = await sendTestAction(documentId);
                    if (r && !r.ok) setMsg({ ok: false, text: r.message ?? 'Could not send.' });
                  })
                }
              >
                <Send className="size-4" aria-hidden /> Send test request
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
