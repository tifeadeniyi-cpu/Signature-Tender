import Link from 'next/link';
import { Users } from 'lucide-react';
import { loadPreparation } from '@/lib/documents';
import { PrepareHeader } from '@/components/documents/prepare-header';
import { EmptyState } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { signatureBlockSettings, documentSettingsSchema } from '@st/core';
import { FieldEditor } from './field-editor';
import { saveFieldsAction } from '../../../actions';

export const metadata = { title: 'Place fields' };

export default async function FieldsStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadPreparation(id);
  const fillable = data.recipients.filter((r) => r.role === 'signer' || r.role === 'approver');
  return (
    <>
      <PrepareHeader
        documentId={id}
        title={data.document.title}
        status={data.document.status}
        step="fields"
        canEdit={data.canEdit}
      />
      {fillable.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="Add a signer first"
          action={
            <Link href={`/app/documents/${id}/prepare/signers`} className={buttonClass('primary')}>
              Add signers
            </Link>
          }
        >
          Fields are assigned to the people who sign or approve the document.
        </EmptyState>
      ) : (
        <FieldEditor
          nav={{
            onSave: saveFieldsAction.bind(null, id),
            fileSrc: `/api/documents/${id}/file`,
            backHref: `/app/documents/${id}/prepare/signers`,
            nextHref: `/app/documents/${id}/prepare/settings`,
            nextLabel: 'Next: Settings',
          }}
          disabled={!data.canEdit}
          pageCount={data.file?.pageCount ?? 0}
          recipients={fillable.map((r) => ({
            id: r.id,
            name: r.name,
            colorIndex: r.colorIndex,
            role: r.role,
          }))}
          signatureBlock={{
            format: signatureBlockSettings(data.document.settings).format,
            timeZone: documentSettingsSchema.parse(data.document.settings ?? {}).timeZone,
          }}
          initial={data.fields.map((f) => ({
            id: f.id,
            recipientId: f.recipientId,
            type: f.type,
            page: f.page,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            required: f.required,
            label: f.label,
            options: f.options as string[] | null,
          }))}
        />
      )}
    </>
  );
}
