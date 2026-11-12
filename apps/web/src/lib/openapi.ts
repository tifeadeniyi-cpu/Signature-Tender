import { API_SCOPES, WEBHOOK_EVENTS } from '@st/core';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ 'application/json': { schema } });
const err = { description: 'Error', content: json(ref('Error')) };
const idParam = (name: string, what: string) => ({
  name,
  in: 'path',
  required: true,
  description: `${what} id`,
  schema: { type: 'string', format: 'uuid' },
});
const idem = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  description:
    'Any unique string (8 to 200 characters). Repeating a request with the same key within 24 hours returns the first response instead of acting twice.',
  schema: { type: 'string' },
};
const std = { '401': err, '403': err, '404': err, '409': err, '422': err, '429': err };

function op(
  summary: string,
  scope: string,
  opts: { params?: object[]; body?: object; ok: [string, object | string]; idempotent?: boolean },
) {
  return {
    summary,
    description: `Requires the \`${scope}\` scope.`,
    security: [{ bearer: [scope] }],
    parameters: [...(opts.params ?? []), ...(opts.idempotent ? [idem] : [])],
    ...(opts.body ? { requestBody: { required: true, content: opts.body } } : {}),
    responses: {
      [opts.ok[0]]:
        typeof opts.ok[1] === 'string'
          ? { description: opts.ok[1] }
          : { description: 'OK', content: json(opts.ok[1]) },
      ...std,
    },
  };
}

