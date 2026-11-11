import { RECIPIENT_ROLES, getConfigValue } from '@st/core';
import { db } from '@/lib/db';
import { loadPreparation } from '@/lib/documents';
import { PrepareHeader } from '@/components/documents/prepare-header';
import { SignersEditor } from './signers-editor';

export const metadata = { title: 'Signers' };

export default async function SignersStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadPreparation(id);
  const maxSigners = await getConfigValue(db(), 'limits.max_signers_per_request', 5);
  return (
    <>
      <PrepareHeader
        documentId={id}
        title={data.document.title}
        status={data.document.status}
        step="signers"
        canEdit={data.canEdit}
      />
      <SignersEditor
        documentId={id}
        disabled={!data.canEdit}
        maxSigners={maxSigners}
        roles={RECIPIENT_ROLES}
        initialOrderEnabled={data.document.signingOrderEnabled}
        initial={data.recipients.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role,
          signingOrder: r.signingOrder,
          authMethod: r.authMethod,
        }))}
        fieldCounts={Object.fromEntries(
          data.recipients.map((r) => [
            r.id,
            data.fields.filter((f) => f.recipientId === r.id).length,
          ]),
        )}
      />
    </>
  );
}
