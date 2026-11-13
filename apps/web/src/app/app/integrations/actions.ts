'use server';
import { revalidatePath } from 'next/cache';
import {
  AppError,
  disconnectOAuthIntegration,
  getAccessToken,
  getConfigValue,
  getConnection,
  hasPermission,
  importFromGoogleDrive,
  readDriveSettings,
  retryIntegrationJob,
  updateIntegrationSettings,
} from '@st/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { storage } from '@/lib/storage';
import { requireWorkspace, requestMeta } from '@/lib/session';
import { toFormError, type ActionState } from '@/lib/action-result';
import { integrationRuntime, isConfigured, kickIntegrations } from '@/lib/integrations';
import type { PickerConfigResult } from '@/components/integrations/drive-picker';

async function ctx() {
  const { user, membership } = await requireWorkspace();
  return {
    actor: { userId: user.id },
    ws: membership.workspace.id,
    permissions: membership.permissions,
    meta: await requestMeta(),
  };
}

const refresh = () => revalidatePath('/app/integrations', 'layout');

/**
 * The Google Picker runs in the browser and needs a short-lived access token (about an hour) for
 * the connected account. Only members who may create documents (to import) or manage integrations
 * (to choose a folder) get one. The refresh token never leaves the server.
 */
export async function drivePickerConfigAction(
  purpose: 'import' | 'folder',
): Promise<PickerConfigResult> {
  const { actor, ws, permissions } = await ctx();
  const need = purpose === 'import' ? 'documents.create' : 'integrations.manage';
  if (!hasPermission(permissions, need))
    return { ok: false, error: 'Your role does not allow this.' };
  const e = env();
  if (!isConfigured('google_drive') || !e.GOOGLE_PICKER_API_KEY || !e.GOOGLE_CLOUD_PROJECT_NUMBER)
    return { ok: false, error: 'Google Drive is not available right now.' };
  try {
    const t = await getAccessToken(db(), actor, ws, 'google_drive', integrationRuntime());
    return {
      ok: true,
      config: {
        accessToken: t.accessToken,
        apiKey: e.GOOGLE_PICKER_API_KEY,
        appId: e.GOOGLE_CLOUD_PROJECT_NUMBER,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof AppError ? err.message : 'Google Drive could not be reached. Try again.',
    };
  }
}

export async function importDriveFileAction(
  fileId: string,
): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  const { actor, ws, meta } = await ctx();
  try {
    const maxMb = await getConfigValue(db(), 'limits.max_upload_mb', 25);
    const maxPages = await getConfigValue(db(), 'limits.max_pages', 200);
    const r = await importFromGoogleDrive(
      db(),
      storage(),
      actor,
      ws,
      fileId,
      integrationRuntime(),
      { maxBytes: maxMb * 1024 * 1024, maxPages },
      meta,
    );
    refresh();
    return { ok: true, documentId: r.documentId };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    console.error('[integrations] Drive import failed', err);
    return { ok: false, error: 'The file could not be imported. Try again.' };
  }
}

export async function saveDriveSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, ws, meta } = await ctx();
  try {
    const cur = readDriveSettings((await getConnection(db(), actor, ws, 'google_drive'))?.settings);
    await updateIntegrationSettings(
      db(),
      actor,
      ws,
      'google_drive',
      {
        ...cur,
        autoSave: fd.get('autoSave') === 'on',
        saveCertificate: fd.get('saveCertificate') === 'on',
        naming: fd.get('naming') === 'title_date' ? 'title_date' : 'title',
      },
      meta,
    );
    refresh();
    return { ok: true, message: 'Settings saved.' };
  } catch (err) {
    return toFormError(err);
  }
}

export async function setDriveFolderAction(
  folder: { id: string; name: string } | null,
): Promise<{ ok: boolean; error?: string }> {
  const { actor, ws, meta } = await ctx();
  try {
    const cur = readDriveSettings((await getConnection(db(), actor, ws, 'google_drive'))?.settings);
    await updateIntegrationSettings(
      db(),
      actor,
      ws,
      'google_drive',
      { ...cur, folderId: folder?.id ?? null, folderName: folder?.name.slice(0, 200) ?? null },
      meta,
    );
    refresh();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof AppError ? err.message : 'Could not save the folder.',
    };
  }
}

export async function disconnectOAuthAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, ws, meta } = await ctx();
  try {
    await disconnectOAuthIntegration(
      db(),
      actor,
      ws,
      String(fd.get('provider') ?? ''),
      integrationRuntime(),
      meta,
    );
    refresh();
    return {
      ok: true,
      message: 'Disconnected. Signature Tender no longer has access to your Google Drive.',
    };
  } catch (err) {
    return toFormError(err);
  }
}

export async function retryJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor } = await ctx();
  try {
    await retryIntegrationJob(db(), actor, String(fd.get('jobId') ?? ''));
    kickIntegrations();
    refresh();
    return { ok: true, message: 'Queued to retry.' };
  } catch (err) {
    return toFormError(err);
  }
}
