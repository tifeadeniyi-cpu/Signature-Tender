import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { REFERRAL_COOKIE, normalizeReferralCode, type ReferralNotice } from '@st/core';
import { env } from './env';
import { sendEmail } from './email';
import { emailConfig } from './email/config';
import {
  renderReferralAdjusted,
  renderReferralJoined,
  renderReferralReward,
  renderWelcomeCredit,
} from './email/templates/transactional';

/**
 * The referral code travels from /r/CODE to sign-up in a short-lived, signed, httpOnly cookie.
 * It holds only the code (public anyway), how it arrived and when it expires: never anything
 * about the person who shared it. The database record made at sign-up is the real attribution.
 */

export interface ReferralCookie {
  code: string;
  source: 'link' | 'code';
  exp: number;
}

function sign(payload: string) {
  return createHmac('sha256', env().BETTER_AUTH_SECRET)
    .update(`st:referral:v1|${payload}`)
    .digest('base64url');
}

export function encodeReferralCookie(c: ReferralCookie): string {
  const payload = `${c.code}.${c.source}.${c.exp}`;
  return `${payload}.${sign(payload)}`;
}

export function decodeReferralCookie(raw: string | null | undefined): ReferralCookie | null {
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [code, source, exp, mac] = parts as [string, string, string, string];
  const payload = `${code}.${source}.${exp}`;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const n = Number(exp);
  if (!Number.isFinite(n) || n < Date.now()) return null;
  if (source !== 'link' && source !== 'code') return null;
  const c = normalizeReferralCode(code);
  return c ? { code: c, source, exp: n } : null;
}

/** Reads the referral cookie from a Cookie header (better-auth hooks get headers, not cookies()). */
export function referralFromCookieHeader(header: string | null | undefined): ReferralCookie | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === REFERRAL_COOKIE) return decodeReferralCookie(decodeURIComponent(v.join('=')));
  }
  return null;
}

export async function readReferralCookie(): Promise<ReferralCookie | null> {
  return decodeReferralCookie((await cookies()).get(REFERRAL_COOKIE)?.value);
}

export async function setReferralCookie(code: string, source: 'link' | 'code', days: number) {
  const exp = Date.now() + Math.max(1, days) * 86400_000;
  (await cookies()).set(REFERRAL_COOKIE, encodeReferralCookie({ code, source, exp }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.max(1, days) * 86400,
  });
}

export async function clearReferralCookie() {
  (await cookies()).delete(REFERRAL_COOKIE);
}

/** The public link for a code, on whatever domain this deployment runs on. */
export function referralUrl(code: string): string {
  return new URL(`/r/${code}`, env().BETTER_AUTH_URL).toString();
}

/**
 * Emails for referral changes, sent after the change has committed. Best effort: a failed email
 * never undoes or blocks a reward (the Refer & Earn page always shows the real state).
 */
export async function sendReferralNotices(notices: ReferralNotice[]): Promise<void> {
  if (!notices.length) return;
  const config = await emailConfig();
  const app = (path: string) => new URL(path, env().BETTER_AUTH_URL).toString();
  for (const n of notices) {
    try {
      const r =
        n.kind === 'referral_joined'
          ? renderReferralJoined({
              config,
              name: n.name,
              credits: n.referrerCredits,
              url: app('/app/referrals'),
            })
          : n.kind === 'welcome_credit'
            ? renderWelcomeCredit({
                config,
                name: n.name,
                credits: n.credits,
                url: app('/app/documents/new'),
              })
            : n.kind === 'reward_earned'
              ? renderReferralReward({
                  config,
                  name: n.name,
                  credits: n.credits,
                  url: app('/app/referrals'),
                })
              : renderReferralAdjusted({
                  config,
                  name: n.name,
                  url: app('/app/referrals#activity'),
                });
      await sendEmail({
        to: n.to,
        subject: r.subject,
        text: r.text,
        html: r.html,
        attachments: r.attachments,
        tags: [{ name: 'template', value: `referral_${n.kind}` }],
      });
    } catch (err) {
      console.error('Referral email failed', n.kind, err);
    }
  }
}
