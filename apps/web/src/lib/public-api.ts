import 'server-only';
import { after } from 'next/server';
import { ZodError } from 'zod';
import {
  AppError,
  authenticateApiKey,
  beginIdempotent,
  finishIdempotent,
  getConfigValue,
  hitRateLimit,
  isFeatureEnabled,
  requireScope,
  sha256Hex,
  type ApiPrincipal,
  type ApiScope,
} from '@st/core';
import { db } from './db';
import { env } from './env';
import { runWebhookDispatch } from './webhooks';

/**
 * Shared plumbing for /api/v1: key authentication, scopes, per-key rate limits, request size
 * limits, Idempotency-Key replay, and a single JSON error shape. Errors never include stack
 * traces or internal details.
 */

const STATUS: Record<string, number> = {
  invalid: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  idempotency_mismatch: 422,
  idempotency_in_progress: 409,
  unavailable: 503,
  server_error: 500,
};

export class ApiFailure extends Error {
  constructor(
    public readonly code: keyof typeof STATUS,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiContext<P> {
  req: Request;
  principal: ApiPrincipal;
  params: P;
  requestId: string;
  meta: { ipAddress: string | null; userAgent: string | null };
  /** The raw body, already size-checked. */
  body: Uint8Array;
  json: () => unknown;
}

export type ApiResult = { status: number; body: unknown } | Response;

interface Options {
  scope: ApiScope;
  /** Body size limit for this route: 'json' uses the configured JSON limit, 'upload' the PDF limit. */
  body?: 'none' | 'json' | 'upload';
  /** Webhook events may result, so try a dispatch after responding. */
  emits?: boolean;
}

function errorBody(code: string, message: string, requestId: string) {
  return { error: { code, message, request_id: requestId } };
}

function respond(
  status: number,
  body: unknown,
  requestId: string,
  extra: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-request-id': requestId, ...extra },
  });
}

function mapError(err: unknown, requestId: string): { status: number; body: unknown } {
  if (err instanceof ApiFailure)
    return { status: STATUS[err.code] ?? 400, body: errorBody(err.code, err.message, requestId) };
  if (err instanceof AppError)
    return { status: STATUS[err.code] ?? 400, body: errorBody(err.code, err.message, requestId) };
  if (err instanceof ZodError) {
    const i = err.issues[0];
    const where = i?.path.length ? `${i.path.join('.')}: ` : '';
    return {
      status: 422,
      body: errorBody('invalid', `${where}${i?.message ?? 'Invalid input'}`, requestId),
    };
  }
  console.error(
    JSON.stringify({
      event: 'api.error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  return {
    status: 500,
    body: errorBody('server_error', 'Something went wrong. Please try again.', requestId),
  };
}

async function readBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes)
    throw new ApiFailure(
      'payload_too_large',
      `The request body is larger than ${Math.floor(maxBytes / 1024)} KB.`,
    );
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ApiFailure(
        'payload_too_large',
        `The request body is larger than ${Math.floor(maxBytes / 1024)} KB.`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export function apiRoute<P = Record<string, never>>(
  opts: Options,
  handler: (ctx: ApiContext<P>) => Promise<ApiResult>,
) {
  return async (req: Request, routeCtx: { params: Promise<P> }): Promise<Response> => {
    const requestId = crypto.randomUUID();
    let principal: ApiPrincipal | null = null;
    let idemKey: string | null = null;
    let rateHeaders: Record<string, string> = {};
    try {
      const d = db();
      if (!(await isFeatureEnabled(d, 'public_api', env().APP_ENV)))
        throw new ApiFailure('unavailable', 'The API is not enabled for this environment.');

      const auth = req.headers.get('authorization') ?? '';
      const m = /^Bearer\s+(\S+)$/i.exec(auth);
      if (!m)
        throw new ApiFailure(
          'unauthenticated',
          'Send your API key as "Authorization: Bearer <key>".',
        );
      principal = await authenticateApiKey(d, m[1]!);
      if (!principal)
        throw new ApiFailure(
          'unauthenticated',
          'This API key is not valid, or it was revoked or expired.',
        );

      const perMinute = await getConfigValue(d, 'api.rate_limit_per_minute', 120);
      rateHeaders = { 'x-ratelimit-limit': String(perMinute) };
      if (!(await hitRateLimit(d, principal.keyId, perMinute))) {
        const r = mapError(
          new ApiFailure('rate_limited', `Rate limit of ${perMinute} requests per minute reached.`),
          requestId,
        );
        return respond(r.status, r.body, requestId, { ...rateHeaders, 'retry-after': '60' });
      }
      requireScope(principal, opts.scope);

      const mode = opts.body ?? 'none';
      const maxBytes =
        mode === 'upload'
          ? ((await getConfigValue(d, 'limits.max_upload_mb', 25)) + 1) * 1024 * 1024
          : mode === 'json'
            ? (await getConfigValue(d, 'api.max_json_kb', 256)) * 1024
            : 16 * 1024;
      const body = req.method === 'GET' ? new Uint8Array() : await readBody(req, maxBytes);
      const url = new URL(req.url);

      idemKey =
        req.method === 'POST' || req.method === 'PUT' ? req.headers.get('idempotency-key') : null;
      if (idemKey) {
        const fp = `${req.method} ${url.pathname} ${sha256Hex(body)}`;
        const s = await beginIdempotent(d, principal.keyId, idemKey, fp);
        if (s.state === 'replay')
          return respond(s.status, s.body, requestId, {
            ...rateHeaders,
            'idempotent-replayed': 'true',
          });
        if (s.state === 'mismatch')
          throw new ApiFailure(
            'idempotency_mismatch',
            'This Idempotency-Key was already used with a different request.',
          );
        if (s.state === 'in_progress') {
          idemKey = null; // not ours to finish
          throw new ApiFailure(
            'idempotency_in_progress',
            'A request with this Idempotency-Key is still being processed.',
          );
        }
      }

      const h = req.headers;
      const ctx: ApiContext<P> = {
        req,
        principal,
        params: await routeCtx.params,
        requestId,
        body,
        meta: {
          ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
          userAgent: h.get('user-agent'),
        },
        json: () => {
          if (!body.byteLength) return {};
          try {
            return JSON.parse(new TextDecoder().decode(body));
          } catch {
            throw new ApiFailure('invalid', 'The request body is not valid JSON.');
          }
        },
      };
      const result = await handler(ctx);
      if (opts.emits) after(() => runWebhookDispatch().catch(() => {}));
      if (result instanceof Response) {
        result.headers.set('x-request-id', requestId);
        return result;
      }
      if (idemKey) await finishIdempotent(d, principal.keyId, idemKey, result.status, result.body);
      return respond(result.status, result.body, requestId, rateHeaders);
    } catch (err) {
      const r = mapError(err, requestId);
      if (principal && idemKey)
        await finishIdempotent(db(), principal.keyId, idemKey, r.status, r.body).catch(() => {});
      return respond(r.status, r.body, requestId, {
        ...rateHeaders,
        ...(r.status === 401 ? { 'www-authenticate': 'Bearer' } : {}),
      });
    }
  };
}

/** Rebuilds a Request around an already-read body, for multipart parsing. */
export function withBody(req: Request, body: Uint8Array) {
  return new Request(req.url, { method: req.method, headers: req.headers, body: body as BodyInit });
}
