import { DOCUMENT_TYPES, getConfigValue, hasPermission, listTemplates } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { PermissionDenied } from '@/components/ui/feedback';
import { NewTemplateForm } from './new-template-form';

export const metadata = { title: 'New template' };

export default async function NewTemplatePage() {
  const { user, membership } = await requireWorkspace();
  if (!hasPermission(membership.permissions, 'templates.manage'))
    return <PermissionDenied what="create templates" />;
  const maxMb = await getConfigValue(db(), 'limits.max_upload_mb', 25);
  const { categories } = await listTemplates(db(), { userId: user.id }, membership.workspace.id);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Create template"
        description="Upload the PDF. Next you'll name the roles (like Artist or Venue) and place their fields."
      />
      <NewTemplateForm
        maxMb={maxMb}
        types={DOCUMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        categories={categories}
      />
    </div>
  );
}
