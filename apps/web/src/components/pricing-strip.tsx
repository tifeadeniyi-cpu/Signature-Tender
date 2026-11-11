import { formatMoney, bundleSavingsPercent } from '@st/core';
import { cn } from '@/lib/cn';

type Price = { code: string; name: string; credits: number; amountCents: number; currency: string };

/** Pay-as-you-go prices, read from the prices table. Savings are computed, never typed in. */
export function PricingStrip({ prices }: { prices: Price[] }) {
  const single = prices.find((p) => p.code === 'single_request');
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {prices.map((p) => {
        const savings = single && p.code !== single.code ? bundleSavingsPercent(single, p) : 0;
        const featured = p.code === single?.code;
        return (
          <li
            key={p.code}
            className={cn(
              'flex flex-col items-center rounded-xl border p-4 text-center',
              featured ? 'border-primary bg-primary text-white' : 'border-border bg-white',
            )}
          >
            <span className={cn('font-display text-2xl', featured ? 'text-white' : 'text-heading')}>
              {formatMoney(p.amountCents, p.currency)}
            </span>
            <span className="text-sm">
              {p.credits === 1 ? 'Per document' : `${p.credits} documents`}
            </span>
            {featured ? <span className="mt-2 text-xs text-rose-gold">Pay as you go</span> : null}
            {savings > 0 ? (
              <span className="mt-2 rounded-full bg-blush px-2 py-0.5 text-xs font-semibold text-primary">
                Save {savings}%
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
