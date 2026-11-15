import 'server-only';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import {
  getMembership,
  isPlatformAdmin,
  getAdminAccess,
  recordAdminDenied,
  hasStrongSignIn,
  type AdminAccess,
  type AdminPermission,
  listMyWorkspaces,
  touchMembership,
  AppError,
  type MembershipContext,
} from '@st/core';
import { auth } from './auth';
import { db } from './db';
import { safeNextPath } from './next-path';

export const WORKSPACE_COOKIE = 'st_ws';
export const WORKSPACE_HEADER = 'x-st-workspace';

export const getSession = cache(async () => auth().api.getSession({ headers: await headers() }));

/** Requires a signed-in, verified user. Redirects to sign-in otherwise. */
export async function requireUser() {
  const session = await getSession();
  if (!session) {
    // src/proxy.ts passes the requested path; only allow-listed pages come back after sign-in.
    const next = safeNextPath((await headers()).get('x-pathname'));
    redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
  }
  if (!session.user.emailVerified) redirect('/verify-email');
  return session.user;
}

export interface AppContext {
  user: Awaited<ReturnType<typeof requireUser>>;
  membership: MembershipContext;
  workspaces: Awaited<ReturnType<typeof listMyWorkspaces>>;
}

/**
 * Resolves the current workspace from the cookie, falling back to the user's first workspace.
 * Membership is always re-checked against the database; the cookie is only a preference.
 */
export const requireWorkspace = cache(async (): Promise<AppContext> => {
  const user = await requireUser();
  const actor = { userId: user.id };
  const workspaces = await listMyWorkspaces(db(), actor);
  if (workspaces.length === 0) redirect('/onboarding');
  // The mobile app sends its choice in a header; the website uses a cookie. Either way it is only
  // a preference: membership is checked below.
  const preferred =
    (await headers()).get(WORKSPACE_HEADER) ?? (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const chosen = workspaces.find((w) => w.id === preferred) ?? workspaces[0]!;
  try {
    const membership = await getMembership(db(), actor, chosen.id);
    // "Last active" for the team page; throttled in the database and never blocks the page.
    void touchMembership(db(), actor, chosen.id).catch(() => undefined);
    return { user, membership, workspaces };
  } catch (err) {
    if (err instanceof AppError) redirect('/onboarding');
    throw err;
  }
});

export async function requestMeta() {
  const h = await headers();
  return {
    ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
    userAgent: h.get('user-agent'),
    // Vercel's edge geolocates the IP; used for a signer's time zone when the device sends none.
    ipTimeZone: h.get('x-vercel-ip-timezone'),
  };
}

/** Staff sessions are shorter than customer ones: after this, staff sign in again. */
export const STAFF_SESSION_MAX_MS = 12 * 60 * 60 * 1000;

/**
 * Signature Tender staff only (spec Part 27). Everyone else gets a plain 404 so the internal
 * area does not reveal itself, and the refused attempt is recorded. Used by the admin layout and
 * each admin page, because Next renders them in parallel.
 */
export const requireStaff = cache(async () => {
  const user = await requireUser();
  const actor = { userId: user.id };
  if (!(await isPlatformAdmin(db(), actor))) {
    const path = (await headers()).get('x-pathname') ?? '/admin';
    await recordAdminDenied(db(), actor, path, null).catch(() => undefined);
    notFound();
  }
  // Staff accounts reach every workspace's metadata, so a password alone is not enough.
  if (!(await hasStrongSignIn(db(), user.id))) redirect('/app/settings/security?staff=1');
  const session = await getSession();
  const started = session?.session.createdAt ? new Date(session.session.createdAt).getTime() : 0;
  if (Date.now() - started > STAFF_SESSION_MAX_MS) redirect('/admin-reauth');
  return user;
});

/** The staff member's role and permissions, once per request. */
export const getStaffAccess = cache(async (): Promise<AdminAccess> => {
  const user = await requireStaff();
  return getAdminAccess(db(), { userId: user.id });
});

/**
 * Staff whose role includes `permission`. Others get a 404 and the attempt is recorded. Checked
 * again inside each database function, so hiding a link is never the only protection.
 */
export async function requireAdmin(permission: AdminPermission, view: string) {
  const user = await requireStaff();
  const access = await getStaffAccess();
  if (!access.permissions.includes(permission)) {
    await recordAdminDenied(db(), { userId: user.id }, view, permission).catch(() => undefined);
    notFound();
  }
  return { user, access };
}
