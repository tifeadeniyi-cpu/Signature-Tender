import Link from 'next/link';
import { AppError, getCompletedForRetrieval, type CompletedView } from '@st/core';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { readRetrieveSession } from '@/lib/retrieve-session';
import { displayTimeZone, supportEmail } from '@/lib/completed';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { CompletedPage } from '@/components/completed/completed-page';
import { AccountPromo, ExistingCustomerPanel } from '@/components/completed/account-promo';
import { saveToAccountAction, startAccountAction } from '@/components/completed/actions';
import { AutoDownload } from './viewer';

export const metadata = { title: 'Your document' };
export const dynamic = 'force-dynamic';

/**
 * A request as a verified recipient sees it (the completion email's buttons land here after the
 * email code): the completed-document view, or its in-progress states. Requires a verified-email
 * session for an address the request was sent to.
 */
export default async function RetrievedDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ rid: string }>;
  searchParams: Promise<{ tab?: string; view?: string; start?: string }>;
}) {
  const { rid } = await params;
  const sp = await searchParams;
  const evidence = sp.view === 'evidence' || sp.tab === 'evidence';
  let view: CompletedView;
  try {
    view = await getCompletedForRetrieval(db(), await readRetrieveSession(), rid);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-10">
        <h1 className="font-display text-3xl">Your document</h1>
        <Card className="flex flex-col gap-4 p-6">
          <Alert tone={err.code === 'unauthenticated' ? 'info' : 'error'}>
            {err.code === 'unauthenticated'
              ? 'Your secure session has ended. Use the button in your email again, or verify your email address below.'
              : 'This document is not available to the address you verified.'}
          </Alert>
          <Link href="/retrieve" className={buttonClass('primary')}>
            Get your documents
          </Link>
        </Card>
      </div>
    );
  }

  if (view.state === 'completed' && view.canOpenFiles && !view.files.certificate)
    console.error(`[ops-alert] Completed request ${rid} has no evidence certificate available.`);

  const session = await getSession();
  const signedIn = Boolean(session?.user.emailVerified);
  const source = { kind: 'retrieval' as const, requestId: rid };
  const fileUrl = (kind: 'package' | 'signed' | 'certificate', inline = false) =>
    `/api/retrieve/${rid}/file?kind=${kind}${inline ? '&view=1' : ''}`;

  return (
    <>
      <CompletedPage
        view={view}
        evidence={evidence}
        selfHref={`/retrieve/documents/${rid}`}
        fileUrl={fileUrl}
        supportEmail={await supportEmail()}
        timeZone={displayTimeZone()}
        notice={
          sp.start === 'download' && view.canOpenFiles ? (
            <AutoDownload href={fileUrl('signed')} />
          ) : null
        }
        aside={
          view.state !== 'completed' ? null : signedIn ? (
            <ExistingCustomerPanel
              saveAction={saveToAccountAction.bind(null, source)}
              saved={false}
            />
          ) : (
            <AccountPromo requestId={rid} startAction={startAccountAction.bind(null, source)} />
          )
        }
      />
      <p className="mx-auto max-w-[1600px] px-4 pb-8 text-xs sm:px-6">
        Signed in as {view.you?.email} for 30 minutes.{' '}
        <Link href="/retrieve" className="underline">
          All your documents
        </Link>
      </p>
    </>
  );
}
