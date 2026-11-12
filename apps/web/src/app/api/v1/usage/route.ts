import { z } from 'zod';
import { getUsage } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({ scope: 'billing:read' }, async ({ req, principal }) => {
  const months = z.coerce
    .number()
    .int()
    .min(1)
    .max(24)
    .catch(6)
    .parse(new URL(req.url).searchParams.get('months') ?? 6);
  return { status: 200, body: { data: await getUsage(db(), principal, months) } };
});
