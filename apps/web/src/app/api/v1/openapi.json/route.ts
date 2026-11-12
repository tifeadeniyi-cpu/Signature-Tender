import { env } from '@/lib/env';
import { openApiDocument } from '@/lib/openapi';

export const dynamic = 'force-dynamic';

/** Public API description. Contains no workspace data. */
export function GET() {
  return Response.json(openApiDocument(env().BETTER_AUTH_URL), {
    headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' },
  });
}