export function openApiDocument(baseUrl: string) {
  const doc = idParam('id', 'Document');
  const req = idParam('id', 'Request');
  return {
    openapi: '3.1.0',
    info: {
      title: 'Signature Tender API',
      version: '1.0.0',
      description:
        'Create, send and track signing requests. Signature Tender keeps the canonical signing record and evidence; your app should store the ids it gets back. All requests use HTTPS and a bearer API key from Settings, Developers.',
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description: `API key (starts with stk_). Scopes: ${Object.entries(API_SCOPES)
            .map(([k, v]) => `${k} (${v})`)
            .join('; ')}.`,
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                request_id: { type: 'string' },
              },
            },
          },
        },
        Recipient: {
          type: 'object',
          required: ['name', 'email'],
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { enum: ['signer', 'reviewer', 'approver', 'cc', 'viewer'], default: 'signer' },
            signing_order: { type: 'integer', minimum: 1, default: 1 },
            auth_method: { enum: ['email_link', 'email_code'], default: 'email_link' },
          },
        },
        Field: {
          type: 'object',
          required: ['recipient_id', 'type', 'page', 'x', 'y', 'width', 'height'],
          description:
            'Position as fractions of the page (0 to 1), measured from the top left corner.',
          properties: {
            recipient_id: { type: 'string', format: 'uuid' },
            type: {
              enum: [
                'signature',
                'initials',
                'date_signed',
                'name',
                'email',
                'text',
                'checkbox',
                'dropdown',
                'radio',
                'number',
              ],
            },
            page: { type: 'integer', minimum: 1 },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            required: { type: 'boolean', default: true },
            label: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
          },
        },
        Document: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            status: { type: 'string' },
            external: { type: ['object', 'null'] },
            recipients: { type: 'array', items: ref('Recipient') },
            fields: { type: 'array', items: ref('Field') },
            requests: { type: 'array', items: { type: 'object' } },
          },
        },
        Request: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            document_id: { type: 'string', format: 'uuid' },
            status: {
              enum: [
                'awaiting_payment',
                'sent',
                'in_progress',
                'awaiting_approval',
                'completed',
                'declined',
                'expired',
                'cancelled',
              ],
            },
            test: { type: 'boolean' },
            signed_document_available: { type: 'boolean' },
            certificate_available: { type: 'boolean' },
            recipients: { type: 'array', items: { type: 'object' } },
          },
        },
        WebhookEvent: {
          type: 'object',
          description: `Sent as a POST with headers Signature-Tender-Event-Id and Signature-Tender-Signature (t=<unix>,v1=<hex HMAC-SHA256 of "t.body">). Types: ${WEBHOOK_EVENTS.join(', ')}, webhook.test.`,
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            workspace_id: { type: 'string', format: 'uuid' },
            data: { type: 'object' },
          },
        },
      },
    },
    paths: {
      '/documents': {
        post: op('Upload a PDF', 'documents:write', {
          idempotent: true,
          body: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  title: { type: 'string' },
                  document_type: { type: 'string' },
                  external_source: { type: 'string', description: 'For example beam_artist' },
                  external_id: { type: 'string', description: 'Your record id' },
                },
              },
            },
          },
          ok: ['201', ref('Document')],
        }),
        get: op('List documents, or find by your record id', 'documents:read', {
          params: [
            { name: 'external_source', in: 'query', schema: { type: 'string' } },
            { name: 'external_id', in: 'query', schema: { type: 'string' } },
          ],
          ok: [
            '200',
            { type: 'object', properties: { data: { type: 'array', items: { type: 'object' } } } },
          ],
        }),
      },
      '/documents/{id}': {
        get: op('Get a document', 'documents:read', {
          params: [doc],
          ok: ['200', ref('Document')],
        }),
      },
      '/documents/{id}/recipients': {
        put: op('Set recipients', 'documents:write', {
          params: [doc],
          idempotent: true,
          body: json({
            type: 'object',
            properties: {
              signing_order: { type: 'boolean' },
              recipients: { type: 'array', items: ref('Recipient') },
            },
          }),
          ok: ['200', ref('Document')],
        }),
      },
      '/documents/{id}/fields': {
        put: op('Set fields', 'documents:write', {
          params: [doc],
          idempotent: true,
          body: json({
            type: 'object',
            properties: { fields: { type: 'array', items: ref('Field') } },
          }),
          ok: ['200', ref('Document')],
        }),
      },
      '/documents/{id}/settings': {
        put: op('Set signing settings', 'documents:write', {
          params: [doc],
          body: json({
            type: 'object',
            properties: {
              settings: {
                type: 'object',
                properties: {
                  allow_download: { type: 'boolean' },
                  require_signer_auth: { type: 'boolean' },
                  expires_at: { type: ['string', 'null'], format: 'date' },
                  reminder_enabled: { type: 'boolean' },
                  reminder_every_days: { type: 'integer' },
                },
              },
              email_message: { type: 'string' },
            },
          }),
          ok: ['200', ref('Document')],
        }),
      },
      '/documents/{id}/external': {
        put: op('Link to your record', 'documents:write', {
          params: [doc],
          body: json({
            type: 'object',
            required: ['source', 'id'],
            properties: {
              source: { type: 'string' },
              id: { type: 'string' },
              metadata: { type: 'object' },
            },
          }),
          ok: ['200', ref('Document')],
        }),
      },
      '/documents/{id}/preparation-session': {
        post: op('Get a link to the field editor (the user must sign in)', 'documents:write', {
          params: [doc],
          ok: [
            '201',
            {
              type: 'object',
              properties: { url: { type: 'string' }, requires_sign_in: { type: 'boolean' } },
            },
          ],
        }),
      },
      '/documents/{id}/send': {
        post: op('Send for signature', 'requests:send', {
          params: [doc],
          idempotent: true,
          body: json({
            type: 'object',
            properties: {
              mode: { enum: ['test', 'live'], default: 'test' },
              notify: {
                type: 'boolean',
                default: true,
                description: 'false: no emails; use embedded sessions',
              },
              acknowledge_specialized_documents: {
                type: 'boolean',
                default: false,
                description:
                  'Required (true) for live sends: confirms the document is not one that needs extra formalities, such as a will, a notarized deed or a court filing. Recorded in the evidence log.',
              },
            },
          }),
          ok: [
            '201',
            {
              type: 'object',
              properties: {
                request_id: { type: 'string' },
                status: { type: 'string' },
                notified: { type: 'boolean' },
              },
            },
          ],
        }),
      },
      '/requests/{id}': {
        get: op('Get request status', 'documents:read', {
          params: [req],
          ok: ['200', ref('Request')],
        }),
      },
      '/requests/{id}/events': {
        get: op('List evidence events', 'documents:read', {
          params: [req],
          ok: [
            '200',
            { type: 'object', properties: { data: { type: 'array', items: { type: 'object' } } } },
          ],
        }),
      },
      '/requests/{id}/cancel': {
        post: op('Cancel a request', 'requests:send', {
          params: [req],
          idempotent: true,
          body: json({ type: 'object', properties: { reason: { type: 'string' } } }),
          ok: ['200', ref('Request')],
        }),
      },
      '/requests/{id}/remind': {
        post: op('Remind pending recipients (at most once an hour)', 'requests:send', {
          params: [req],
          idempotent: true,
          ok: ['200', { type: 'object' }],
        }),
      },
      '/requests/{id}/embedded-sessions': {
        post: op('Create an embedded signing link', 'embedded:sign', {
          params: [req],
          idempotent: true,
          body: json({
            type: 'object',
            required: ['recipient_id'],
            properties: { recipient_id: { type: 'string', format: 'uuid' } },
          }),
          ok: [
            '201',
            {
              type: 'object',
              properties: { url: { type: 'string' }, expires_at: { type: 'string' } },
            },
          ],
        }),
      },
      '/requests/{id}/signed-document': {
        get: op('Download the signed PDF', 'files:read', {
          params: [req],
          ok: ['200', 'application/pdf'],
        }),
      },
      '/requests/{id}/certificate': {
        get: op('Download the completion certificate', 'files:read', {
          params: [req],
          ok: ['200', 'application/pdf'],
        }),
      },
      '/credits': {
        get: op('Credit balance', 'billing:read', {
          ok: [
            '200',
            {
              type: 'object',
              properties: { available: { type: 'integer' }, reserved: { type: 'integer' } },
            },
          ],
        }),
      },
      '/usage': {
        get: op('Requests per month', 'billing:read', {
          params: [
            { name: 'months', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 24 } },
          ],
          ok: ['200', { type: 'object' }],
        }),
      },
    },
  };
}
