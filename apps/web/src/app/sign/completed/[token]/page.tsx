import Link from 'next/link';
import type { Metadata } from 'next';
import { AppError, getCompletedForSigner, type CompletedView } from '@st/core';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { readSignSession } from '@/lib/sign-session';
import { readRetrieveSession } from '@/lib/retrieve-session';
import { displayTimeZone, supportEmail } from '@/lib/completed';
import { buttonClass } from '@/components/ui/button';
import { PublicHeader } from '@/components/completed/public-header';
import { CompletedPage } from '@/components/completed/completed-page';
import { AccountPromo, ExistingCustomerPanel } from '@/components/completed/account-promo';
import { RecipientVerifyForm } from '@/components/completed/verify-form';
import { saveToAccountAction, startAccountAction } from '@/components/completed/actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your completed document',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * The completed document for a recipient's own link (spec: /sign/completed/:accessReference).
 * The link token identifies the recipient; access also needs their signing session, a verified
 * email session for the same address, or (link-only recipients) the link itself.
 */
export default async function SignerCompletedPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { token } = await params;
  const evidence = (await searchParams).view === 'evidence';
  const session = await getSession();
  const user = session?.user.emailVerified ? { name: session.user.name } : null;
  const help = await supportEmail();
  const header = <PublicHeader user={user} supportEmail={help} />;

  let result: Awaited<ReturnType<typeof getCompletedForSigner>>;
  try {
    result = await getCompletedForSigner(
      db(),
      token,
      await readSignSession(token),
      await readRetrieveSession(),
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'not_found') throw err;
    return (
      <>
        {header}
        <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-10">
          <h1 className="font-display text-3xl">This link has expired</h1>
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-6 shadow-card">
            <p className="text-sm">
              For your security, signing links stop working after a while. You can still get your
              completed documents: verify the email address they were sent to and we&apos;ll show
              them to you. No account needed.
            </p>
            <Link href="/retrieve" className={buttonClass('primary', 'lg')}>
              Get my documents
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (result.state === 'verify')
    return (
      <>
        {header}
        <RecipientVerifyForm token={token} title={result.title} maskedEmail={result.maskedEmail} />
      </>
    );

  const view: CompletedView = result;
  const source = { kind: 'signer' as const, token };
  const base = `/api/sign/${token}/completed`;
  return (
    <>
      {header}
      <CompletedPage
        view={view}
        evidence={evidence}
        selfHref={`/sign/completed/${token}`}
        fileUrl={(kind, inline) => `${base}?kind=${kind}${inline ? '&view=1' : ''}`}
        signHref={`/sign/${token}`}
        supportEmail={help}
        timeZone={displayTimeZone()}
        aside={
          view.state !== 'completed' ? null : user ? (
            <ExistingCustomerPanel
              saveAction={saveToAccountAction.bind(null, source)}
              saved={false}
            />
          ) : (
            <AccountPromo
              requestId={view.request.id}
              startAction={startAccountAction.bind(null, source)}
            />
          )
        }
      />
    </>
  );
}
