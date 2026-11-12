import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { maskEmail, resolveNotificationLink, retrievalSessionEmail } from '@st/core';
import { db } from '@/lib/db';
import { readRetrieveSession } from '@/lib/retrieve-session';
import { LINK_TARGETS, type LinkTarget } from '@/lib/notifications';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { destinationFor } from './destination';
import { LinkVerifyForm } from './link-form';

export const metadata = { title: 'Open your document' };
export const dynamic = 'force-dynamic';

/**
 * Landing page for the buttons in a completion email. The link identifies the document and the
 * address it was sent to; it never opens the document by itself. Someone already verified for
 * that address in this browser goes straight through; anyone else must enter a code sent there.
 */
export default async function LinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ to?: string }>;
}) {
  const { token } = await params;
  const raw = (await searchParams).to;
  const to: LinkTarget = LINK_TARGETS.includes(raw as LinkTarget) ? (raw as LinkTarget) : 'view';
  const link = await resolveNotificationLink(db(), token);

  if (!link || link.audience !== 'recipient')
    return (
      <Shell>
        <Alert tone="error">This link is not valid. It may have been copied incompletely.</Alert>
        <p className="text-sm">You can still get your documents by verifying your email address.</p>
        <Link href="/retrieve" className={buttonClass('primary')}>
          Get your documents
        </Link>
      </Shell>
    );

  if (link.revoked)
    return (
      <Shell title={link.title}>
        <Alert tone="warning">
          The sender turned off the links in this email. Contact them if you need a copy.
        </Alert>
      </Shell>
    );

  const sessionEmail = await retrievalSessionEmail(db(), await readRetrieveSession());
  if (!link.expired && sessionEmail === link.email) redirect(destinationFor(link.requestId, to));

  return (
    <Shell title={link.title}>
      {link.expired ? (
        <Alert tone="warning">
          This secure link has expired. Verify your email address and we will send you a new one.
        </Alert>
      ) : null}
      <LinkVerifyForm
        token={token}
        to={to}
        maskedEmail={maskEmail(link.email)}
        expired={link.expired}
      />
      <p className="text-xs">
        Forwarding the email does not give anyone else access: the code only goes to the original
        address.
      </p>
    </Shell>
  );
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-10">
      <div className="flex items-center gap-2 text-heading">
        <ShieldCheck className="size-6 text-primary" aria-hidden />
        <h1 className="font-display text-3xl">Open your document</h1>
      </div>
      <Card className="flex flex-col gap-4 p-6">
        {title ? <p className="font-display text-xl text-heading">{title}</p> : null}
        {children}
      </Card>
    </div>
  );
}
