import 'server-only';
import { getConfigValue } from '@st/core';
import { db } from '../db';
import { env } from '../env';
import type { EmailLinksConfig } from './design';

export type EmailConfig = EmailLinksConfig & { appUrl: string; timeZone: string };

/**
 * Settings shared by every transactional email. Support email comes from SUPPORT_EMAIL, otherwise
 * the platform's support.email config value. Legal links default to the app's own legal pages.
 */
export async function emailConfig(): Promise<EmailConfig> {
  const e = env();
  const appUrl = e.BETTER_AUTH_URL.replace(/\/$/, '');
  const supportEmail =
    e.SUPPORT_EMAIL || (await getConfigValue<string | null>(db(), 'support.email', null));
  return {
    appUrl,
    companyName: e.COMPANY_NAME,
    supportEmail: supportEmail || null,
    supportUrl: e.SUPPORT_URL || null,
    privacyUrl: e.PRIVACY_URL || `${appUrl}/legal/privacy`,
    termsUrl: e.TERMS_URL || `${appUrl}/legal/terms`,
    socials: [
      { label: 'YouTube', url: e.SOCIAL_YOUTUBE_URL ?? '' },
      { label: 'Instagram', url: e.SOCIAL_INSTAGRAM_URL ?? '' },
      { label: 'LinkedIn', url: e.SOCIAL_LINKEDIN_URL ?? '' },
    ].filter((s) => s.url),
    timeZone: e.EMAIL_TIMEZONE,
    allowHttpLocal: e.APP_ENV === 'development' || e.APP_ENV === 'test',
  };
}

export function emailLinkSecret(): string {
  return env().EMAIL_LINK_SECRET ?? env().BETTER_AUTH_SECRET;
}
