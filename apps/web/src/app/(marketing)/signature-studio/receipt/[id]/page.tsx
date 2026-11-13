import { notFound, redirect } from 'next/navigation';
import { formatMoney } from '@st/core';
import { getReceipt } from '@st/core/studio/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Receipt', robots: { index: false } };

const STATUS: Record<string, string> = { paid: 'Paid', refunded: 'Refunded', disputed: 'Disputed', duplicate: 'Refunded (duplicate payment)' };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user.emailVerified) redirect('/sign-in');
  const r = await getReceipt(db(), session.user.id, (await params).id);
  if (!r || !STATUS[r.purchase.paymentStatus]) notFound();
  const p = r.purchase;
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="rounded-2xl border border-border bg-white p-8 shadow-card">
        <h1 className="font-display text-2xl text-heading">Receipt</h1>
        <p className="text-sm text-slate-text">Signature Tender · Signature Studio</p>
        <dl className="mt-6 space-y-3 text-sm">
          {[
            ['Receipt number', p.id.slice(0, 8).toUpperCase()],
            ['Date', (p.purchasedAt ?? p.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })],
            ['Item', `Custom ${p.designSnapshot && (p.designSnapshot as { kind?: string }).kind === 'initials' ? 'initials' : 'signature'} design: ${r.designName}`],
            ['Style', r.style],
            ['Amount', formatMoney(p.amountCents, p.currency)],
            ...(p.amountRefundedCents ? [['Refunded', formatMoney(p.amountRefundedCents, p.currency)]] : []),
            ['Status', STATUS[p.paymentStatus]!],
            ['Paid with', 'Card via Stripe'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-border pb-2">
              <dt className="text-slate-text">{k}</dt>
              <dd className="text-right font-medium text-heading">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-xs text-slate-text">Questions about this charge? Contact support and quote the receipt number.</p>
      </div>
    </div>
  );
}
