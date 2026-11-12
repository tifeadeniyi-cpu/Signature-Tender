import { loadTemplatePage } from '@/lib/templates';
import { SettingsForm } from '../../../documents/[id]/prepare/settings/settings-form';
import { saveTemplateSettingsAction } from '../../actions';

export const metadata = { title: 'Template settings' };

export default async function TemplateSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadTemplatePage(id);
  return (
    <SettingsForm
      nav={{
        onSave: saveTemplateSettingsAction.bind(null, id),
        backHref: `/app/templates/${id}/fields`,
        nextHref: `/app/templates/${id}`,
        nextLabel: 'Next: Publish',
        hideExpiry: true,
      }}
      disabled={!data.canEdit || data.template.status === 'archived'}
      initial={data.working.settings}
      initialMessage={data.working.emailMessage ?? ''}
    />
  );
}
