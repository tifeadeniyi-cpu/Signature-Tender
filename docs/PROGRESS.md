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

## Phase 4: Payments and credits: Done (pending review)

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

## Phases 5 to 9: Not started

See the plan doc for scope and order.
