import { CreditCard } from 'lucide-react';
import { ComingSoon } from '@/components/app/coming-soon';

export const metadata = { title: 'Billing & Credits' };

export default function Page() {
  return (
    <ComingSoon
      title="Billing & Credits"
      description="Manage credits, plans, payments, and invoices."
      icon={<CreditCard className="size-8" />}
      phase={4}
    >
      Buying credits, subscribing to a plan and viewing receipts arrives with payments. No charges
      can be made yet.
    </ComingSoon>
  );
}
