import { RECIPIENT_ROLES, getConfigValue } from '@st/core';
import { db } from '@/lib/db';
import { loadTemplatePage } from '@/lib/templates';
import { RolesEditor } from './roles-editor';

export const metadata = { title: 'Template roles' };

export default async function TemplateRoles({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadTemplatePage(id);
  const maxSigners = await getConfigValue(db(), 'limits.max_signers_per_request', 5);
  return (
    <RolesEditor
      templateId={id}
      disabled={!data.canEdit || data.template.status === 'archived'}
      maxSigners={maxSigners}
      roles={RECIPIENT_ROLES}
      initialOrderEnabled={data.working.signingOrderEnabled}
      initial={[...data.working.recipients]
        .sort((a, b) => a.signingOrder - b.signingOrder)
        .map((r) => ({ id: r.id, label: r.label, role: r.role, authMethod: r.authMethod }))}
    />
  );
}
