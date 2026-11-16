import Link from 'next/link';
import { DOCUMENT_TYPES, findDriveConnection, getConfigValue, hasPermission } from '@st/core';
import { pickerConfig } from '@/lib/integrations';
import { DriveImport } from './drive-import';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { PermissionDenied } from '@/components/ui/feedback';
import { Stepper } from '@/components/documents/stepper';
import { UploadForm } from './upload-form';
import { selfSignPriceLabel } from '@/lib/self-sign';

export const metadata = { title: 'New document' };

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ self?: string }>;
}) {
  const selfSign = (await searchParams).self === '1';
  const { user, membership } = await requireWorkspace();
  if (!hasPermission(membership.permissions, 'documents.create'))
    return <PermissionDenied what="create documents" />;
  const maxMb = await getConfigValue(db(), 'limits.max_upload_mb', 25);
  const drive =
    !selfSign && pickerConfig()
      ? await findDriveConnection(db(), { userId: user.id }, membership.workspace.id).catch(
          () => null,
        )
      : null;
  return (
    <div>
      <PageHeader
        title={selfSign ? 'Sign a document yourself' : 'New document'}
        description={
          selfSign
            ? `Upload a PDF, place your signature and sign it now. ${await selfSignPriceLabel()} per document, with a Certificate of Completion. Nobody else is involved.`
            : "Upload a PDF. You'll add signers and place fields next."
        }
      />
      <Stepper current="document" />
      <UploadForm
        maxMb={maxMb}
        types={DOCUMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        selfSign={selfSign}
      />
      {drive ? (
        <section
          aria-labelledby="from-apps"
          className="mt-6 rounded-2xl border border-border bg-white p-5 shadow-card"
        >
          <h2 id="from-apps" className="mb-3 font-display text-lg">
            Or bring a file from Google Drive
          </h2>
          {drive.status === 'active' ? (
            <DriveImport />
          ) : (
            <p className="text-sm">
              Your Google Drive connection needs attention.{' '}
              <Link
                href="/app/integrations/connected"
                className="font-semibold text-primary underline"
              >
                Reconnect it
              </Link>{' '}
              to import files.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
