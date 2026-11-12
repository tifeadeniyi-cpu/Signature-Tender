# Progress

Last updated: 2026-11-11. Status key: **Done**, **Partial**, **Blocked**, **Not started**.

## Phase 0: Discovery and architecture: Done

Architecture and phased plan approved in the project's planning doc. Summary in [architecture.md](architecture.md).

## Phase 1: Brand and application foundation: Done (merged in PR #1)

| Feature                                                            | Status      | Notes                                                                                                         |
| ------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------- |
| Monorepo, TypeScript strict, ESLint, CI                            | Done        | pnpm workspaces; GitHub Actions runs typecheck, lint, unit, build, e2e                                        |
| Design tokens (Part 4.3), DM Serif Display + Inter                 | Done        | Tailwind v4 theme in `apps/web/src/app/globals.css`                                                           |
| Approved logos                                                     | Done        | Used unchanged; reversed logo has a baked-in background, so it renders as a rounded tile                      |
| App shell: burgundy sidebar, 8 nav items, top bar, mobile drawer   | Done        | Global search and notifications are omitted until there is content to search/notify (Phases 3 and 5)          |
| Authentication: email/password, email verification, password reset | Done        | Better Auth; 12-character minimum; breached-password check enabled in staging/production                      |
| MFA (TOTP + backup codes), passkeys, session list and revoke       | Done        | Passkey flow not covered by automated tests (needs WebAuthn virtual authenticator)                            |
| Login rate limiting                                                | Done        | Database-backed; disabled only in `APP_ENV=test`                                                              |
| Workspaces, onboarding, workspace switcher                         | Done        | Switcher re-verifies membership server-side                                                                   |
| Roles and permissions                                              | Done        | 6 system roles, 17 permissions; enforced in services and Postgres RLS                                         |
| Profile page, workspace settings                                   | Done        | Saved to database with audit events                                                                           |
| Core schema + RLS                                                  | Done        | identity, workspaces, memberships, roles, permissions, audit_events, feature_flags, app_config, plans, prices |
| Homepage and pricing page                                          | Done        | Prices and savings read from the database, never hardcoded                                                    |
| Legal pages                                                        | Blocked     | Placeholders only; waiting on attorney-drafted Terms, Privacy and E-Sign disclosure                           |
| Dashboard                                                          | Partial     | Layout per mockup; counts are real zeros until documents exist; quick actions shown as "Coming soon"          |
| Sections: Templates, Contacts, Team, Billing, Integrations         | Not started | Honest "being built" pages with their phase number, no sample data                                            |

### Tests

- `packages/core`: 19 tests (unit + tenant isolation against real Postgres as the non-superuser app role): cross-tenant reads, IDOR, direct SQL updates, self-joining a workspace, no-actor access, append-only audit log, private profiles.
- `apps/web`: 2 unit tests, 5 Playwright tests (unauthenticated redirect, homepage pricing and claim check, full signup → verify → workspace → settings → sign out → sign in, phone-width overflow on marketing pages).

### Known gaps and defects

- The `user` table has no RLS (auth needs global lookups). Tenant queries must not join it directly; a restricted member-directory view is planned for Phase 6.
- Email change is not supported yet (field is read-only).
- Feature flags and pricing can only be changed with the database owner role; an admin UI comes with the admin console.
- `st_app` role must be created with a password in each hosted database (Neon) before deploy.

## Phase 2: Documents and preparation: Done (merged in PR #2)

| Feature                                            | Status      | Notes                                                                                                                                                            |
| -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema: documents, files, recipients, fields + RLS | Done        | Migrations `0002`/`0003`. Viewers read only; editors see their own documents unless they have `documents.view_all`. No hard deletes are granted to the app role. |
| PDF upload                                         | Done        | Checks file signature, size and page limits (from `app_config`), rejects damaged and password-protected PDFs, stores SHA-256                                     |
| Private storage                                    | Done        | Local disk for dev/test (refused in staging/production); S3-compatible driver for Cloudflare R2. Objects are never overwritten.                                  |
| Authorized file route                              | Done        | `/api/documents/[id]/file`: RLS-checked, re-verifies SHA-256, `no-store`, every view audited                                                                     |
| PDF preview                                        | Done        | pdf.js in the browser, worker served from our own origin                                                                                                         |
| Wizard step 1: details                             | Done        | Name and type; file facts shown                                                                                                                                  |
| Wizard step 2: signers                             | Done        | Roles (sign, approve, review, copy, view), signing order with reorder, duplicate email warning, signer limit from `app_config`                                   |
| Wizard step 3: fields                              | Done        | 10 field types, recipient colors with names, click to place, drag to move, resize handle, arrow-key nudge, options for dropdown/radio                            |
| Wizard step 4: settings                            | Done        | Signing method, download/print, emailed code, reminders, expiration, message                                                                                     |
| Wizard step 5: review                              | Done        | Readiness check links back to each problem; "Mark ready to send". **Send stays disabled** while `production_signing` and `payments` flags are off.               |
| Documents list                                     | Done        | Draft and ready documents, real data only                                                                                                                        |
| Delete draft                                       | Done        | Soft delete with audit event                                                                                                                                     |
| Templates from documents                           | Not started | Phase 6                                                                                                                                                          |

