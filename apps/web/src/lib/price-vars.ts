import 'server-only';
import { formatMoney, getConfigValue, getPricing } from '@st/core';
import { getStudioSettings } from '@st/core/studio/server';
import { db } from '@/lib/db';
import type { PriceVars } from '@/lib/marketing-pages';

/** Live prices and limits for marketing copy. Never typed into the copy itself. */
export async function getPriceVars(): Promise<PriceVars> {
  const [{ prices }, studio, maxSigners] = await Promise.all([
    getPricing(db()),
    getStudioSettings(db()),
    getConfigValue<number>(db(), 'limits.max_signers_per_request', 5),
  ]);
  const single = prices.find((p) => p.code === 'single_request');
  return {
    price: single ? formatMoney(single.amountCents, single.currency) : 'one low price',
    studioPrice: formatMoney(studio.priceCents, studio.currency),
    maxSigners,
  };
}
