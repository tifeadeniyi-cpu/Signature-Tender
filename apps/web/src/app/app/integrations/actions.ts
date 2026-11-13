'use server';
import { revalidatePath } from 'next/cache';
import {
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
import { integrationContext, kickIntegrationJobs } from '@/lib/integrations';

const BASE = '/app/integrations';

async function ctx() {
  const { user } = await requireWorkspace();
  return { actor: { userId: user.id }, meta: await requestMeta() };
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