### Tests

- `packages/core`: 34 tests (15 new for documents): upload validation, outsider/editor/viewer access, recipient and field validation, readiness, field cleanup on role change, tampered-file detection, soft delete.
- `apps/web`: 7 Playwright tests, including the full wizard (bad file types, duplicate emails, field placement and keyboard nudge, settings, review, mark ready, file headers) and a second workspace getting 404 on another workspace's file and page, plus 401 when signed out.

### Known gaps

- Field placement on touch screens works for tapping and dragging but has not been tested on real devices.
- Uploads are read into memory (25 MB cap). Direct-to-R2 uploads with presigned URLs can replace this if larger files are needed.
- No virus scanning yet; planned with the worker in Phase 3.
- R2 bucket and keys must be created and set as `S3_*` env vars before staging.

## Phase 3: Signing and evidence: Done (merged in PR #3)

Real sending stays off. The `test_signing` flag allows free requests marked TEST in development and test environments only. `production_signing` and `payments` remain off.

| Feature                                          | Status      | Notes                                                                                                                                                                |
| ------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signing requests and state machine               | Done        | Request states from Part 30; one open request per document; recipients and fields snapshotted on send                                                                |
| Secure invitations                               | Done        | Hashed 256-bit link tokens, expiry, rotation, cancel. Sequential order notifies one group at a time                                                                  |
| Recipient authentication                         | Done        | Optional one-time email code (expiry, single use, attempt and send limits); per-link browser session                                                                 |
| Electronic consent                               | Done        | Disclosure text and version from `app_config` (currently a **draft pending attorney review**); consent recorded with a hash of the text                              |
| Typed, drawn and uploaded signatures; initials   | Done        | Explicit "Adopt and use"; adopted marks reusable within the session; uploads converted to PNG and stripped of metadata                                               |
| Signing workspace                                | Done        | Mobile-first, required-field counter, next required field, intent confirmation, decline with reason                                                                  |
| Completion                                       | Done        | Atomic, refuses duplicates, re-verifies the source hash, records IP/browser/intent                                                                                   |
| Finalization                                     | Done        | Signed copy stamped with values and signatures (TEST footer for test requests) plus a completion certificate; failures show as "Needs attention", never as completed |
| Evidence log and integrity check                 | Done        | Hash-chained, append-only events; "Verify integrity" re-hashes files and the chain                                                                                   |
| Sender status page                               | Done        | Recipient progress, history, downloads, cancel, retry finalization, edit and resend after decline/expiry/cancel                                                      |
| Emails                                           | Done        | Invitation, code, completion (recipients and sender), decline notice to sender                                                                                       |
| Reviewer and approver roles                      | Done        | They confirm with intent but have no signature fields; viewers and copy recipients get the completed copy                                                            |
| Certificate-backed PDF digital signatures (12.7) | Not started | Needs a managed key provider; kept separate                                                                                                                          |
| Signature stamps (12.6), request correction      | Not started | Phase 6                                                                                                                                                              |
| Reminders                                        | Not started | Settings are stored; scheduled sending needs the worker (Phase 5)                                                                                                    |

### Tests

- `packages/core`: 47 tests (13 new for signing): PNG sanitizing, send refusals, sequential flow, email code limits and reuse, consent version, signer RLS scope, field validation, double completion, finalization, completed-copy downloads, file and evidence tamper detection, decline, cancel, expiry.
- `apps/web`: 9 Playwright tests, including a full send → email code → consent → adopt → sign → download flow, and decline.

### Known gaps

- Field coordinates assume unrotated pages. Rotated PDFs need a rotation-aware stamp before production.
- Finalization runs in the request that completes the last signature. A background worker with retries is planned.
- The e-sign disclosure, certificate wording and excluded-document guidance need attorney review (release checklist).

