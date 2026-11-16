'use server';
import { revalidatePath } from 'next/cache';
import {
  AppError,
  drivePickerToken,
  getConfigValue,
  importFromGoogleDrive,
  listIntegrationConnections,
  setDriveAutoSave,
  cancelIntegrationJob,
  deleteAutomation,
  disconnectIntegrationConnection,
  duplicateAutomation,
  retryIntegrationJob,
  setAutomationEnabled,
  testIntegrationConnection,
  updateConnectionSettings,
} from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace, requestMeta } from '@/lib/session';
import { toFormError, type ActionState } from '@/lib/action-result';
import { integrationContext, kickIntegrationJobs, pickerConfig } from '@/lib/integrations';
import { storage } from '@/lib/storage';
import type { PickerConfigResult } from '@/components/integrations/drive-picker';

const BASE = '/app/integrations';

async function ctx() {
  const { user, membership } = await requireWorkspace();
  return { actor: { userId: user.id }, ws: membership.workspace.id, meta: await requestMeta() };
}

function refresh() {
  revalidatePath(BASE, 'layout');
}

export async function testConnectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor } = await ctx();
  try {
    const r = await testIntegrationConnection(
      db(),
      actor,
      String(fd.get('id') ?? ''),
      await integrationContext(),
    );
    refresh();
    return r;
  } catch (err) {
    return toFormError(err);
  }
}

export async function disconnectConnectionAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const { actor, meta } = await ctx();
  try {
    const r = await disconnectIntegrationConnection(
      db(),
      actor,
      String(fd.get('id') ?? ''),
      await integrationContext(),
      meta,
    );
    refresh();
    return {
      ok: true,
      message: r.revokedAtProvider
        ? 'Disconnected. Access was also revoked at the provider.'
        : 'Disconnected. Signature Tender no longer holds any access to this account.',
    };
  } catch (err) {
    return toFormError(err);
  }
}

export async function saveConnectionSettingsAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const { actor, meta } = await ctx();
  const id = String(fd.get('id') ?? '');
  const settings: Record<string, string | boolean> = {};
  for (const [k, v] of fd.entries()) {
    if (k === 'id' || k.startsWith('$')) continue;
    settings[k] = v === 'on' ? true : String(v);
  }
  for (const k of String(fd.get('$booleans') ?? '')
    .split(',')
    .filter(Boolean))
    settings[k] ??= false;
  try {
    await updateConnectionSettings(db(), actor, id, settings, meta);
    // Google Drive saves through an automation, so the switch turns that automation on or off.
    const { ws } = await ctx();
    const conn = (await listIntegrationConnections(db(), actor, ws)).find((c) => c.id === id);
    if (conn?.provider === 'google_drive')
      await setDriveAutoSave(db(), actor, ws, id, settings.autoSave === true, meta);
    refresh();
    return { ok: true, message: 'Settings saved.' };
  } catch (err) {
    return toFormError(err);
  }
}

export async function automationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, meta } = await ctx();
  const id = String(fd.get('id') ?? '');
  const op = String(fd.get('op') ?? '');
  try {
    if (op === 'enable') await setAutomationEnabled(db(), actor, id, true, meta);
    else if (op === 'disable') await setAutomationEnabled(db(), actor, id, false, meta);
    else if (op === 'duplicate') await duplicateAutomation(db(), actor, id, meta);
    else if (op === 'delete') await deleteAutomation(db(), actor, id, meta);
    else return { ok: false, message: 'Unknown action.' };
    refresh();
    return { ok: true, message: 'Done.' };
  } catch (err) {
    return toFormError(err);
  }
}

export async function jobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor } = await ctx();
  const id = String(fd.get('id') ?? '');
  try {
    if (fd.get('op') === 'cancel') await cancelIntegrationJob(db(), actor, id);
    else {
      await retryIntegrationJob(db(), actor, id);
      kickIntegrationJobs();
    }
    refresh();
    return { ok: true, message: fd.get('op') === 'cancel' ? 'Cancelled.' : 'Queued again.' };
  } catch (err) {
    return toFormError(err);
  }
}

/**
 * The Google Picker runs in the browser and needs a short-lived access token (about an hour).
 * Only members who may use connected apps get one; the refresh token never leaves the server.
 */
export async function drivePickerConfigAction(): Promise<PickerConfigResult> {
  const { actor, ws } = await ctx();
  const picker = pickerConfig();
  if (!picker) return { ok: false, error: 'The Google Drive picker is not set up yet.' };
  try {
    const t = await drivePickerToken(db(), actor, ws, await integrationContext());
    return { ok: true, config: { accessToken: t.token, ...picker } };
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
      await integrationContext(),
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

/** Saves the Drive folder picked for signed copies (null = the default Signature Tender folder). */
export async function setDriveFolderAction(
  connectionId: string,
  folder: { id: string; name: string } | null,
): Promise<{ ok: boolean; error?: string }> {
  const { actor, meta } = await ctx();
  try {
    await updateConnectionSettings(
      db(),
      actor,
      connectionId,
      { folderId: folder?.id ?? null, folderName: folder?.name.slice(0, 200) ?? null },
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
