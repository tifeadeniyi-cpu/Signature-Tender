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

## Phase 3: Signing and evidence: Done (pending review)

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

## Phases 4 to 9: Not started

See the plan doc for scope and order.