## Phase 4: Payments and credits: Done (merged in PR #4)

Stripe runs in **test mode only**: live keys are refused and live events ignored. The `payments` flag stays off until Stripe test keys are set and reviewed, and real sending also still needs `production_signing`, which stays off until the release gates pass.

| Feature                                | Status      | Notes                                                                                                                                                                     |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prices and plans from the database     | Done        | Single $2.99 and 5/10/25/100 packs; Starter, Business, Team, Enterprise (contact). Checkout uses inline Stripe prices built from these rows, so no code change to reprice |
| Credit ledger                          | Done        | Append-only, idempotency keys, per-workspace lock. Holds per request: reserved, consumed, restored. Allowance spent before purchased credits                              |
| Stripe Checkout: packs and one request | Done        | Pending payment fixed before checkout; webhook verifies signature, amount and currency; receipts via Stripe invoices                                                      |
| Request payment states                 | Done        | Live send with no credit → awaiting payment (nobody emailed) → payment processing → sent as the original sender once Stripe confirms. "Use a credit and send" too         |
| Subscriptions                          | Done        | Subscribe through Checkout; change plan (upgrade prorated now, downgrade from next bill); cancel, reactivate, payment method and invoices through the Stripe portal       |
| Monthly allowance                      | Done        | Granted per paid period invoice, expires at the next period or when the plan ends; upgrades top up                                                                        |
| Refunds and disputes                   | Done        | Unused credits from that purchase are reversed, never below zero                                                                                                          |
| Cancellation policy                    | Done        | `billing.cancel_credit_policy` in `app_config`: default restores the credit if no recipient opened the request                                                            |
| Billing & Credits page                 | Done        | Overview, Plans & Pricing, Credits, Invoices (search, status, date filters), Payment History with credit activity and reconciliation, Usage                               |
| Tax                                    | Not started | Stripe Tax is not enabled; prices are charged as listed in USD. Needs a decision on tax registration before launch                                                        |
| Promotional and admin credit grants    | Not started | Ledger supports them; the admin console arrives in Phase 8                                                                                                                |

### Tests

- `packages/core`: 15 new billing tests: live send gating, awaiting payment, database pricing, permission checks, idempotent grants, amount and currency mismatch, unpaid sessions, racing sends, pay-then-dispatch, expired checkout, cancellation policy, subscription allowance cycle with upgrade and expiry, refunds, disputes, RLS rules, event replay.
- `apps/web`: Stripe event mapping unit tests; Playwright: pay for one request through a local Stripe stand-in that sends signed webhooks, buy a 5-credit pack, history and reconciliation; forged webhook rejected.

### Known gaps

- Stripe's API is not reachable from the build container, so nothing has run against real Stripe test mode yet. That needs your test keys (see `.env.example`).
- Refunds of subscription invoices are recorded by Stripe but not mapped back to a payment row yet.
- If a credit reserved from a monthly allowance is restored after that period ends, it returns to the allowance and expires at the next cycle.

## Phase 5: Documents, retrieval and retention: Done (pending review)

| Feature                                  | Status      | Notes                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documents list                           | Done        | Summary cards; tabs (All, In progress, Completed, Pending, Expired, Drafts, Declined, Cancelled, Archived); search by title, signer name or email, or reference; filters for type, owner and sent/completed dates; sortable columns; 25 per page                                                                                              |
| Row actions                              | Done        | View, download signed copy, archive and unarchive (open requests must be finished or cancelled first)                                                                                                                                                                                                                                         |
| View Document                            | Done        | Tabs for Overview (preview on demand), Signers, Activity and Versions; completed downloads; retention and legal hold panel                                                                                                                                                                                                                    |
| Version history                          | Done        | Original, signed copy and certificate with fingerprints; each download is checked against its hash and logged                                                                                                                                                                                                                                 |
| Check a copy                             | Done        | Drop a PDF to compare its SHA-256 with the stored versions; the file never leaves the browser                                                                                                                                                                                                                                                 |
| Activity                                 | Done        | Evidence log and audit log merged: views, downloads, archive, legal hold, link reissue, guest downloads                                                                                                                                                                                                                                       |
| Guest retrieval (`/retrieve`)            | Done        | Recipients enter their email, get a 6-digit code (10 minutes, 5 tries), and see only requests sent to that address for 30 minutes. Download completed copies the sender allowed, or get a new signing link (the old one stops working). Same answer whether or not an address has documents. Limits: 5 codes per email and 30 per IP per hour |
| Recently deleted                         | Done        | Deleted drafts can be restored for 30 days (`retention.deleted_draft_days`)                                                                                                                                                                                                                                                                   |
| Retention settings                       | Done        | Workspace default and per-type periods (Settings > Retention), minimum from `retention.min_days`. Platform default 2555 days is a placeholder pending legal review                                                                                                                                                                            |
| Legal hold                               | Done        | Owners and admins, reason required; blocks deletion                                                                                                                                                                                                                                                                                           |
| Retention deletion                       | Partial     | Service exists and is tested, but it is behind the `retention_deletion` flag (off) and there is no scheduled sweep yet                                                                                                                                                                                                                        |
| Recovery process                         | Documented  | `docs/operations/recovery.md`: proposed RPO/RTO and restore steps. Not rehearsed                                                                                                                                                                                                                                                              |
| Card view, column chooser, saved filters | Not started | List view only for now                                                                                                                                                                                                                                                                                                                        |
| Guest-sender retrieval                   | Not started | Waits for guest sending                                                                                                                                                                                                                                                                                                                       |

