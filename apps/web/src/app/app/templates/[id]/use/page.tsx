import { RECIPIENT_ROLES, suggestContacts } from '@st/core';
import { db } from '@/lib/db';
import { loadTemplatePage } from '@/lib/templates';
import { Card, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { UseTemplateForm } from './use-form';

export const metadata = { title: 'Use template' };

export default async function UseTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadTemplatePage(id);
  if (!data.canUse)
    return (
      <Alert tone="info">
        This template needs to be active and published, and your role must allow creating documents.
      </Alert>
    );
  const v = data.published!;
  const contacts = await suggestContacts(
    db(),
    { userId: data.user.id },
    data.template.workspaceId,
  ).catch(() => []);
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader
          title={`Use version ${v.version}`}
          description="Fill in who plays each role. Fields, signing order and settings come from the template."
        />
        <UseTemplateForm
          templateId={id}
          defaultTitle={data.template.title}
          roles={[...v.recipients]
            .sort((a, b) => a.signingOrder - b.signingOrder)
            .map((r) => ({
              id: r.id,
              label: r.label,
              action: RECIPIENT_ROLES.find((x) => x.value === r.role)?.label ?? r.role,
            }))}
          contacts={contacts.map((c) => ({ name: c.name, email: c.email }))}
        />
      </Card>
    </div>
  );
}
