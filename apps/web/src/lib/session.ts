import 'server-only';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import {
  getMembership,
  isPlatformAdmin,
  hasStrongSignIn,
  listMyWorkspaces,
  touchMembership,
  AppError,
  type MembershipContext,
} from '@st/core';
import { auth } from './auth';
import { db } from './db';

export const WORKSPACE_COOKIE = 'st_ws';

export const getSession = cache(async () => auth().api.getSession({ headers: await headers() }));

/** Requires a signed-in, verified user. Redirects to sign-in otherwise. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect('/sign-in');
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
  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
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
  };
}

/**
 * Signature Tender staff only (spec Part 27). Everyone else gets a plain 404 so the internal
 * area does not reveal itself. Used by the admin layout and each admin page, because Next renders
 * them in parallel.
 */
export const requireStaff = cache(async () => {
  const user = await requireUser();
  if (!(await isPlatformAdmin(db(), { userId: user.id }))) notFound();
  // Staff accounts reach every workspace's metadata, so a password alone is not enough.
  if (!(await hasStrongSignIn(db(), user.id))) redirect('/app/settings/security?staff=1');
  return user;
});
