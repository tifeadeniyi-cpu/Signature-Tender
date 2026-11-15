import { notFound } from 'next/navigation';
import { AppError, getCompletedForClaimant, type CompletedView } from '@st/core';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { displayTimeZone, supportEmail } from '@/lib/completed';
import { CompletedPage } from '@/components/completed/completed-page';
import { ExistingCustomerPanel } from '@/components/completed/account-promo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your signed document' };

/** A document the signed-in user claimed: same view, no sign-up offer. */
export default async function ClaimedDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ rid: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser();
  const { rid } = await params;
  let view: CompletedView;
  try {
    view = await getCompletedForClaimant(db(), user.id, rid);
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') notFound();
    throw err;
  }
  return (
    <CompletedPage
      view={view}
      evidence={(await searchParams).view === 'evidence'}
      selfHref={`/my-documents/${rid}`}
      fileUrl={(kind, inline) => `/api/claimed/${rid}/file?kind=${kind}${inline ? '&view=1' : ''}`}
      supportEmail={await supportEmail()}
      timeZone={displayTimeZone()}
      aside={<ExistingCustomerPanel saveAction={null} saved />}
    />
  );
}
