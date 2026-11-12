'use server';
import { revalidatePath } from 'next/cache';
import {
  createApiKey,
  revokeApiKey,
  rotateApiKey,
  createWebhookEndpoint,
  setWebhookEnabled,
  rotateWebhookSecret,
  deleteWebhookEndpoint,
  sendTestWebhook,
  retryWebhookDelivery,
  connectIntegration,
  disconnectIntegration,
} from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace, requestMeta } from '@/lib/session';
import { toFormError, type ActionState } from '@/lib/action-result';
import { kickWebhooks, webhookContext } from '@/lib/webhooks';

/** Secrets come back once in the action result and are never stored in plain form. */
export type SecretState = (NonNullable<ActionState> & { secret?: string; secret2?: string }) | null;

const DEV = '/app/settings/developers';

async function ctx() {
  const { user, membership } = await requireWorkspace();
  return { actor: { userId: user.id }, ws: membership.workspace.id, meta: await requestMeta() };
}

export async function createKeyAction(_p: SecretState, fd: FormData): Promise<SecretState> {
  const { actor, ws, meta } = await ctx();
  try {
    const days = Number(fd.get('expiresInDays') ?? 0);
    const k = await createApiKey(
      db(),
      actor,
      ws,
      {
        name: String(fd.get('name') ?? ''),
        scopes: fd.getAll('scopes').map(String) as never,
        expiresInDays: days > 0 ? days : null,
      },
      meta,
    );
    revalidatePath(DEV);
    return {
      ok: true,
      message: 'Key created. Copy it now; it will not be shown again.',
      secret: k.key,
    };
  } catch (err) {
    return toFormError(err);
  }
}

export async function keyAction(_p: SecretState, fd: FormData): Promise<SecretState> {
  const { actor, meta } = await ctx();
  const id = String(fd.get('id') ?? '');
  try {
    if (fd.get('intent') === 'rotate') {
      const k = await rotateApiKey(db(), actor, id, meta);
      revalidatePath(DEV);
      return {
        ok: true,
        message: 'New key created. The old key keeps working for 24 hours. Copy the new key now.',
        secret: k.key,
      };
    }
    await revokeApiKey(db(), actor, id, meta);
    revalidatePath(DEV);
    return { ok: true, message: 'Key revoked. Requests using it now fail.' };
  } catch (err) {
    return toFormError(err);
  }
}

export async function createWebhookAction(_p: SecretState, fd: FormData): Promise<SecretState> {
  const { actor, ws, meta } = await ctx();
  try {
    const events = fd.getAll('events').map(String);
    const r = await createWebhookEndpoint(
      db(),
      actor,
      ws,
      {
        url: String(fd.get('url') ?? ''),
        description: String(fd.get('description') ?? ''),
        events: events as never,
      },
      webhookContext(),
      meta,
    );
    revalidatePath(DEV);
    return {
      ok: true,
      message: 'Endpoint added. Copy the signing secret now; it will not be shown again.',
      secret: r.secret,
    };
  } catch (err) {
    return toFormError(err);
  }
}

export async function webhookAction(_p: SecretState, fd: FormData): Promise<SecretState> {
  const { actor, meta } = await ctx();
  const id = String(fd.get('id') ?? '');
  try {
    switch (fd.get('intent')) {
      case 'pause':
        await setWebhookEnabled(db(), actor, id, false, meta);
        break;
      case 'resume':
        await setWebhookEnabled(db(), actor, id, true, meta);
        break;
      case 'test':
        await sendTestWebhook(db(), actor, id);
        kickWebhooks();
        revalidatePath(DEV);
        return {
          ok: true,
          message: 'Test event queued. Check the delivery log below in a moment.',
        };
      case 'rotate': {
        const r = await rotateWebhookSecret(db(), actor, id, webhookContext(), meta);
        revalidatePath(DEV);
        return {
          ok: true,
          message: 'New secret created. Both secrets sign deliveries for 24 hours. Copy it now.',
          secret: r.secret,
        };
      }
      case 'delete':
        await deleteWebhookEndpoint(db(), actor, id, meta);
        break;
      default:
        return { ok: false, message: 'Unknown action.' };
    }
    revalidatePath(DEV);
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return toFormError(err);
  }
}

export async function retryDeliveryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor } = await ctx();
  try {
    await retryWebhookDelivery(db(), actor, String(fd.get('id') ?? ''));
    kickWebhooks();
    revalidatePath(DEV);
    return { ok: true, message: 'Queued for another attempt.' };
  } catch (err) {
    return toFormError(err);
  }
}

export async function connectAction(_p: SecretState, fd: FormData): Promise<SecretState> {
  const { actor, ws, meta } = await ctx();
  try {
    const r = await connectIntegration(
      db(),
      actor,
      ws,
      {
        provider: String(fd.get('provider') ?? ''),
        webhookUrl: String(fd.get('webhookUrl') ?? ''),
      },
      webhookContext(),
      meta,
    );
    revalidatePath('/app/integrations');
    revalidatePath(DEV);
    return {
      ok: true,
      message: 'Connected. Paste these into the partner app now; they will not be shown again.',
      secret: r.apiKey,
      secret2: r.webhookSecret ?? undefined,
    };
  } catch (err) {
    return toFormError(err);
  }
}

export async function disconnectAction(_p: SecretState, fd: FormData): Promise<SecretState> {
  const { actor, ws, meta } = await ctx();
  try {
    await disconnectIntegration(db(), actor, ws, String(fd.get('provider') ?? ''), meta);
    revalidatePath('/app/integrations');
    revalidatePath(DEV);
    return { ok: true, message: 'Disconnected. Its API key no longer works.' };
  } catch (err) {
    return toFormError(err);
  }
}
