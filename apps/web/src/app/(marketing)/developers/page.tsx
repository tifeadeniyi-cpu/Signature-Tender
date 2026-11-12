import Link from 'next/link';
import type { ReactNode } from 'react';
import { API_SCOPES, WEBHOOK_EVENTS } from '@st/core';

export const metadata = {
  title: 'API documentation',
  description: 'Send documents for signature from your own software with the Signature Tender API.',
};

function Code({ children }: { children: string }) {
  return (
    <pre
      tabIndex={0}
      className="overflow-x-auto rounded-xl bg-heading p-4 text-xs leading-relaxed text-white"
    >
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border pt-8">
      <h2 className="mb-3 font-display text-2xl">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

const ENDPOINTS: [string, string, string, string][] = [
  [
    'POST',
    '/documents',
    'documents:write',
    'Upload a PDF (multipart). Optional external_source and external_id link it to your record.',
  ],
  [
    'GET',
    '/documents',
    'documents:read',
    'Recent documents, or ?external_source=&external_id= to find yours.',
  ],
  ['GET', '/documents/{id}', 'documents:read', 'Document, recipients, fields and requests.'],
  ['PUT', '/documents/{id}/recipients', 'documents:write', 'Replace recipients and signing order.'],
  [
    'PUT',
    '/documents/{id}/fields',
    'documents:write',
    'Replace fields (positions are fractions of the page).',
  ],
  [
    'PUT',
    '/documents/{id}/settings',
    'documents:write',
    'Expiry, reminders, download permission, signer codes, email message.',
  ],
  ['PUT', '/documents/{id}/external', 'documents:write', 'Link to your record.'],
  [
    'POST',
    '/documents/{id}/preparation-session',
    'documents:write',
    'Link to the field editor; the user signs in as a workspace member.',
  ],
  [
    'POST',
    '/documents/{id}/send',
    'requests:send',
    'Send as a test or for real. Returns the request id.',
  ],
  ['GET', '/requests/{id}', 'documents:read', 'Status of the request and each recipient.'],
  ['GET', '/requests/{id}/events', 'documents:read', 'Evidence log with hashes.'],
  ['POST', '/requests/{id}/cancel', 'requests:send', 'Cancel an open request.'],
  [
    'POST',
    '/requests/{id}/remind',
    'requests:send',
    'Email fresh links to pending recipients, at most once an hour.',
  ],
  [
    'POST',
    '/requests/{id}/embedded-sessions',
    'embedded:sign',
    'Short-lived signing link for one recipient.',
  ],
  ['GET', '/requests/{id}/signed-document', 'files:read', 'Signed PDF of a completed request.'],
  ['GET', '/requests/{id}/certificate', 'files:read', 'Completion certificate PDF.'],
  ['GET', '/credits', 'billing:read', 'Credit balance.'],
  ['GET', '/usage', 'billing:read', 'Requests per month.'],
];

export default function DevelopersDocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-4xl">API documentation</h1>
      <p className="mt-3 text-sm">
        Send documents for signature from your own software, and get status updates back by webhook.
        Signature Tender keeps the signing record and its evidence; store the ids we return and
        fetch the signed PDF when you need it. The machine-readable description is at{' '}
        <a href="/api/v1/openapi.json" className="font-semibold text-primary underline">
          /api/v1/openapi.json
        </a>{' '}
        (OpenAPI 3.1).
      </p>
      <nav
        aria-label="On this page"
        className="my-8 rounded-xl border border-border bg-white p-4 text-sm"
      >
        <ul className="grid gap-1 sm:grid-cols-2">
          {[
            ['auth', 'Authentication and scopes'],
            ['quickstart', 'Quick start'],
            ['endpoints', 'Endpoints'],
            ['errors', 'Errors, limits and retries'],
            ['webhooks', 'Webhooks'],
            ['embedded', 'Embedded signing'],
            ['partners', 'Beam Artist and Jectstack'],
          ].map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-primary hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-10">
        <Section id="auth" title="Authentication and scopes">
          <p>
            Create a key in{' '}
            <Link href="/app/settings/developers" className="font-semibold text-primary underline">
              Settings, Developers
            </Link>
            . It is shown once; we keep only a hash. Send it on every request:
          </p>
          <Code>{'Authorization: Bearer stk_…'}</Code>
          <p>
            A key acts as the member who created it, limited to its scopes and to its workspace. If
            that member leaves the workspace or loses permission, the key stops working. Rotating a
            key issues a new one and keeps the old one working for 24 hours.
          </p>
          <ul className="list-disc pl-5">
            {Object.entries(API_SCOPES).map(([k, v]) => (
              <li key={k}>
                <code className="font-mono text-xs">{k}</code>: {v}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="quickstart" title="Quick start">
          <p>Upload, add a signer, place a signature field, and send a test request:</p>
          <Code>{`BASE=https://signaturetender.com/api/v1
KEY=stk_...

# 1. Upload
curl -s $BASE/documents -H "Authorization: Bearer $KEY" \\
  -F file=@agreement.pdf -F title="Booking agreement" \\
  -F external_source=beam_artist -F external_id=booking-42

# 2. Recipients (use the document id from step 1)
curl -s -X PUT $BASE/documents/$DOC/recipients -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"recipients":[{"name":"Ann Lee","email":"ann@example.com","role":"signer"}]}'

# 3. Fields (use the recipient id from step 2)
curl -s -X PUT $BASE/documents/$DOC/fields -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"fields":[{"recipient_id":"'$RID'","type":"signature","page":1,"x":0.1,"y":0.8,"width":0.3,"height":0.06}]}'

# 4. Send (test mode is free and clearly marked as a test where test signing is enabled)
curl -s -X POST $BASE/documents/$DOC/send -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" -H "Idempotency-Key: send-booking-42" \\
  -d '{"mode":"test"}'`}</Code>
          <p>
            Live sends must include{' '}
            <code className="font-mono text-xs">{'"acknowledge_specialized_documents": true'}</code>
            . It confirms the document is not one that needs extra formalities (for example a will,
            a notarized deed or a court filing), and it is recorded in the evidence log.
          </p>
          <p>
            A <code className="font-mono text-xs">live</code> send uses one credit. If the workspace
            has none, the request waits with status{' '}
            <code className="font-mono text-xs">awaiting_payment</code> until a member pays in the
            app. Live sending is only possible once production signing is enabled.
          </p>
        </Section>

        <Section id="endpoints" title="Endpoints">
          <p>
            All paths are relative to <code className="font-mono text-xs">/api/v1</code>. Bodies are
            JSON unless noted.
          </p>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Endpoints">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-2">Method</th>
                  <th className="py-2 pr-2">Path</th>
                  <th className="py-2 pr-2">Scope</th>
                  <th className="py-2">What it does</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ENDPOINTS.map(([m, p, s, d]) => (
                  <tr key={m + p}>
                    <td className="py-2 pr-2 font-mono font-semibold">{m}</td>
                    <td className="py-2 pr-2 font-mono">{p}</td>
                    <td className="py-2 pr-2 font-mono">{s}</td>
                    <td className="py-2">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="errors" title="Errors, limits and retries">
          <p>Errors use one shape, with a request id to quote to support:</p>
          <Code>
            {
              '{ "error": { "code": "invalid", "message": "recipients.0.email: Enter a valid email", "request_id": "…" } }'
            }
          </Code>
          <ul className="list-disc pl-5">
            <li>
              401 unauthenticated, 403 forbidden (role or scope), 404 not_found, 409 conflict, 413
              payload_too_large, 422 invalid, 429 rate_limited, 503 unavailable.
            </li>
            <li>
              Each key has a per-minute limit (see the X-RateLimit-Limit header). On 429, wait for
              the Retry-After seconds.
            </li>
            <li>
              Send an <code className="font-mono text-xs">Idempotency-Key</code> header on POST and
              PUT. Repeating the same request with the same key within 24 hours returns the first
              response (marked Idempotent-Replayed) instead of acting twice. Reusing a key with a
              different body is refused.
            </li>
            <li>
              JSON bodies and PDF uploads have size limits; uploads follow the same PDF limits as
              the app.
            </li>
          </ul>
        </Section>

        <Section id="webhooks" title="Webhooks">
          <p>
            Add an endpoint in Settings, Developers. We POST JSON like this, with ids and status
            only (never document contents):
          </p>
          <Code>{`{
  "id": "evt id (also in the Signature-Tender-Event-Id header)",
  "type": "recipient.signed",
  "created_at": "2026-11-12T10:00:00.000Z",
  "workspace_id": "…",
  "data": { "request_id": "…", "document_id": "…", "status": "in_progress", "test": false,
            "external_source": "beam_artist", "external_id": "booking-42",
            "recipient_id": "…", "recipient_email": "ann@example.com", "recipient_role": "signer" }
}`}</Code>
          <p>
            Verify every delivery. The{' '}
            <code className="font-mono text-xs">Signature-Tender-Signature</code> header is{' '}
            <code className="font-mono text-xs">t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>, where
            v1 is the HMAC-SHA256 of{' '}
            <code className="font-mono text-xs">t + &quot;.&quot; + raw body</code> with your
            endpoint secret. Reject timestamps more than five minutes old, and ignore event ids you
            have already processed: deliveries can repeat. During a secret rotation there are two v1
            values for 24 hours; accept either.
          </p>
          <Code>{`import crypto from 'node:crypto';

function verify(secret, header, rawBody) {
  const parts = Object.groupBy(header.split(','), (p) => p.split('=')[0]);
  const t = Number(parts.t?.[0].split('=')[1]);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest();
  return (parts.v1 ?? []).some((p) => {
    const got = Buffer.from(p.split('=')[1], 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  });
}`}</Code>
          <p>
            Respond with any 2xx within 10 seconds. Anything else (including redirects, which are
            not followed) is retried with increasing delays from 30 seconds up to several hours, up
            to a set number of attempts, then marked failed. You can retry it from the delivery log.
            Endpoints must be public HTTPS addresses.
          </p>
          <p>Event types:</p>
          <ul className="grid list-disc gap-x-6 pl-5 sm:grid-cols-2">
            {WEBHOOK_EVENTS.map((e) => (
              <li key={e}>
                <code className="font-mono text-xs">{e}</code>
              </li>
            ))}
            <li>
              <code className="font-mono text-xs">webhook.test</code>
            </li>
          </ul>
          <p>
            Not sent yet: <code className="font-mono text-xs">request.delivery_failed</code>. Email
            bounces are not tracked yet, so we do not claim to know about them.
          </p>
        </Section>

        <Section id="embedded" title="Embedded signing">
          <p>
            Send with <code className="font-mono text-xs">{'"notify": false'}</code> if your app
            will show signing itself, then ask for a link for the recipient whose turn it is:
          </p>
          <Code>{`curl -s -X POST $BASE/requests/$REQ/embedded-sessions -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" -d '{"recipient_id":"'$RID'"}'
# => { "url": "https://signaturetender.com/sign/…", "expires_at": "…" }`}</Code>
          <p>
            Open the URL with a redirect or in a new window right away; it expires in minutes and
            replaces any earlier link for that recipient. The signing page cannot be shown inside a
            frame, so recipients always see the Signature Tender address and its security
            indicators. Only give the link to the recipient it was made for. Watch for{' '}
            <code className="font-mono text-xs">recipient.signed</code> and{' '}
            <code className="font-mono text-xs">request.completed</code> webhooks.
          </p>
        </Section>

        <Section id="partners" title="Beam Artist and Jectstack">
          <p>
            Connect them from the{' '}
            <Link href="/app/integrations" className="font-semibold text-primary underline">
              Integrations
            </Link>{' '}
            page. Connecting creates an API key with the scopes the partner needs (no billing
            access) and, if you give its webhook URL, an endpoint for status updates. Paste both
            into the partner app. Disconnecting revokes the key and removes the endpoint at once.
          </p>
          <p>
            Partners should set <code className="font-mono text-xs">external_source</code> to{' '}
            <code className="font-mono text-xs">beam_artist</code> or{' '}
            <code className="font-mono text-xs">jectstack</code> and{' '}
            <code className="font-mono text-xs">external_id</code> to their record id, so webhooks
            carry the reference back.
          </p>
        </Section>
      </div>
    </div>
  );
}
