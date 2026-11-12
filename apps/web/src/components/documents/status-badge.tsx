import type { DocumentStatus, RequestStatus } from '@st/core';
import { Badge } from '@/components/ui/feedback';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
const DOC: Record<DocumentStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  uploading: { label: 'Uploading', tone: 'info' },
  processing: { label: 'Processing', tone: 'info' },
  ready_for_preparation: { label: 'Draft', tone: 'neutral' },
  preparing: { label: 'Draft', tone: 'neutral' },
  ready_to_send: { label: 'Ready to send', tone: 'success' },
};
const REQ: Record<RequestStatus, { label: string; tone: Tone }> = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'warning' },
  payment_processing: { label: 'Payment processing', tone: 'info' },
  ready_to_dispatch: { label: 'Ready to dispatch', tone: 'info' },
  queued: { label: 'Queued', tone: 'info' },
  sent: { label: 'Sent', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'info' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  declined: { label: 'Declined', tone: 'error' },
  expired: { label: 'Expired', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
  finalization_failed: { label: 'Needs attention', tone: 'error' },
};

export function StatusBadge({
  status,
  requestStatus,
  isTest,
}: {
  status: DocumentStatus;
  requestStatus?: string | null;
  isTest?: boolean | null;
}) {
  const s =
    requestStatus && requestStatus in REQ ? REQ[requestStatus as RequestStatus] : DOC[status];
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={s.tone === 'neutral' ? 'neutral' : s.tone}>{s.label}</Badge>
      {requestStatus && isTest ? <Badge tone="warning">Test</Badge> : null}
    </span>
  );
}
