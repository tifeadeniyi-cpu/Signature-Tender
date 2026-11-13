'use client';
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Folder } from 'lucide-react';
import type { DriveSettings } from '@st/core/integration-store';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { DrivePickerButton } from '@/components/integrations/drive-picker';
import {
  disconnectOAuthAction,
  drivePickerConfigAction,
  saveDriveSettingsAction,
  setDriveFolderAction,
} from '../actions';

export function DriveSettingsForm({
  settings,
  canManage,
}: {
  settings: DriveSettings;
  canManage: boolean;
}) {
  const [state, act, pending] = useActionState(saveDriveSettingsAction, null);
  const [folderError, setFolderError] = useState('');
  const router = useRouter();
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="drive-dest">
        <h4 id="drive-dest" className="mb-1 font-semibold text-heading">
          Save location
        </h4>
        <p className="mb-2 flex items-center gap-2 text-sm">
          <Folder className="size-4 text-gold" aria-hidden />
          {settings.folderName ?? 'A "Signature Tender" folder in My Drive (created on first save)'}
        </p>
        {canManage ? (
          <div className="flex flex-wrap items-start gap-2">
            <DrivePickerButton
              mode="folder"
              label={settings.folderId ? 'Change folder' : 'Choose folder'}
              getConfig={() => drivePickerConfigAction('folder')}
              onPicked={async (doc) => {
                const r = await setDriveFolderAction({ id: doc.id, name: doc.name });
                if (!r.ok) setFolderError(r.error ?? 'Could not save the folder.');
                router.refresh();
              }}
            />
            {settings.folderId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await setDriveFolderAction(null);
                  router.refresh();
                }}
              >
                Use the default folder
              </Button>
            ) : null}
          </div>
        ) : null}
        {folderError ? (
          <Alert tone="error" className="mt-2">
            {folderError}
          </Alert>
        ) : null}
      </section>

      <form action={act} className="flex flex-col gap-3" aria-labelledby="drive-sync">
        <h4 id="drive-sync" className="font-semibold text-heading">
          Completion sync
        </h4>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="autoSave"
            defaultChecked={settings.autoSave}
            disabled={!canManage}
            className="mt-0.5 size-4 accent-navy"
          />
          <span>
            <span className="font-semibold text-heading">
              Automatically save signed documents to Google Drive
            </span>
            <span className="block text-xs">
              Applies to documents finished after you turn this on. Copies are visible to anyone
              with access to the folder.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="saveCertificate"
            defaultChecked={settings.saveCertificate}
            disabled={!canManage}
            className="mt-0.5 size-4 accent-navy"
          />
          <span className="font-semibold text-heading">
            Also save the Certificate of Completion
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-heading">File names</span>
          <select
            name="naming"
            defaultValue={settings.naming}
            disabled={!canManage}
            className="h-10 max-w-sm rounded-lg border border-border bg-white px-3"
          >
            <option value="title">Document title - Signed.pdf</option>
            <option value="title_date">Document title + completion date</option>
          </select>
        </label>
        {canManage ? (
          <div>
            <Button type="submit" size="sm" loading={pending}>
              Save settings
            </Button>
          </div>
        ) : (
          <p className="text-xs">Only owners and admins can change these settings.</p>
        )}
        {state ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
      </form>
    </div>
  );
}

export function OAuthDisconnectForm({ provider, name }: { provider: string; name: string }) {
  const [state, act, pending] = useActionState(disconnectOAuthAction, null);
  const [confirming, setConfirming] = useState(false);
  return (
    <form action={act} className="flex flex-col gap-2">
      <input type="hidden" name="provider" value={provider} />
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-xl border border-error/30 bg-error-bg p-3 text-sm">
          <p className="text-heading">
            Disconnect {name}? Automatic saving stops and queued saves are cancelled. Documents
            already in Signature Tender are not affected.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" loading={pending}>
              Yes, disconnect {name}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep connected
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" variant="danger" size="sm" onClick={() => setConfirming(true)}>
            Disconnect {name}
          </Button>
        </div>
      )}
      <p className="text-xs">
        Revokes Signature Tender&apos;s access at Google and deletes the stored tokens.
      </p>
      {state && !state.ok ? <Alert tone="error">{state.message}</Alert> : null}
    </form>
  );
}
