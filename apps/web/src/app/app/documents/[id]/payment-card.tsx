'use client';
import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button, buttonClass } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { payForRequestAction } from '@/app/app/billing/actions';
import { sendWithCreditAction } from '../actions';

/** Shown while a real request waits for payment. Sending happens only after Stripe confirms. */
export function PaymentCard({
  documentId,
  requestId,
  status,
  price,
  available,
  canPay,
  paymentsOn,
  liveOn,
  cancelled,
}: {
  documentId: string;
  requestId: string;
  status: 'awaiting_payment' | 'payment_processing';
  price: string;
  available: number;
  canPay: boolean;
  paymentsOn: boolean;
  liveOn: boolean;
  cancelled: boolean;
}) {
  const router = useRouter();
  const [creditState, sendCredit, sendingCredit] = useActionState(
    sendWithCreditAction.bind(null, documentId, requestId),
    null,
  );
  const [payState, pay, paying] = useActionState(payForRequestAction.bind(null, requestId), null);

  // While Stripe confirms, check back every few seconds for up to two minutes.
  useEffect(() => {
    if (status !== 'payment_processing') return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      router.refresh();
      if (n >= 40) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
  }, [status, router]);

  useEffect(() => {
    if (creditState?.ok) router.refresh();
  }, [creditState, router]);

  return (
    <Card className="mb-6 border-warning">
      <div className="flex items-start gap-3">
        <CreditCard className="mt-1 size-6 shrink-0 text-primary" aria-hidden />
        <div className="flex flex-1 flex-col gap-3">
          <div>
            <h2 className="font-display text-xl">
              {status === 'payment_processing'
                ? 'Confirming your payment'
                : 'Payment needed to send'}
            </h2>
            <p className="mt-1 text-sm">
              {status === 'payment_processing'
                ? 'Stripe is confirming your payment. As soon as it does, we send the request and email your recipients. This page checks again automatically.'
                : `This request is ready but has not been sent. Nobody has been emailed yet. Sending costs 1 credit or ${price}.`}
            </p>
          </div>
          {cancelled ? (
            <Alert tone="info">Checkout was cancelled. You have not been charged.</Alert>
          ) : null}
          {!liveOn ? (
            <Alert tone="warning">
              Real sending is switched off right now, so this request cannot be sent yet. Any
              payment would be kept as a credit.
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {available > 0 ? (
              <form action={sendCredit}>
                <Button type="submit" loading={sendingCredit} disabled={!liveOn}>
                  Use a credit and send ({available} available)
                </Button>
              </form>
            ) : null}
            {canPay && paymentsOn && available === 0 ? (
              <form action={pay}>
                <Button type="submit" loading={paying} disabled={!liveOn}>
                  {status === 'payment_processing'
                    ? `Pay again (${price})`
                    : `Pay ${price} and send`}
                </Button>
              </form>
            ) : null}
            {canPay && paymentsOn ? (
              <Link href="/app/billing?tab=credits" className={buttonClass('secondary')}>
                Buy credits instead
              </Link>
            ) : null}
          </div>
          {status === 'payment_processing' ? (
            <p className="text-xs">
              Closed the checkout page without paying? You can pay again. If both payments go
              through, the extra one stays in your workspace as a credit.
            </p>
          ) : null}
          {!canPay && available === 0 ? (
            <p className="text-sm">
              Ask a workspace owner or admin to add credits or pay for this request.
            </p>
          ) : null}
          {canPay && !paymentsOn ? (
            <p className="text-sm">
              Online payments are not switched on yet. No charge can be made.
            </p>
          ) : null}
          {creditState && !creditState.ok ? (
            <Alert tone="error">{creditState.message}</Alert>
          ) : null}
          {creditState?.ok ? <Alert tone="success">{creditState.message}</Alert> : null}
          {payState && !payState.ok ? <Alert tone="error">{payState.message}</Alert> : null}
        </div>
      </div>
    </Card>
  );
}
