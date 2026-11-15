import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileCheck2, CircleAlert } from 'lucide-react';
import { previewClaim, readClaimTicket } from '@st/core';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { claimSecret, displayTimeZone } from '@/lib/completed';
import { buttonClass } from '@/components/ui/button';
import { TrackOnMount } from '@/components/completed/client-bits';
import { claimAction } from './actions';

export const dynamic = 'force-dynamic';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-10">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-6 shadow-card sm:p-8">
        {children}
      </div>
    </div>
  );
}

/**
 * Step 3 of post-signing registration: after sign-up, email verification and sign-in, offer to add
 * the completed document. The database only allows it when this account's verified email is the
 * recipient's address, and the claim changes nothing about the document or its evidence.
 */
export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticket: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { ticket } = await params;
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/claim/${ticket}`)}`);
  if (!session.user.emailVerified)
    redirect(`/verify-email?next=${encodeURIComponent(`/claim/${ticket}`)}`);

  const t = readClaimTicket(ticket, claimSecret());
  if (!t)
    return (
      <Shell>
        <h1 className="font-display text-2xl">This link has expired</h1>
        <p className="text-sm">
          Open your completed document again from your email and choose Create Free Account or Save
          to My Documents to get a new link.
        </p>
        <Link href="/my-documents" className={buttonClass('primary')}>
          Go to My Documents
        </Link>
      </Shell>
    );

  const p = await previewClaim(db(), session.user.id, t);
  if (p.outcome === 'ok' && p.alreadyClaimed) redirect(`/my-documents?welcome=${t.requestId}`);
  const failed = (await searchParams).error;

  if (p.outcome !== 'ok')
    return (
      <Shell>
        <CircleAlert className="size-8 text-warning" aria-hidden />
        <h1 className="font-display text-2xl">We couldn&apos;t add this document</h1>
        <p className="text-sm">
          {p.outcome === 'email_mismatch'
            ? `This document was sent to a different email address than the one on this account (${session.user.email}). Sign in with the account for that address, or keep using the link in your email. Nothing is shared with this account.`
            : p.outcome === 'not_completed'
              ? 'This document is not completed yet. You can add it once everyone has signed.'
              : 'This document is not available to add. You can still open it from the link in your email.'}
        </p>
        <Link href="/my-documents" className={buttonClass('secondary')}>
          Go to My Documents
        </Link>
      </Shell>
    );

  const date = p.completedAt
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: displayTimeZone() }).format(
        p.completedAt,
      )
    : null;
  return (
    <Shell>
      <TrackOnMount event="registration_completed" onceKey={`st_reg_done:${t.requestId}`} />
      <FileCheck2 className="size-9 text-success" aria-hidden />
      <h1 className="font-display text-2xl">Add your signed document to your account?</h1>
      <div className="rounded-xl border border-border bg-ivory p-4">
        <p className="font-display text-lg text-heading">{p.title}</p>
        <p className="text-sm">
          From {p.senderName}
          {date ? ` · completed ${date}` : ''}
        </p>
      </div>
      <p className="text-sm">
        You&apos;ll be able to view and download the signed copy and its evidence certificate from
        My Documents. The document stays the sender&apos;s: adding it gives you your own copy and
        nothing else from their account.
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-error">
          That didn&apos;t work. Please try again.
        </p>
      ) : null}
      <form action={claimAction.bind(null, ticket)}>
        <button type="submit" className={buttonClass('primary', 'lg', 'w-full')}>
          Add to My Documents
        </button>
      </form>
      <Link
        href="/my-documents"
        className="mx-auto inline-flex min-h-11 items-center px-3 font-medium text-primary underline-offset-4 hover:underline"
      >
        Not now
      </Link>
    </Shell>
  );
}