### Tests

- `packages/core`: 13 new tests: tab buckets and counts, search and permissions, archive rules, deleted draft restore window, versions and activity, retention policy limits, legal hold, purge gating, retrieval without enumeration, attempt and rate limits, address scoping, downloads, link reissue.
- `apps/web`: Playwright: a recipient loses the email, verifies at `/retrieve`, gets a new link (the old one stops working), signs, downloads the copy and certificate; the sender sees it in Activity and checks a copy in Versions. Library search, filters, archive and unarchive, retention minimum.

### Known gaps

- Opening the preview or downloading creates an audit row each time, which can make Activity long. Grouping repeated views is a later improvement.
- The retrieval code email goes to whoever controls the inbox, which is the same trust the signing link already relies on.
- The Neon owner role must be able to bypass RLS for the retrieval helper functions (same assumption as Phase 3).

## Phase 6: Team, contacts, templates and branding: Done (pending review)

| Feature                   | Status      | Notes                                                                                                                                                                                                                            |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team page                 | Done        | Tabs for All, Internal, External, Pending, Roles and Groups; summary cards; change role, access type and groups; suspend, reactivate, remove                                                                                     |
| Invitations               | Done        | Email invitation with role, group, access type and expiry (1 to 30 days). Resend (once a minute, new link), cancel. Accepting needs a verified account with the invited email; sign-up and sign-in return to the invitation      |
| Roles and permissions     | Done        | System roles plus Billing Administrator and API Developer. Custom roles per workspace, limited to permissions the editor holds. The last owner cannot be removed or demoted                                                      |
| Groups                    | Done        | Create, delete, assign members                                                                                                                                                                                                   |
| Contacts                  | Done        | Shared or private; search, type and tag filters; Active and Archived; detail page with document history; merge; CSV import (skips existing addresses) and export; last used updates when a document is sent                      |
| Templates                 | Done        | Create from a PDF, categories (custom ones too), roles with signing order, fields (same editor as documents), settings without a fixed expiry, publish with checks, version history, discard changes, duplicate, archive, delete |
| Use template              | Done        | Fill names and emails for each role (contact suggestions); creates a draft document from the published version and opens Review. Nothing is sent until the sender sends                                                          |
| Branding                  | Done        | Display name, accent colour (must reach 4.5:1 contrast with white) and PNG/JPEG logo. Shown in signing emails and as a strip on signing pages under the Signature Tender header                                                  |
| Team invitation branding  | Not started | Member invitation emails use the standard Signature Tender look                                                                                                                                                                  |
| Template sharing by group | Not started | A template is shared with the whole workspace or kept to its owner                                                                                                                                                               |

### Tests

- `packages/core`: 12 new tests: invitations and acceptance, role escalation limits, last owner, custom roles, groups, contacts visibility, import and export, merge, template versions and freezing, publish checks, creating a document from a template, branding contrast and logo checks.
- `apps/web`: Playwright: invite a teammate who signs up from the link and joins; contacts add, import, search and export; build, publish and use a template; branding contrast check.

### Known gaps

- Member listings still read the `user` table directly; a restricted view is still planned.
- Logos are served publicly by workspace id so recipients can see them. They are not secret, but anyone with the id can fetch the logo.

## Phase 7: API and integrations: Done (pending review)

