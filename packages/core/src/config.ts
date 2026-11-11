import { asc, eq } from 'drizzle-orm';
import { schema, type Database } from '@st/db';

export type AppEnv = 'development' | 'test' | 'staging' | 'production';

export async function getPricing(db: Database) {
  const [plans, prices] = await Promise.all([
    db
      .select()
      .from(schema.subscriptionPlans)
      .where(eq(schema.subscriptionPlans.active, true))
      .orderBy(asc(schema.subscriptionPlans.sortOrder)),
    db
      .select()
      .from(schema.prices)
      .where(eq(schema.prices.active, true))
      .orderBy(asc(schema.prices.sortOrder)),
  ]);
  return { plans, prices };
}

export async function isFeatureEnabled(db: Database, key: string, env: AppEnv): Promise<boolean> {
  const [flag] = await db
    .select()
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.key, key));
  if (!flag || !flag.enabled) return false;
  return flag.environments.length === 0 || flag.environments.includes(env);
}

/** Formats integer cents as a currency string, e.g. 299 -> "$2.99". */
export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** Percentage saved per credit compared with the single-request price, rounded down. */
export function bundleSavingsPercent(
  single: { amountCents: number; credits: number },
  bundle: { amountCents: number; credits: number },
): number {
  const unitSingle = single.amountCents / single.credits;
  const unitBundle = bundle.amountCents / bundle.credits;
  if (unitBundle >= unitSingle) return 0;
  return Math.floor((1 - unitBundle / unitSingle) * 100);
}

export async function getConfigValue<T>(db: Database, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(schema.appConfig).where(eq(schema.appConfig.key, key));
  return (row?.value as T | undefined) ?? fallback;
}
