import { DOCUMENT_TYPES, getConfigValue, hasPermission } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { PermissionDenied } from '@/components/ui/feedback';
import { Stepper } from '@/components/documents/stepper';
import { UploadForm } from './upload-form';

export const metadata = { title: 'New document' };

export default async function NewDocumentPage() {
  const { membership } = await requireWorkspace();
  if (!hasPermission(membership.permissions, 'documents.create'))
    return <PermissionDenied what="create documents" />;
  const maxMb = await getConfigValue(db(), 'limits.max_upload_mb', 25);
  return (
    <div>
      <PageHeader
        title="New document"
        description="Upload a PDF. You'll add signers and place fields next."
      />
      <Stepper current="document" />
      <UploadForm
        maxMb={maxMb}
        types={DOCUMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
      />
    </div>
  );
}
