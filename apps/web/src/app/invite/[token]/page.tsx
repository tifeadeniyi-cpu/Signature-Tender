import Link from 'next/link';
import { previewInvitation } from '@st/core';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { AcceptInvite } from './accept';

export const metadata = { title: 'Workspace invitation', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const MESSAGES = {
  revoked: 'This invitation was cancelled. Ask the person who invited you for a new one.',
  accepted: 'This invitation has already been used.',
  expired: 'This invitation has expired. Ask the person who invited you to send it again.',
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSession();
  const invite = await previewInvitation(db(), session ? { userId: session.user.id } : null, token);
  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10"
    >
      <Card>
        {!invite ? (
          <>
            <h1 className="font-display text-2xl">Invitation not found</h1>
            <p className="mt-2 text-sm">This link is not valid. Check that you copied all of it.</p>
          </>
        ) : invite.state !== 'open' ? (
          <>
            <h1 className="font-display text-2xl">Invitation to {invite.workspaceName}</h1>
            <Alert tone="warning" className="mt-3">
              {MESSAGES[invite.state]}
            </Alert>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl">Join {invite.workspaceName}</h1>
            <p className="mt-2 text-sm">
              {invite.inviterName} invited <strong className="text-heading">{invite.email}</strong>{' '}
              to join as <strong className="text-heading">{invite.roleName}</strong>.
            </p>
            {!session ? (
              <div className="mt-5 flex flex-col gap-2">
                <p className="text-sm">
                  Sign in or create an account with {invite.email} to accept.
                </p>
                <Link href={`/sign-in?next=${next}`} className={buttonClass('primary')}>
                  Sign in
                </Link>
                <Link href={`/sign-up?next=${next}`} className={buttonClass('secondary')}>
                  Create an account
                </Link>
              </div>
            ) : session.user.email.toLowerCase() !== invite.email.toLowerCase() ? (
              <Alert tone="warning" className="mt-4">
                You are signed in as {session.user.email}. This invitation is for {invite.email}.
                Sign out and sign in with that address to accept.
              </Alert>
            ) : (
              <AcceptInvite token={token} />
            )}
          </>
        )}
      </Card>
    </main>
  );
}