| Feature                    | Status      | Notes                                                                                                                                                                                                    |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API keys                   | Done        | Settings, Developers. Shown once, stored as SHA-256 only. Scopes, optional expiry, revoke, rotate (old key works 24 hours). A key acts as its creating member, inside its own workspace only             |
| REST API `/api/v1`         | Done        | Upload, recipients, fields, settings, partner reference, send (test or live), status, evidence events, cancel, remind, embedded signing link, signed PDF, certificate, credits, usage                    |
| API safeguards             | Done        | Per-key rate limit, JSON and upload size limits, `Idempotency-Key` replay for 24 hours, one JSON error shape with request id, `public_api` flag (off in production until the owner turns it on)          |
| Webhooks                   | Done        | Events written by database triggers into an outbox; HMAC-SHA256 signed with timestamp; retries with backoff then marked failed; delivery log with manual retry; test event; secret rotation with overlap |
| Embedded signing           | Done        | Short-lived signing link for the recipient whose turn it is; replaces the emailed link. Opened by redirect or new window (framing stays blocked)                                                         |
| Embedded preparation       | Partial     | Returns a link to the field editor; the person must sign in as a workspace member                                                                                                                        |
| Integrations page          | Done        | Metrics, Beam Artist and Jectstack as working API connections (key plus optional webhook), the rest listed as "Not available yet"                                                                        |
| Developer docs and OpenAPI | Done        | `/developers` guide and `/api/v1/openapi.json`                                                                                                                                                           |
| `request.delivery_failed`  | Not started | Needs email bounce tracking                                                                                                                                                                              |
| Storage and app connectors | Not started | Google, Microsoft, Dropbox, Box, Slack, Salesforce, Jira, and customer Stripe accounts need OAuth apps and are not built                                                                                 |

### Tests

- `packages/core`: 19 new tests: key hashing, scopes, revocation, suspended creators, rotation, rate limit, idempotency states, workspace boundary for multi-workspace members, partner references, status and events, trigger-emitted events, embedded sessions replacing links, reminder throttle and permission, encryption, SSRF checks, signature verification and replay window, delivery, backoff, manual retry, rotation overlap, redirects not followed, partner connect and disconnect.
- `apps/web`: Playwright: create a key and webhook in the UI, upload and send through the API, idempotent replay, missing scope refused, signed webhook received; Integrations page offers only working connectors. Accessibility scan covers the new pages.

### Known gaps

- Webhooks are sent right after the action that caused them, plus a daily Vercel Cron sweep (Hobby plans allow one run a day). On a Pro plan, change `apps/web/vercel.json` to every minute so retries run on schedule.
- The destination address is checked before each delivery, but the HTTP client resolves DNS again, so a fast DNS rebinding could still reach a private address. An egress proxy would close this.
- Production needs `CRON_SECRET` and a dedicated `WEBHOOK_SECRETS_KEY` in Vercel.

## Transactional email: Document Successfully Completed: Done (pending review)

Built on Phase 5's verified-email retrieval. Details in [email-notifications.md](email-notifications.md).

| Feature                                  | Status | Notes                                                                                                                                                                                                                             |
| ---------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion email (approved design)       | Done   | Burgundy header with the approved reversed logo, curved waves, completion illustration, buttons, document card, assurances, support, footer                                                                                       |
| Reusable email design system             | Done   | `apps/web/src/lib/email/design.ts`; table-based, 640 px, phone layout, inline images, escaping and URL checks                                                                                                                     |
| Trigger                                  | Done   | Queued in the finalization transaction only after files are stored, hashed and the evidence chain is closed; enforced by an insert policy                                                                                         |
| Durable queue, retries, idempotency      | Done   | `notifications` outbox; SKIP LOCKED claims; backoff up to 6 attempts; Resend idempotency keys; scheduled sweep                                                                                                                    |
| Secure links                             | Done   | Hashed HMAC tokens; one-time code to the original address on every new browser; expiry with renewal; sender revocation                                                                                                            |
| Recipient document and evidence pages    | Done   | `/retrieve/documents/<id>`: every page, signer progress, downloads; Evidence tab with fingerprints, events and certificate                                                                                                        |
| Delivery log and Activity                | Done   | Queued, sent, delivered, bounced, failed; provider message id; Resend webhook                                                                                                                                                     |
| Preview and test sends                   | Done   | `/app/dev/emails`                                                                                                                                                                                                                 |
| Other templates on the new design system | Done   | Invitation, reminder, completed-copy link, signing and access codes, declined notice, team invitation, email verification and password reset share the design, each with its own illustration; all previewable at /app/dev/emails |

### Tests

- `packages/core`: 14 new notification tests, against real Postgres with row-level security.
- `apps/web`: 12 template unit tests; Playwright: full completion flow and the preview page.

