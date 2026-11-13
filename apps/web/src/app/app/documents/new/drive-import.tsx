'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/feedback';
import { DrivePickerButton } from '@/components/integrations/drive-picker';
import { drivePickerConfigAction, importDriveFileAction } from '../../integrations/actions';

export function DriveImport() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <DrivePickerButton
        mode="file"
        label="Import from Google Drive"
        getConfig={() => drivePickerConfigAction('import')}
        onPicked={async (doc) => {
          setError('');
          setStatus(`Importing ${doc.name}…`);
          const r = await importDriveFileAction(doc.id);
          if (!r.ok) {
            setStatus('');
            setError(r.error);
            return;
          }
          router.push(`/app/documents/${r.documentId}/prepare/signers`);
        }}
      />
      <p className="text-xs">
        PDFs and Google Docs, Sheets and Slides. Google files are converted to PDF so the signed
        version never changes.
      </p>
      {status ? (
        <p className="text-sm text-heading" role="status">
          {status}
        </p>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </div>
  );
}
