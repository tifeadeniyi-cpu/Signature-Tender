import 'server-only';
import { SELF_SIGN_DEFAULT_PRICE, formatMoney, getConfigValue } from '@st/core';
import { db } from '@/lib/db';

/** The "Sign it yourself" price for display, e.g. "$0.99" (billing.self_sign_price overrides). */
export async function selfSignPriceLabel() {
  const v = await getConfigValue<{ amountCents?: number; currency?: string }>(
    db(),
    'billing.self_sign_price',
    SELF_SIGN_DEFAULT_PRICE,
  );
  const cents = Number.isInteger(v.amountCents) && v.amountCents! >= 50 ? v.amountCents! : 99;
  return formatMoney(cents, v.currency ?? 'USD');
}