### Known gaps

- Recipients have no time zone setting yet: dates use `EMAIL_TIMEZONE`, with the zone shown.
- The daily cron is the slowest retry path; on Vercel Pro shorten the schedule.
- Real-client rendering (Gmail, Outlook, Apple Mail) is checked by sending previews, not automated.
- No expired, cancelled or payment-receipt email exists yet (Stripe sends payment receipts). Workspace accent colours are no longer applied to emails; the workspace brand name still shows as the sender.
- The completed-copy signing links issued at finalization are no longer emailed (the completion email replaces that message); they still work for anyone who already has one.

## Phase 8: Connectors, analytics and reporting: Done (pending review)

| Item                       | Status      | Notes                                                                                                                                                                                                                               |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                  | Done        | Live counts that link to the library, recent documents with tabs, quick actions, available credits and requests sent this month. Bulk Send is labelled "Not available yet"                                                          |
| Reports                    | Done        | `/app/reports`: date range, tests on or off, sent, completed, completion rate, median and average time to complete, by month, by type, by sender, status breakdown                                                                  |
| Report access              | Done        | Runs under RLS: members who see only their own documents get their own numbers. Credits need billing access; API and webhook numbers need developer access                                                                          |
| CSV export                 | Done        | Same numbers as the page; cells escaped against spreadsheet formulas                                                                                                                                                                |
| API usage                  | Done        | Calls and errors per key per day, shown in reports                                                                                                                                                                                  |
| Slack connector            | Done        | Incoming webhook URL only (`hooks.slack.com`). Posts document title, event and a link; never contents or recipient emails. A hello message confirms it on connect                                                                   |
| Staff admin `/admin`       | Done        | Separate from workspaces. Overview metrics and revenue, workspace search, operations queues (finishing failures, webhook failures, payment issues, stuck Stripe events), read-only flags. Every view audited. 404 for everyone else |
| Storage and CRM connectors | Not started | Google, Microsoft, Dropbox, Box, Salesforce, Jira and customer Stripe accounts need OAuth apps registered by the owner                                                                                                              |
| Support and bounce metrics | Not started | No support desk or bounce tracking exists yet; the admin overview says so                                                                                                                                                           |

### Tests

- `packages/core`: report counts and RLS scoping, CSV formula escaping, range limits, API usage counting, Slack URL validation, message content, connect, dispatch and disconnect, staff-only admin functions, app role cannot grant itself staff, staff views audited. 116 tests in total.
- `apps/web`: Playwright: dashboard and reports load, CSV downloads; `/admin` is 404 for a customer and opens once granted; Slack rejects non-Slack URLs. Accessibility scan covers `/app/reports`.

### Known gaps

- Staff are granted by hand in the database (see `docs/operations/admin.md`).
- Report queries scan the workspace's requests; fine at launch volumes, add summary tables if workspaces reach hundreds of thousands of requests.

## Phase 9: Production readiness: Engineering done (pending review); external gates open

| Item                      | Status      | Notes                                                                                                                                                                                                                                                              |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Skipped-migration guard   | Done        | Builds fail if any journal migration is unrecorded (the 2026-11-12 incident). See `docs/operations/migrations.md`                                                                                                                                                  |
| Staff strong sign-in      | Done        | `/admin` needs two-factor sign-in or a passkey; otherwise the person is sent to Security with an explanation                                                                                                                                                       |
| Webhook DNS rebinding     | Done        | The sender checks every resolved address inside the socket's own lookup, so the address used is the address checked                                                                                                                                                |
| Production secrets        | Done        | Webhooks refuse to run in production without `WEBHOOK_SECRETS_KEY` instead of reusing the session secret                                                                                                                                                           |
| Automatic finishing retry | Done        | The daily job retries failed finishes as the sender, at least 10 minutes apart, at most 3 failures, and emails completed copies                                                                                                                                    |
| Specialized documents     | Done        | Senders see the configured list (wills, family law, court documents, notarized or recorded instruments, regulated records) and confirm before sending. The confirmation and version are evidence. The API needs `acknowledge_specialized_documents` for live sends |
| Accessibility             | Done        | Automated scan now also covers staff pages and the staff Security notice; manual audit still open                                                                                                                                                                  |
| Load testing              | Done        | `scripts/load-test.mjs` (no dependencies) with a p99 budget; run against staging once previews have their own data                                                                                                                                                 |
| Incident response         | Draft       | `docs/operations/incident-response.md`                                                                                                                                                                                                                             |
| Infrastructure review     | Done        | `docs/operations/infrastructure-review.md`, 10 findings with owner actions                                                                                                                                                                                         |
| Independent assessment    | Not started | Brief ready: `docs/security/assessor-brief.md`                                                                                                                                                                                                                     |
| Legal review              | Not started | Brief ready: `docs/legal/attorney-brief.md`                                                                                                                                                                                                                        |

