import Link from 'next/link';
import { CircleCheck, Clock, CircleAlert } from 'lucide-react';
import { formatMoney, getCheckoutStatus } from '@st/core';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { Card } from '@/components/ui/card';
import { buttonClass } from '@/components/ui/button';
import { AutoRefresh } from './auto-refresh';

export const metadata = { title: 'Payment' };

/**
 * Where Stripe sends the customer back. Arriving here proves nothing: this page only reports what
 * our webhook has recorded, and checks again until Stripe's confirmation arrives.
 */
export default async function CheckoutReturn({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; back?: string }>;
}) {
  const { session_id, back } = await searchParams;
  const user = await requireUser();
  const status = session_id ? await getCheckoutStatus(db(), { userId: user.id }, session_id) : null;
  const backHref = status?.documentId
    ? `/app/documents/${status.documentId}`
    : back && back.startsWith('/app/') && !back.startsWith('//')
      ? back
      : '/app/billing';
  const paid =
    status && ['paid', 'partially_refunded', 'refunded', 'disputed'].includes(status.status);
  const failed = status && ['failed', 'expired'].includes(status.status);

  return (
    <div className="mx-auto max-w-xl py-8">
      <Card className="text-center">
        {!status ? (
          <>
            <CircleAlert className="mx-auto size-10 text-error" aria-hidden />
            <h1 className="mt-3 font-display text-2xl">We could not find this payment</h1>
            <p className="mt-2 text-sm">
              If you were charged, it will appear in your payment history shortly.
            </p>
          </>
        ) : paid ? (
          <>
            <CircleCheck className="mx-auto size-10 text-success" aria-hidden />
            <h1 className="mt-3 font-display text-2xl">Payment confirmed</h1>
            <p className="mt-2 text-sm">
              {status.kind === 'subscription'
                ? 'Your plan is active. Your monthly requests appear as soon as Stripe sends the first invoice.'
                : status.kind === 'request'
                  ? status.requestStatus === 'sent' || status.requestStatus === 'in_progress'
                    ? 'Your request has been sent and recipients have been emailed.'
                    : 'Your credit is ready. Open the document to send it.'
                  : `${status.credits} ${status.credits === 1 ? 'credit has' : 'credits have'} been added to your workspace.`}
            </p>
          </>
        ) : failed ? (
          <>
            <CircleAlert className="mx-auto size-10 text-error" aria-hidden />
            <h1 className="mt-3 font-display text-2xl">Payment not completed</h1>
            <p className="mt-2 text-sm">
              Nothing was added and you were not charged for this checkout.
            </p>
          </>
        ) : (
          <>
            <Clock className="mx-auto size-10 text-primary" aria-hidden />
            <h1 className="mt-3 font-display text-2xl">Confirming your payment</h1>
            <p className="mt-2 text-sm" role="status">
              We are waiting for Stripe to confirm{' '}
              {formatMoney(status.amountCents, status.currency)} for {status.description}. This
              usually takes a few seconds and this page checks again on its own.
            </p>
            <AutoRefresh />
          </>
        )}
        <Link href={backHref} className={buttonClass('primary', 'md', 'mt-6')}>
          {status?.documentId ? 'Back to the document' : 'Back to billing'}
        </Link>
      </Card>
    </div>
  );
}
