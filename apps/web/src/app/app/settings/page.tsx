import { requireWorkspace } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/feedback';
import { WorkspaceForm } from './workspace-form';

export const metadata = { title: 'Workspace Settings' };

export default async function WorkspaceSettingsPage() {
  const { membership } = await requireWorkspace();
  const ws = membership.workspace;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Organization Information"
          description="Configure your organization details."
          action={<Badge tone="neutral">Your role: {membership.roleName}</Badge>}
        />
        <WorkspaceForm
          canEdit={membership.permissions.includes('workspace.manage')}
          initial={{
            name: ws.name,
            legalName: ws.legalName ?? '',
            contactEmail: ws.contactEmail ?? '',
            website: ws.website ?? '',
          }}
        />
      </Card>
    </div>
  );
}