### Tests

- `packages/core`: skipped-migration detection, strong sign-in for staff, pinned webhook sender (local delivery allowed only in development, private addresses refused at connect time, redirects not followed), scheduled finishing retry after a storage failure, live sends refused without the specialized-documents confirmation and the confirmation recorded. 122 tests in total.
- `apps/web`: staff flow now checks the strong sign-in redirect; accessibility scan of staff pages; send flows confirm the notice.

### Known gaps

- External gates remain: penetration test, attorney review, manual accessibility audit, staging load run, restore drill for files, monitoring setup and the owner's flag decisions. See `docs/RELEASE_CHECKLIST.md`.

## Public Product page: Done (pending review)

`/product`, linked from a new sticky header (Product, How It Works, Pricing, Integrations, For Business, Resources) with a phone menu, and an expanded footer.

| Feature             | Status | Notes                                                                                                                                                                                        |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sections            | Done   | Hero, eight features, preparation, Signature Studio, workflows, documents, security, templates, teams, integrations, developer API, three steps, pricing, FAQ, final call to action          |
| Interactive demos   | Done   | Field placement and Signature Studio run only in the browser; nothing is saved or sent and nothing is signed                                                                                 |
| Honest availability | Done   | Coming-soon labels for automatic reminders, tags and folders, dashboard reminders, team activity, extra signature families and Studio controls; integrations read from the catalogue         |
| Pricing             | Done   | Read from the price list and plans tables, never hard-coded                                                                                                                                  |
| SEO                 | Done   | Title, description, canonical, Open Graph, SoftwareApplication and FAQPage structured data (with the CSP nonce)                                                                              |
| Analytics           | Done   | Events queue in the browser only (`window.stAnalytics`, `st:analytics`); no provider or consent banner yet; skipped under Do Not Track or Global Privacy Control; typed names never recorded |

### Tests

- Playwright `e2e/product.spec.ts`: metadata, active nav, prices from the database, CTA destinations, every internal link and anchor resolves, demos work with no requests sent, FAQ, phone menu. `/product` added to the axe and phone-width checks.

### Known gaps

- Visuals are interface compositions built from app styles with fictional, labelled data, not screenshots.
- No dedicated For Business page: For Business links to the teams section.
- The homepage still says document upload opens in the next release; it was left unchanged.

## Documents page details drawer: Done (pending review)

Clicking a row, a document name or its View link on `/app/documents` opens a right-side drawer (full screen on phones) with Overview, Signers, Activity, Files and Evidence tabs. Ctrl/Cmd-click still opens the full document page.

| Feature         | Status | Notes                                                                                                                                                                                                          |
| --------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data            | Done   | `GET /api/documents/[id]/summary`: signed-in members only, row-level security plus a current-workspace check (404 otherwise), never cached. Built from the same loaders as the document page                   |
| Actions         | Done   | Computed on the server from status and permissions: download signed copy, view and download the evidence certificate, send reminder (one an hour), cancel with a reason, continue editing, edit and send again |
| Deep links      | Done   | `?selected=<document id>` reopens the drawer after a refresh; opening another document swaps the content                                                                                                       |
| States          | Done   | Skeletons while loading, error with retry, empty states for activity, files and recipients                                                                                                                     |
| Accessibility   | Done   | Modal dialog with focus trap, Escape to close, focus returned to the opener, arrow-key tabs, status text with every color                                                                                      |
| Short reference | Done   | `ST-` plus the first eight characters of the document ID, shown in the list and drawer and accepted by library search                                                                                          |

### Tests

- Playwright `e2e/documents-drawer.spec.ts`: row click, tabs and keyboard, reminder and the hourly limit, deep link, Escape and focus return, focus trap, completed vs in-progress vs draft actions, downloads, loading, error and retry, cancel, another workspace and signed-out access refused, phone layout, axe scan of the open drawer.

### Known gaps

- Actions the backend does not support yet are not shown in the drawer. They are planned in Phase 10 below.

## Phase 10: Document management actions: Planned

Adds the actions left out of the documents drawer. Each one appears in the drawer only when the server allows it, and every change is recorded in the evidence or audit log.

