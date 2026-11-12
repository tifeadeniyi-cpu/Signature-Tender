import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/feedback';
import { Stepper, type StepKey } from './stepper';
import { StatusBadge } from './status-badge';
import type { DocumentStatus } from '@st/core';

export function PrepareHeader({
  documentId,
  title,
  status,
  step,
  canEdit,
}: {
  documentId: string;
  title: string;
  status: DocumentStatus;
  step: StepKey;
  canEdit: boolean;
}) {
  return (
    <>
      <PageHeader title={title} actions={<StatusBadge status={status} />} />
      <Stepper current={step} documentId={documentId} />
      {!canEdit ? (
        <Alert tone="info" className="mb-4">
          You can view this document, but your role does not allow you to change it.
        </Alert>
      ) : null}
    </>
  );
}
