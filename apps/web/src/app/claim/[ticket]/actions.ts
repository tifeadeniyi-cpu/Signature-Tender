'use server';
import { redirect } from 'next/navigation';
import { claimDocument, readClaimTicket } from '@st/core';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { claimSecret } from '@/lib/completed';

/** Adds the completed document to the signed-in account after the database re-checks the address. */
export async function claimAction(ticket: string) {
  const user = await requireUser();
  const t = readClaimTicket(ticket, claimSecret());
  if (!t) redirect(`/claim/${ticket}`);
  const outcome = await claimDocument(db(), user.id, t);
  if (outcome === 'ok' || outcome === 'exists')
    redirect(`/my-documents?welcome=${t.requestId}${outcome === 'ok' ? '&new=1' : ''}`);
  redirect(`/claim/${ticket}?error=${outcome}`);
}
