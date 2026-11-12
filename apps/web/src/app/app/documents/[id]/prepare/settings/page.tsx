import { loadPreparation } from '@/lib/documents';
import { PrepareHeader } from '@/components/documents/prepare-header';
import { SettingsForm } from './settings-form';
import { saveSettingsAction } from '../../../actions';

export const metadata = { title: 'Signing settings' };

export default async function SettingsStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadPreparation(id);
  return (
    <>
      <PrepareHeader
        documentId={id}
        title={data.document.title}
        status={data.document.status}
        step="settings"
        canEdit={data.canEdit}
      />
      <SettingsForm
        nav={{
          onSave: saveSettingsAction.bind(null, id),
          backHref: `/app/documents/${id}/prepare/fields`,
          nextHref: `/app/documents/${id}/prepare/review`,
          nextLabel: 'Next: Review',
        }}
        disabled={!data.canEdit}
        initial={data.document.settings}
        initialMessage={data.document.emailMessage ?? ''}
      />
    </>
  );
}