| Feature                     | Where it shows                 | Rules                                                                                                                                                                                               |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correct a recipient's email | Signers tab                    | `documents.send`. Only for recipients who have not signed or declined. The old link stops working, a new invitation goes to the new address, and an evidence event records the old and new address. |
| Replace a recipient         | Signers tab                    | Same rules as correcting an email. The new person takes over the same role, signing position and fields. Not allowed once the request is completed, declined, expired or cancelled.                 |
| Remind one recipient        | Signers tab, per person        | `documents.send`. Only a recipient whose turn it is. The one-an-hour limit applies per recipient, and the reminder count in the drawer comes from these events.                                     |
| Duplicate a document        | Overview quick actions         | `documents.create`. Copies the latest original PDF, recipients, fields and settings into a new draft. No signing history, signatures or evidence are copied.                                        |
| Save as template            | Overview quick actions         | `templates.manage`. Builds a template from the document's PDF, fields and settings. Recipients become roles; names and emails are not kept.                                                         |
| Tags and folders            | Overview summary, list filters | Workspace-level folders and tags with library filters. Changing them never changes a sent or completed document and is recorded in the audit log.                                                   |
| Supporting attachments      | Files tab                      | Extra files added to a draft for recipients to read. They can be replaced or deleted only while the document is a draft and are locked once it is sent.                                             |
| First-page thumbnail        | Overview preview card          | Page 1 rendered to an image when a PDF is uploaded, served through the same access checks as the file. Replaces the drawn page.                                                                     |

### Tests to add

- Each action: allowed and refused by permission, refused in the wrong status, and the evidence or audit event written.
- Correct and replace: the old link stops working and the new recipient can sign; the evidence certificate lists the change.
- Duplicate and template: nothing from the signing history carries over.
- Drawer: each action appears only when allowed; the axe scan still passes.

### Open questions for the owner

- Should correcting an email or replacing a recipient also notify the person being removed?
- Should duplicating or saving as a template be free, or count toward any plan limit?

## App sidebar: Midnight Navy and Champagne Gold: Done (pending review)

The signed-in sidebar is redesigned: navy background with gold accents, a navy version of the approved logo, a gold Create Document card, and the same menu in the phone drawer. Page content is unchanged.

| Feature         | Status | Notes                                                                                                                                                                                                                                                                                                        |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Menu            | Done   | Dashboard, Documents, Templates, Contacts, Team, Billing & Credits, Integrations, Settings, from one shared config (`components/shell/nav.ts`) used by desktop and phone                                                                                                                                     |
| Submenus        | Done   | Documents (All, In Progress, Completed, Archived), Billing (Overview, Buy Credits, Plans & Pricing, Invoices, Usage) and Settings (Workspace, Profile, Branding, Security, Data Retention, API Settings). They reuse the pages' own tabs; label navigates, chevron toggles; the current section opens itself |
| Collapse        | Done   | 272px or 80px. Remembered in a cookie (no database writes) and read by the server, so there is no flash. Tooltips and flyout menus when collapsed, placed outside the scrolling menu                                                                                                                         |
| Role visibility | Done   | Templates, Contacts, Team and API Settings hidden without their permission; Create Document hidden without `documents.create`. Pages still enforce access                                                                                                                                                    |
| Create Document | Done   | "Get Started" until the person has sent a document, then "Ready to Send?". Opens the existing upload step; drafts are never charged                                                                                                                                                                          |
| Phone drawer    | Done   | Slides in from the left with focus trap, Escape, backdrop click and focus return. Rendered at page level so the top bar's blur no longer clips it                                                                                                                                                            |
| Logo            | Done   | `public/brand/logo-on-navy.png` and `icon-on-navy.png`, recoloured from the approved logo (gold nib, ivory wordmark); shapes unchanged                                                                                                                                                                       |

### Tests

- Unit: menu order, no duplicate entries, tab matching, role filtering.
- Playwright `e2e/sidebar.spec.ts`: every link, active states, submenus, collapse and expand, content resizing without overlap, tooltips, flyouts, keyboard, preference after reload, short screens, phone drawer, axe scan. `teams.spec.ts` checks what a Viewer sees and that hidden pages still refuse.

### Known gaps

- Signature Studio is not in the menu: the app has no Signature Studio page yet (it exists only as a demo on the Product page).
- Drafts is left out of the Documents submenu because the Drafts tab was deliberately hidden.
- No notification badges: there is no inbox or notification centre to count from yet.
- The rebrand's info blue (#2563eb) failed contrast on its pale background; restored to #1d4ed8 so the accessibility checks pass again.
