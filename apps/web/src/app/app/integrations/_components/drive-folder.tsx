'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { DrivePickerButton } from '@/components/integrations/drive-picker';
import { drivePickerConfigAction, setDriveFolderAction } from '../actions';

/** Where signed copies go in Google Drive. Picking a folder is what grants access to it. */
export function DriveFolderChooser({
  connectionId,
  folderName,
  canEdit,
}: {
  connectionId: string;
  folderName: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  return (
    <section aria-label="Save location" className="mt-4 border-t border-border pt-4">
      <h4 className="mb-1 text-sm font-semibold text-heading">Save location</h4>
      <p className="mb-2 flex items-center gap-2 text-sm">
        <Folder className="size-4 text-gold" aria-hidden />
        {folderName ?? 'A “Signature Tender” folder in My Drive, created on the first save'}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap items-start gap-2">
          <DrivePickerButton
            mode="folder"
            label={folderName ? 'Change folder' : 'Choose a folder'}
            getConfig={() => drivePickerConfigAction()}
            onPicked={async (doc) => {
              const r = await setDriveFolderAction(connectionId, { id: doc.id, name: doc.name });
              setError(r.ok ? '' : (r.error ?? 'Could not save the folder.'));
              router.refresh();
            }}
          />
          {folderName ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => {
                await setDriveFolderAction(connectionId, null);
                router.refresh();
              }}
            >
              Use the default folder
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      ) : null}
    </section>
  );
}
