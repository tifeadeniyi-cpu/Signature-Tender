# Transactional email: Document Successfully Completed

How the completion email is triggered, sent, secured and configured. Code lives in
`packages/core/src/notifications.ts` (queue, links, delivery log) and `apps/web/src/lib/email/`
(design system and templates).

## When it is sent

The email is queued **inside the transaction that marks a signing request completed**
(`finalizeRequest` in `packages/core/src/signing.ts`), right after:

1. every signer, approver and reviewer has finished,
2. the signed PDF and the completion certificate are built, stored and hashed,
3. the source file has passed its integrity check,
4. the `request.completed` evidence event closes the evidence chain.

Because the insert happens in that same transaction, the email exists exactly when a completed request
exists. Nothing is queued while someone still has to sign or approve, or when a request is declined,
cancelled, expired, or fails to finalize (the transaction rolls back). The database enforces this as
well: the insert policy only accepts rows for a request whose status is `completed` with both files
attached.

Who gets it: the sender (links go to the signed-in app) and every recipient who did not decline,
including copy recipients. Each address gets one email per request (unique index on request,
template and address), so repeated completion events cannot send duplicates. If the sender is also a
recipient they get one email.

## How it is sent

- `notifications` table: outbox and delivery log. Rows start `queued`.
- The dispatcher (`dispatchDueNotifications`) claims due rows with `FOR UPDATE SKIP LOCKED`, renders
  them, sends them through Resend with an idempotency key (`notification-<id>-v<linkVersion>`), and
  records `sent` with the provider message id.
- It runs right after the signer's response (`after()` in the sign action), when the sender opens a
  completed document, and on the scheduled sweep `GET /api/cron/notifications` (Vercel Cron,
  `apps/web/vercel.json`).
- Failures: rate limits, timeouts and provider outages are retried with backoff (30 s, 2 min, 10 min,
  30 min, 2 h, 6 h), up to 6 attempts. Permanent errors (for example an invalid address) go straight
  to `failed`. Retries resend the exact same message, so the idempotency key prevents duplicates if a
  send succeeded but the response was lost. Permanent failures log `[ops-alert]` in the server logs.
- Delivery events: `POST /api/resend/webhook` (signature-verified) records `delivered`, `bounced` and
  `failed`. "Delivered" means the receiving mail server accepted the message; it never means the email
  was opened.

The sender sees queued, sent, delivered, bounced and failed entries in the document's **Activity**
tab.

## Secure links

Recipient buttons point to `/retrieve/link/<token>?to=download|view|evidence`.

- The token is an HMAC of the notification id and link version with `EMAIL_LINK_SECRET` (or
  `BETTER_AUTH_SECRET`). Only its SHA-256 is stored. No raw tokens, file URLs or storage addresses
  are ever in the email or the log.
- Following a link never opens the document by itself. The page sends a one-time code to **the address
  the email was sent to** (the visitor never types an address), then opens a 30-minute retrieval
  session. A forwarded email therefore does not give anyone else access.
- Files are streamed through `/api/retrieve/<request>/file`, checked against their recorded SHA-256,
  served `private, no-store`, and every view or download is written to the evidence chain. Row-level
  security only exposes completed files the sender allowed to be downloaded and that were not deleted
  after their retention period.
- Links expire after `notifications.link_valid_days` (app_config, default 30). An expired link offers
  **Request a new secure link**: after the code is verified, the link version goes up (older links stop
  working) and the email is sent again.
- Senders can revoke every emailed link for a request (`revokeNotificationLinks`). Recipients can still
  use **Get your documents** (`/retrieve`), which also requires a code.
- If the sender turned downloads off, the recipient email has no download, view or evidence buttons
  and asks them to contact the sender. Senders can always open their own files.

Recipient pages: `/retrieve/documents/<request>` (PDF viewer with every page, signer progress,
downloads) and `?tab=evidence` (integrity fingerprints, signing events, certificate viewer and
download).

## Template and design system

`apps/web/src/lib/email/`:

