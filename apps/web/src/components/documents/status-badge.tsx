import type { DocumentStatus } from '@st/core';
import { Badge } from '@/components/ui/feedback';

const LABELS: Record<
  DocumentStatus,
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  uploading: { label: 'Uploading', tone: 'info' },
  processing: { label: 'Processing', tone: 'info' },
  ready_for_preparation: { label: 'Draft', tone: 'neutral' },
  preparing: { label: 'Draft', tone: 'neutral' },
  ready_to_send: { label: 'Ready to send', tone: 'success' },
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const s = LABELS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
