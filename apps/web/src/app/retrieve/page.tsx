import { Download, FileCheck2, Clock } from 'lucide-react';
import { AppError, listRetrievable } from '@st/core';
import { db } from '@/lib/db';
import { readRetrieveSession } from '@/lib/retrieve-session';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { EndSessionButton, NewLinkButton, RetrieveForms } from './forms';

export const metadata = { title: 'Get your documents' };
export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

/**
 * Recipients without an account verify their email with a one-time code, then see only the
 * requests sent to that address: completed copies to download and lost signing links to replace.
 */
export default async function RetrievePage() {
  const token = await readRetrieveSession();
  let data: Awaited<ReturnType<typeof listRetrievable>> | null = null;
  if (token) {
    try {
      data = await listRetrievable(db(), token);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="font-display text-3xl">Get your documents</h1>
      {!data ? (
        <Card>
          <p className="mb-4 text-sm">
            Lost an email from Signature Tender? Enter the address the document was sent to. We will
            email you a one-time code, then show the documents sent to that address. You can
            download completed copies the sender allowed, or get a fresh link for anything still
            waiting for your signature.
          </p>
          <RetrieveForms />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              Showing documents sent to <strong className="text-heading">{data.email}</strong>. This
              session ends after 30 minutes.
            </p>
            <EndSessionButton />
          </div>
          {data.requests.length === 0 ? (
            <Card>
              <p className="text-sm">There are no documents for this address right now.</p>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Your documents">
              {data.requests.map((r) => (
                <li key={r.requestId}>
                  <Card className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="font-display text-xl">{r.title}</h2>
                        <p className="text-sm">
                          From {r.senderName}
                          {r.workspaceName ? ` (${r.workspaceName})` : ''}
                          {r.sentAt ? ` · sent ${fmt.format(r.sentAt)}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {r.isTest ? <Badge tone="warning">Test</Badge> : null}
                        {r.status === 'completed' ? (
                          <Badge tone="success">
                            <FileCheck2 className="mr-1 inline size-3" aria-hidden />
                            Completed
                          </Badge>
                        ) : r.awaitingYou ? (
                          <Badge tone="warning">
                            <Clock className="mr-1 inline size-3" aria-hidden />
                            Waiting for you
                          </Badge>
                        ) : (
                          <Badge tone="info">In progress</Badge>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {r.canDownload ? (
                        <>
                          <a
                            href={`/api/retrieve/${r.requestId}/file?kind=signed`}
                            className={buttonClass('primary', 'sm')}
                          >
                            <Download className="size-4" aria-hidden /> Signed copy
                          </a>
                          <a
                            href={`/api/retrieve/${r.requestId}/file?kind=certificate`}
                            className={buttonClass('secondary', 'sm')}
                          >
                            <Download className="size-4" aria-hidden /> Certificate
                          </a>
                        </>
                      ) : r.status === 'completed' ? (
                        <p className="text-sm">
                          The sender did not allow downloads for this document. Ask them for a copy.
                        </p>
                      ) : r.awaitingYou ? (
                        <NewLinkButton requestId={r.requestId} />
                      ) : (
                        <p className="text-sm">
                          Others are still signing. Check back when it is complete.
                        </p>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
