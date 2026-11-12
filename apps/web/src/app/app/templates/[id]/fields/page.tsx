import Link from 'next/link';
import { Users } from 'lucide-react';
import { loadTemplatePage } from '@/lib/templates';
import { EmptyState } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { FieldEditor } from '../../../documents/[id]/prepare/fields/field-editor';
import { saveTemplateFieldsAction } from '../../actions';

export const metadata = { title: 'Template fields' };

export default async function TemplateFields({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadTemplatePage(id);
  const fillable = data.working.recipients.filter(
    (r) => r.role === 'signer' || r.role === 'approver',
  );
  if (!fillable.length)
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title="Add roles first"
        action={
          <Link href={`/app/templates/${id}/roles`} className={buttonClass('primary')}>
            Add roles
          </Link>
        }
      >
        Fields are assigned to roles that sign or approve.
      </EmptyState>
    );
  return (
    <FieldEditor
      nav={{
        onSave: saveTemplateFieldsAction.bind(null, id),
        fileSrc: `/api/templates/${id}/file`,
        backHref: `/app/templates/${id}/roles`,
        nextHref: `/app/templates/${id}/settings`,
        nextLabel: 'Next: Settings',
      }}
      disabled={!data.canEdit || data.template.status === 'archived'}
      pageCount={data.working.pageCount}
      recipients={fillable.map((r) => ({ id: r.id, name: r.label, colorIndex: r.colorIndex }))}
      initial={data.working.fields.map((f) => ({
        id: f.id,
        recipientId: f.recipientId,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        required: f.required,
        label: f.label ?? null,
        options: f.options ?? null,
      }))}
    />
  );
}
