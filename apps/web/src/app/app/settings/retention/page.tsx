import { DOCUMENT_TYPES, getRetentionPolicies, hasPermission } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { RetentionRuleForm } from './retention-form';

export const metadata = { title: 'Retention' };

export default async function RetentionPage() {
  const { user, membership } = await requireWorkspace();
  const canManage = hasPermission(membership.permissions, 'workspace.manage');
  const { platformDays, minDays, policies } = await getRetentionPolicies(
    db(),
    { userId: user.id },
    membership.workspace.id,
  );
  const workspaceDefault = policies.find((p) => p.documentType === null);
  const byType = new Map(policies.filter((p) => p.documentType).map((p) => [p.documentType!, p]));
  const years = (d: number) =>
    d >= 365 ? ` (about ${Math.round((d / 365) * 10) / 10} years)` : '';

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Record retention"
          description="How long completed and closed documents keep their files. The clock starts when a request is completed, declined, expired or cancelled."
        />
        <Alert tone="info" className="mb-4">
          The platform default is {platformDays} days{years(platformDays)}. It is a starting point
          that still needs legal review; choose periods that match your own obligations. Records on
          legal hold are never deleted. Automatic deletion is currently switched off, so nothing is
          removed without an administrator acting.
        </Alert>
        {!canManage ? (
          <p className="mb-4 text-sm">Only workspace owners and admins can change retention.</p>
        ) : null}
        <RetentionRuleForm
          label="Workspace default"
          documentType=""
          days={workspaceDefault?.retainDays ?? null}
          placeholder={String(platformDays)}
          minDays={minDays}
          canManage={canManage}
        />
      </Card>
      <Card>
        <CardHeader
          title="By document type"
          description="Override the default for specific kinds of documents. Leave empty to use the workspace default."
        />
        <div className="flex flex-col divide-y divide-border">
          {DOCUMENT_TYPES.map((t) => (
            <RetentionRuleForm
              key={t.value}
              label={t.label}
              documentType={t.value}
              days={byType.get(t.value)?.retainDays ?? null}
              placeholder={String(workspaceDefault?.retainDays ?? platformDays)}
              minDays={minDays}
              canManage={canManage}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
