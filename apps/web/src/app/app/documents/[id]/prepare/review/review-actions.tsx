'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import type { DocumentStatus } from '@st/core';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { markReadyAction, deleteDraftAction } from '../../../actions';

export function ReviewActions({
  documentId,
  canEdit,
  ready,
  status,
  sendBlockedReason,
}: {
  documentId: string;
  canEdit: boolean;
  ready: boolean;
  status: DocumentStatus;
  sendBlockedReason: string | null;
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
      <Button type="button" disabled aria-describedby="send-blocked">
        <Send className="size-4" aria-hidden /> Send for signature
      </Button>
      {sendBlockedReason ? (
        <p id="send-blocked" className="text-xs">
          {sendBlockedReason}
        </p>
      ) : (
        <p id="send-blocked" className="text-xs">
          Sending arrives in the next release.
        </p>
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
