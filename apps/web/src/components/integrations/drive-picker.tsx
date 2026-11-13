'use client';
import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

/* Minimal typings for the parts of the Google Picker API used here. */
type PickerDoc = { id: string; name: string; mimeType: string };
type PickerData = { action: string; docs?: PickerDoc[] };
interface GooglePickerNs {
  picker: {
    Action: { PICKED: string; CANCEL: string };
    ViewId: { DOCS: string; FOLDERS: string };
    DocsView: new (viewId?: string) => {
      setMimeTypes(m: string): unknown;
      setIncludeFolders(b: boolean): unknown;
      setSelectFolderEnabled(b: boolean): unknown;
      setMode?(m: unknown): unknown;
    };
    PickerBuilder: new () => PickerBuilder;
  };
}
interface PickerBuilder {
  addView(v: unknown): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setTitle(t: string): PickerBuilder;
  setOrigin(o: string): PickerBuilder;
  setCallback(cb: (d: PickerData) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
declare global {
  interface Window {
    gapi?: { load(lib: string, cb: { callback: () => void; onerror: () => void }): void };
    google?: GooglePickerNs;
  }
}

let loader: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  loader ??= new Promise<void>((resolve, reject) => {
    const done = () =>
      window.gapi!.load('picker', {
        callback: () => resolve(),
        onerror: () => reject(new Error('picker')),
      });
    if (window.gapi) return done();
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.async = true;
    s.onload = done;
    s.onerror = () => {
      loader = null;
      reject(new Error('load'));
    };
    document.head.appendChild(s);
  });
  return loader;
}

export type PickerConfig = { accessToken: string; apiKey: string; appId: string };
export type PickerConfigResult = { ok: true; config: PickerConfig } | { ok: false; error: string };

export const IMPORT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
].join(',');

/**
 * Opens the Google Drive file picker. Under the drive.file scope this is how a member grants
 * Signature Tender access to one file or folder; the app cannot see anything else in their Drive.
 */
export function DrivePickerButton({
  mode,
  label,
  getConfig,
  onPicked,
  variant = 'secondary',
  disabled,
}: {
  mode: 'file' | 'folder';
  label: string;
  getConfig: () => Promise<PickerConfigResult>;
  onPicked: (doc: PickerDoc) => Promise<void> | void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          variant={variant}
          loading={busy}
          disabled={disabled}
          onClick={async () => {
            setError('');
            setBusy(true);
            try {
              const res = await getConfig();
              if (!res.ok) {
                setError(res.error);
                setBusy(false);
                return;
              }
              await loadPicker();
              const g = window.google!.picker;
              const view = new g.DocsView(mode === 'folder' ? g.ViewId.FOLDERS : g.ViewId.DOCS);
              if (mode === 'folder') {
                view.setIncludeFolders(true);
                view.setSelectFolderEnabled(true);
                view.setMimeTypes('application/vnd.google-apps.folder');
              } else {
                view.setMimeTypes(IMPORT_MIME_TYPES);
              }
              new g.PickerBuilder()
                .addView(view)
                .setOAuthToken(res.config.accessToken)
                .setDeveloperKey(res.config.apiKey)
                .setAppId(res.config.appId)
                .setOrigin(window.location.origin)
                .setTitle(
                  mode === 'folder'
                    ? 'Choose a folder for signed copies'
                    : 'Choose a file to send for signature',
                )
                .setCallback(async (data) => {
                  if (data.action === g.Action.CANCEL) return setBusy(false);
                  if (data.action !== g.Action.PICKED || !data.docs?.[0]) return;
                  try {
                    await onPicked(data.docs[0]);
                  } finally {
                    setBusy(false);
                  }
                })
                .build()
                .setVisible(true);
            } catch {
              setError(
                'Google Drive could not be opened. Check that pop-ups and third-party scripts are allowed, then try again.',
              );
              setBusy(false);
            }
          }}
        >
          <FolderOpen className="size-4" aria-hidden /> {label}
        </Button>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </div>
  );
}
