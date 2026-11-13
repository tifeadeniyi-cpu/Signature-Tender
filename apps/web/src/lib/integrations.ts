import 'server-only';
import { after } from 'next/server';
import {
  INTEGRATIONS,
  getConfigValue,
  isFeatureEnabled,
  resolveAvailability,
  runIntegrationJobs,
  type IntegrationAvailability,
  type IntegrationInfo,
  type IntegrationRuntime,
} from '@st/core';
import { db } from './db';
import { env } from './env';
import { storage } from './storage';
import { webhookContext } from './webhooks';

export const OAUTH_COOKIE = 'st_oauth';

/** The Google OAuth client is shared with Sign in with Google; Drive adds its own redirect URI. */
export function googleDriveClient() {
  const e = env();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) return undefined;
  return {
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    redirectUri: `${e.BETTER_AUTH_URL}/api/integrations/google_drive/callback`,
  };
}

/** Whether this deployment has what a provider needs. */
export function isConfigured(key: string) {
  const e = env();
  if (key === 'google_drive')
    return Boolean(googleDriveClient() && e.GOOGLE_PICKER_API_KEY && e.GOOGLE_CLOUD_PROJECT_NUMBER);
  return true;
}

export function integrationRuntime(): IntegrationRuntime {
  return { encKey: webhookContext().encKey, google: googleDriveClient() };
}

/** Availability of every catalogue entry right now (configuration + staff switches). */
export async function catalogueAvailability(): Promise<Record<string, IntegrationAvailability>> {
  const out: Record<string, IntegrationAvailability> = {};
  for (const i of INTEGRATIONS) out[i.key] = await availabilityOf(i);
  return out;
}

export async function availabilityOf(i: IntegrationInfo): Promise<IntegrationAvailability> {
  return resolveAvailability(i, {
    configured: isConfigured(i.key),
    flagEnabled: i.featureFlag ? await isFeatureEnabled(db(), i.featureFlag, env().APP_ENV) : true,
  });
}

/** Runs due integration jobs. Called from the cron route and after events that may queue work. */
export async function runIntegrationWorker() {
  if (!googleDriveClient()) return null;
  const maxAttempts = await getConfigValue(db(), 'integrations.max_attempts', 6);
  return runIntegrationJobs(db(), storage(), integrationRuntime(), { maxAttempts });
}

export function kickIntegrations() {
  after(() =>
    runIntegrationWorker().then(
      () => undefined,
      () => undefined,
    ),
  );
}
