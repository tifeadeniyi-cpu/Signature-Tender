import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getStudioCheckoutStatus } from '@st/core/studio/server';
import { buttonClass } from '@/components/ui/button';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { Refresher } from './refresher';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirming payment', robots: { index: false } };

/**
 * Where Stripe sends the customer back. Nothing is unlocked here: we wait for our own records,
 * which only the signed webhook updates.
 */
export default async function ReturnPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const session = await getSession();
  const { p } = await searchParams;
  if (!session?.user.emailVerified)
    redirect(p ? `/sign-in?next=${encodeURIComponent(`/signature-studio/return?p=${p}`)}` : '/sign-in');
  const status = p ? await getStudioCheckoutStatus(db(), session.user.id, p) : null;
  if (!status) notFound();
  if (status.status === 'paid') redirect(`/signature-studio/design/${status.designId}?new=1`);
  const failed = ['failed', 'expired', 'refunded', 'disputed', 'duplicate'].includes(status.status);
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      {failed ? (
        <>
          <h1 className="font-display text-3xl text-heading">Payment not completed</h1>
          <p className="mt-3 text-slate-text">
            {status.status === 'duplicate' ? 'You already own this design, so this payment is being refunded.' : 'Your payment did not go through and you have not been charged.'}
          </p>
          <Link href={`/signature-studio/checkout/${status.designId}`} className={buttonClass('primary', 'lg', 'mt-6')}>
            Back to checkout
          </Link>
        </>
      ) : (
        <>
          <span className="mx-auto block size-10 animate-spin rounded-full border-4 border-primary border-t-transparent" aria-hidden />
          <h1 className="mt-6 font-display text-3xl text-heading" role="status">
            Confirming your payment…
          </h1>
          <p className="mt-3 text-slate-text">This usually takes a few seconds. Your signature unlocks as soon as payment is confirmed.</p>
          <Refresher />
        </>
      )}
    </div>
  );
}
