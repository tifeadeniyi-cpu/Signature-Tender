'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getMembership } from '@st/core';
import { db } from '@/lib/db';
import { requireUser, WORKSPACE_COOKIE } from '@/lib/session';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function switchWorkspace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('workspaceId') ?? '');
  // Throws if the user is not an active member, so a forged id cannot be stored.
  await getMembership(db(), { userId: user.id }, id);
  (await cookies()).set(WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  redirect('/app');
}

export async function signOut() {
  await auth().api.signOut({ headers: await headers() });
  (await cookies()).delete(WORKSPACE_COOKIE);
  redirect('/sign-in');
}
