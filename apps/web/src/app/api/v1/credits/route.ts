import { getCreditBalance } from '@st/core';
import { db } from '@/lib/db';
import { apiRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({ scope: 'billing:read' }, async ({ principal }) => {
  const b = await getCreditBalance(db(), principal);
  return { status: 200, body: b };
});