- `design.ts`: shared components: header with the approved reversed logo, curved header and footer
  waves, headline, paragraph, primary and secondary buttons, document card, status pill, assurance
  grid, notice box, support block, fine print and footer. Built with tables and inline styles for
  Gmail, Outlook and Apple Mail; 640 px wide; stacks on phones.
- `escape.ts`: every dynamic value is HTML-escaped; links must be https (http only for localhost in
  development and test) and carry no credentials; mailto links only for plain addresses.
- `templates/document-completed.ts`: the completion email (subject, preview text, HTML and a plain-text
  version). Template version `document_completed@1`.
- Images are attached inline (`cid:`) from `assets.generated.ts`, so they show without a public image
  host. Icons and illustrations are drawn in `assets/src/*.svg`; regenerate with
  `node apps/web/scripts/build-email-assets.mjs` (instructions in the script). The logo is the
  approved `public/branding/signature-tender/reversed/signature-tender-reversed.png`, unchanged; the script refuses to run if it differs.

To add another template (invitation, reminder, declined, expired, cancelled, account verification,
password reset, receipt), build it from the same components and add a renderer branch in
`apps/web/src/lib/notifications.ts`. The existing emails were not changed.

## Preview and test sends

`/app/dev/emails` (any signed-in user): every variant (recipient, sender, downloads off, test request)
at desktop and phone widths with fictional data, the plain-text version, and **Send this preview to
me** to check real inbox rendering.

## Configuration

| Variable                                                            | Purpose                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`, `EMAIL_FROM`                                      | Sending                                                                                 |
| `RESEND_WEBHOOK_SECRET`                                             | Verifies delivery events at `/api/resend/webhook`                                       |
| `CRON_SECRET`                                                       | Required by `/api/cron/notifications` (Vercel Cron sends it automatically when set)     |
| `EMAIL_LINK_SECRET`                                                 | Optional; defaults to `BETTER_AUTH_SECRET`. Changing it invalidates links already sent  |
| `EMAIL_TIMEZONE`                                                    | Time zone for dates in emails until users can set their own (default `America/Chicago`) |
| `SUPPORT_EMAIL`, `SUPPORT_URL`                                      | Support contact; falls back to the `support.email` config value                         |
| `PRIVACY_URL`, `TERMS_URL`                                          | Default to the app's `/legal/privacy` and `/legal/terms`                                |
| `COMPANY_NAME`                                                      | Footer (default `Signature Tender`)                                                     |
| `SOCIAL_YOUTUBE_URL`, `SOCIAL_INSTAGRAM_URL`, `SOCIAL_LINKEDIN_URL` | Footer links, shown only when set                                                       |

The Vercel cron in `vercel.json` runs once a day so it works on every plan. On Vercel Pro, change the
schedule to every 5 or 10 minutes for faster retries.

## Tests

- `packages/core/test/notifications.test.ts` (real Postgres, row-level security on): nothing queued
  while a signature is outstanding, or for declined, cancelled or failed finalization; one email per
  sender and recipient with correct data; no duplicates on repeated completion; no tokens in the log;
  per-recipient links; verified retrieval with view and download events recorded; forwarded email and
  other recipients refused; expired links need re-verification and renewal invalidates the old link;
  revocation; transient retries reuse the idempotency key; permanent failures; max attempts; delivery
  and bounce events; parallel dispatchers never double-send.
- `apps/web/src/lib/email/templates/document-completed.test.ts`: subject and preview text, real
  details and time zone, omitted fields, accurate wording, HTML escaping and unsafe links, downloads
  off, missing certificate, support and social links, test marking, email-client structure, inline
  images and size.
- `apps/web/e2e/completion-email.spec.ts`: a real test signing; the recipient and sender each receive
  the email; a forwarded link is blocked; the recipient verifies, views every page, downloads the
  signed PDF, opens the evidence certificate; the sender sees it all in Activity; the preview page.

Rendering in the actual Gmail, Outlook and Apple Mail apps cannot be automated here. Use
**Send this preview to me** from each client, or a service such as Litmus or Email on Acid.
