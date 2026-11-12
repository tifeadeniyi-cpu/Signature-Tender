import type { Instrumentation } from 'next';

/**
 * Logs every unhandled server error as one JSON line, so Vercel log search, log drains and alert
 * rules can match on `event: "server.error"`. Request paths are logged without query strings, and
 * signing or retrieval tokens are masked, because those paths carry secrets.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const error = err as Error & { digest?: string };
  const path = request.path
    .split('?')[0]!
    .replace(/\/(sign|invite|retrieve)\/[^/]+/, '/$1/[token]')
    .replace(/\/api\/sign\/[^/]+/, '/api/sign/[token]');
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'server.error',
      digest: error.digest ?? null,
      name: error.name,
      message: error.message?.slice(0, 500),
      method: request.method,
      path,
      routePath: context.routePath,
      routeType: context.routeType,
      at: new Date().toISOString(),
    }),
  );
};
