import Link from 'next/link';
import { Users } from 'lucide-react';
import { loadPreparation } from '@/lib/documents';
import { PrepareHeader } from '@/components/documents/prepare-header';
import { EmptyState } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { FieldEditor } from './field-editor';

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
          documentId={id}
          disabled={!data.canEdit}
          pageCount={data.file?.pageCount ?? 0}
          recipients={fillable.map((r) => ({ id: r.id, name: r.name, colorIndex: r.colorIndex }))}
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
