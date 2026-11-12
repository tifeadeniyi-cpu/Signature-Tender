import Link from 'next/link';
import { Award, Download, Eye, FileCheck2, PartyPopper } from 'lucide-react';
import { listClaimedDocuments, listMyWorkspaces } from '@st/core';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { displayTimeZone } from '@/lib/completed';
import { documentReference } from '@/lib/document-summary';
import { buttonClass } from '@/components/ui/button';
import { DownloadLink, TrackOnMount } from '@/components/completed/client-bits';

export const dynamic = 'force-dynamic';

/**
 * Documents a signed-in user added after signing ("Documents signed by me"), plus the welcome
 * step of post-signing registration. Works without a workspace: signers don't need to set one up
 * unless they want to send documents themselves.
 */
export default async function MyDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; new?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [docs, workspaces] = await Promise.all([
    listClaimedDocuments(db(), user.id),
    listMyWorkspaces(db(), { userId: user.id }),
  ]);
  const welcome = sp.welcome ? docs.find((d) => d.requestId === sp.welcome) : undefined;
  const fmt = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: displayTimeZone(),
  });
  const hasWorkspace = workspaces.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      {welcome ? (
        <section
          aria-labelledby="welcome-heading"
          className="flex flex-col items-center gap-2 rounded-2xl border border-success/20 bg-gradient-to-b from-success-bg/60 to-white p-6 text-center shadow-card"
        >
          {sp.new ? (
            <TrackOnMount event="document_claimed" onceKey={`st_claimed:${welcome.requestId}`} />
          ) : null}
          <PartyPopper className="size-9 text-primary" aria-hidden />
          <h1 id="welcome-heading" className="font-display text-3xl">
            Welcome to Signature Tender!
          </h1>
          <p className="text-heading/85">Your signed document is ready in your workspace.</p>
        </section>
      ) : (
        <h1 className="font-display text-3xl">My Documents</h1>
      )}

      <section aria-labelledby="signed-heading" className="flex flex-col gap-3">
        <h2 id="signed-heading" className="font-display text-2xl">
          Documents Signed by Me
        </h2>
        {docs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-white/70 p-8 text-center text-sm">
            Nothing here yet. When you finish signing a document, choose Save to My Documents on the
            completed page to keep a copy here.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {docs.map((d) => (
              <li
                key={d.requestId}
                className={`rounded-2xl border bg-white p-5 shadow-card ${d.requestId === welcome?.requestId ? 'border-success/40 ring-2 ring-success/20' : 'border-border'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-xl">{d.title}</h3>
                    <p className="text-sm">
                      From {d.senderName}
                      {d.workspaceName ? ` (${d.workspaceName})` : ''} · Document ID{' '}
                      {documentReference(d.documentId)}
                    </p>
                  </div>
                  <p className="flex items-center gap-1 text-sm font-medium text-success">
                    <FileCheck2 className="size-4" aria-hidden />
                    Completed{d.completedAt ? ` ${fmt.format(d.completedAt)}` : ''}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/my-documents/${d.requestId}`}
                    className={buttonClass('primary', 'sm')}
                  >
                    <Eye className="size-4" aria-hidden /> View Document
                  </Link>
                  {d.canDownload ? (
                    <>
                      <DownloadLink
                        href={`/api/claimed/${d.requestId}/file?kind=signed`}
                        from="my_documents"
                        className={buttonClass('secondary', 'sm')}
                      >
                        <Download className="size-4" aria-hidden /> Download
                      </DownloadLink>
                      <Link
                        href={`/my-documents/${d.requestId}?view=evidence`}
                        className={buttonClass('secondary', 'sm')}
                      >
                        <Award className="size-4" aria-hidden /> View Evidence
                      </Link>
                    </>
                  ) : (
                    <p className="self-center text-sm">
                      The sender has not turned on downloads for this document.
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-gradient-to-r from-blush to-ivory p-6">
        <div>
          <h2 className="font-display text-xl">
            {hasWorkspace ? 'Your workspace' : 'Need signatures of your own?'}
          </h2>
          <p className="text-sm">
            {hasWorkspace
              ? 'Documents you send for signature live in your workspace dashboard.'
              : 'Set up a workspace to upload a document and send it for signature. You pay per request, with no subscription.'}
          </p>
        </div>
        <Link
          href={hasWorkspace ? '/app/documents' : '/onboarding'}
          className={buttonClass('primary')}
        >
          {hasWorkspace ? 'Go to my dashboard' : 'Set up my workspace'}
        </Link>
      </section>
    </div>
  );
}
