import { loadPreparation } from '@/lib/documents';
import { PrepareHeader } from '@/components/documents/prepare-header';
import { SettingsForm } from './settings-form';

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
        documentId={id}
        disabled={!data.canEdit}
        initial={data.document.settings}
        initialMessage={data.document.emailMessage ?? ''}
      />
    </>
  );
}
