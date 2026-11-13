import Link from 'next/link';
import {
  DOCUMENT_TYPES,
  canConnect,
  getConfigValue,
  getConnection,
  getIntegration,
  hasPermission,
} from '@st/core';
import { availabilityOf } from '@/lib/integrations';
import { DriveImport } from './drive-import';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { PermissionDenied } from '@/components/ui/feedback';
import { Stepper } from '@/components/documents/stepper';
import { UploadForm } from './upload-form';

export const metadata = { title: 'New document' };

export default async function NewDocumentPage() {
  const { user, membership } = await requireWorkspace();
  if (!hasPermission(membership.permissions, 'documents.create'))
    return <PermissionDenied what="create documents" />;
  const maxMb = await getConfigValue(db(), 'limits.max_upload_mb', 25);
  const driveInfo = getIntegration('google_drive')!;
  const driveUsable = canConnect(await availabilityOf(driveInfo));
  const drive = driveUsable
    ? await getConnection(db(), { userId: user.id }, membership.workspace.id, 'google_drive')
    : null;
  return (
    <div>
      <PageHeader
        title="New document"
        description="Upload a PDF. You'll add signers and place fields next."
      />
      <Stepper current="document" />
      <UploadForm
        maxMb={maxMb}
        types={DOCUMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
      />
      {driveUsable ? (
        <section
          aria-labelledby="from-apps"
          className="mt-6 rounded-2xl border border-border bg-white p-5 shadow-card"
        >
          <h2 id="from-apps" className="mb-3 font-display text-lg">
            Or bring a file from a connected app
          </h2>
          {drive?.status === 'active' ? (
            <DriveImport />
          ) : drive?.status === 'expired' ? (
            <p className="text-sm">
              Your Google Drive connection has expired.{' '}
              <Link
                href="/app/integrations/google_drive"
                className="font-semibold text-primary underline"
              >
                Reconnect it
              </Link>{' '}
              to import files.
            </p>
          ) : (
            <p className="text-sm">
              <Link
                href="/app/integrations/google_drive"
                className="font-semibold text-primary underline"
              >
                Connect Google Drive
              </Link>{' '}
              to send files from your Drive for signature.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
