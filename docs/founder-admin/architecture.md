# Founder Admin portal: audit, architecture and gaps

Phase 1 of the Founder Admin Command Center. This is what the codebase already gives the portal, how
the portal is built on it, and what is not measured yet. The portal shows only real data. Where
something is not collected, the page says so and shows no number.

## What exists today

| Area                  | What is there                                                                                                                                                                 | Used by the portal                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| App                   | Next.js 16 app router (`apps/web`), shared logic in `packages/core`, Drizzle schema and SQL migrations in `packages/db`                                                       | Portal pages live under `/admin`                                                                 |
| Auth                  | Better Auth with email verification, two-factor (TOTP) and passkeys. Sessions last 7 days                                                                                     | Staff must have two-factor or a passkey. Staff sessions are cut to 12 hours                      |
| Database access       | App role `st_app` with row-level security on every tenant table. Staff analytics go through `SECURITY DEFINER` functions that check staff role and return counts and ids only | All portal data comes from these functions                                                       |
| Staff list            | `platform_admins`, writable only by the database owner                                                                                                                        | Now has a `role` column                                                                          |
| Audit log             | `audit_events`, append-only for the app role (insert and select only)                                                                                                         | Now append-only for everyone (triggers), plus an admin audit trail view                          |
| Documents and signing | `documents`, `signing_requests`, `request_recipients`, `signing_events` (hash-chained evidence), `documents.document_type` chosen by the customer                             | Aggregate counts only. Titles, files, recipients and evidence are never read by portal functions |
| Billing               | `payments`, `credit_ledger`, `credit_holds`, `invoices`, `billing_accounts`, `stripe_events` from verified Stripe webhooks                                                    | Revenue is net of refunds from `payments`. Credit use is never counted as a second payment       |
| Signature Studio      | `signature_designs`, `signature_purchases`, `signature_downloads`, `signature_studio_events` (session hash, event name, attributes)                                           | Aggregate design attributes and funnel counts. Artwork, strokes and assets are never read        |
| Email                 | `notifications` with delivery status, including `bounced`                                                                                                                     | Delivery and bounce rates                                                                        |
| Webhooks and API      | `webhook_deliveries`, `api_keys`, `api_usage_daily`                                                                                                                           | Delivery success and API volume                                                                  |
| Integrations          | Connector registry, credentials (encrypted), sync jobs and activity                                                                                                           | Health counts                                                                                    |
| Background jobs       | Vercel cron routes (webhooks, finalisation retry, retention)                                                                                                                  | Failure counts from the tables those jobs write                                                  |
| Feature flags         | `feature_flags` with an environment list                                                                                                                                      | Read-only view                                                                                   |

## Roles and permissions

Staff roles live in `platform_admins.role`. The permission matrix lives in one SQL function,
`st_admin_role_permissions`, so the database and the app always agree.

| Role              | Permissions                                                                        |
| ----------------- | ---------------------------------------------------------------------------------- |
| founder           | analytics, revenue, audit, security, system, support, access, settings, operations |
| finance           | analytics, revenue                                                                 |
| support           | support                                                                            |
| security          | analytics, audit, security, system, access                                         |
| technical         | analytics, system, settings, operations                                            |
| analyst (default) | analytics                                                                          |

Every page calls `requireAdmin(permission, view)`. Every data function checks the role again with
`st_admin_require_perm`, so hiding a link is never the only protection. Refused attempts are
recorded as `admin.access_denied`.

No role can read customer documents, signature artwork, recipients or signing evidence. There is no
impersonation and no master password.

## Privacy rules the portal follows

- Customers appear as opaque references (a hash prefix), never by name or email. Staff appear by
  name.
- Customer event details are withheld in the audit trail. Staff event details have keys that look
  like secrets, emails, phone numbers or codes redacted.
- Analytics are aggregates. Breakdowns that would single out a very small group are suppressed
  (threshold applied from the Command Center phase onward).
- Exports, when added, are generated on the server, logged, expire, and are protected against
  spreadsheet formula injection.

## Gaps: not measured yet

These will show "Not tracked yet" until instrumentation exists. Nothing is estimated.

| Metric                                                           | Why it is missing                                                                                               | Path                                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Uptime, API latency (p50/p95/p99), error rates                   | No independent monitor or APM is connected                                                                      | Connect an uptime monitor and Vercel observability or an APM, then read it server-side                                        |
| Daily, weekly and monthly active users, sessions, session length | No product session or activity events are recorded. Sign-in sessions are not product use                        | Add a privacy-safe `product_events` table (pseudonymous user ref, feature, outcome) written server-side on meaningful actions |
| Feature adoption beyond what tables show                         | Only features with their own tables can be counted (sends, templates, contacts, integrations, API keys, Studio) | Same `product_events` table                                                                                                   |
| Visitor-to-registration conversion, acquisition source           | No visitor analytics or attribution is stored                                                                   | Optional, consent-based marketing analytics                                                                                   |
| Support tickets                                                  | No ticketing system exists                                                                                      | Build the support module or connect a help desk                                                                               |
| Security incidents, vulnerability findings                       | No incident register exists (incident response is a document)                                                   | Incident table in the security phase                                                                                          |
| Failed sign-ins, suspicious sign-ins                             | Better Auth does not persist failed attempts                                                                    | Auth hooks that write `auth.*` audit events                                                                                   |
| Backups and restore tests                                        | Neon handles backups; no restore test result is stored                                                          | Record restore drills (see `docs/operations/recovery.md`)                                                                     |
| Compliance certifications                                        | None held                                                                                                       | The portal never claims SOC 2, ISO 27001 or PCI status                                                                        |

## Phases

1. Audit and architecture (this document).
2. Security foundation: roles, permission checks, append-only audit log, admin audit trail, admin
   access page, the navy sidebar portal shell, 12-hour staff sessions, a "Founder admin" link in the
   app menu.
3. Command Center dashboard.
4. Platform Performance (Overview, Growth, Engagement, Feature Usage, Conversion & Retention,
   Delivery & Operations), reusing the Command Center's filters and data functions.
5. Remaining modules: users and organizations, revenue, security, system health, support, reports
   and exports, platform settings.
6. Monitoring integrations and launch readiness.
