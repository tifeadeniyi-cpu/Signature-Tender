# Progress

Last updated: 2026-11-11. Status key: **Done**, **Partial**, **Blocked**, **Not started**.

## Phase 0: Discovery and architecture: Done

Architecture and phased plan approved in the project's planning doc. Summary in [architecture.md](architecture.md).

## Phase 1: Brand and application foundation: Done (pending review)

| Feature                                                               | Status      | Notes                                                                                                         |
| --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| Monorepo, TypeScript strict, ESLint, CI                               | Done        | pnpm workspaces; GitHub Actions runs typecheck, lint, unit, build, e2e                                        |
| Design tokens (Part 4.3), DM Serif Display + Inter                    | Done        | Tailwind v4 theme in `apps/web/src/app/globals.css`                                                           |
| Approved logos                                                        | Done        | Used unchanged; reversed logo has a baked-in background, so it renders as a rounded tile                      |
| App shell: burgundy sidebar, 8 nav items, top bar, mobile drawer      | Done        | Global search and notifications are omitted until there is content to search/notify (Phases 3 and 5)          |
| Authentication: email/password, email verification, password reset    | Done        | Better Auth; 12-character minimum; breached-password check enabled in staging/production                      |
| MFA (TOTP + backup codes), passkeys, session list and revoke          | Done        | Passkey flow not covered by automated tests (needs WebAuthn virtual authenticator)                            |
| Login rate limiting                                                   | Done        | Database-backed; disabled only in `APP_ENV=test`                                                              |
| Workspaces, onboarding, workspace switcher                            | Done        | Switcher re-verifies membership server-side                                                                   |
| Roles and permissions                                                 | Done        | 6 system roles, 17 permissions; enforced in services and Postgres RLS                                         |
| Profile page, workspace settings                                      | Done        | Saved to database with audit events                                                                           |
| Core schema + RLS                                                     | Done        | identity, workspaces, memberships, roles, permissions, audit_events, feature_flags, app_config, plans, prices |
| Homepage and pricing page                                             | Done        | Prices and savings read from the database, never hardcoded                                                    |
| Legal pages                                                           | Blocked     | Placeholders only; waiting on attorney-drafted Terms, Privacy and E-Sign disclosure                           |
| Dashboard                                                             | Partial     | Layout per mockup; counts are real zeros until documents exist; quick actions shown as "Coming soon"          |
| Sections: Documents, Templates, Contacts, Team, Billing, Integrations | Not started | Honest "being built" pages with their phase number, no sample data                                            |

### Tests

- `packages/core`: 19 tests (unit + tenant isolation against real Postgres as the non-superuser app role): cross-tenant reads, IDOR, direct SQL updates, self-joining a workspace, no-actor access, append-only audit log, private profiles.
- `apps/web`: 2 unit tests, 5 Playwright tests (unauthenticated redirect, homepage pricing and claim check, full signup → verify → workspace → settings → sign out → sign in, phone-width overflow on marketing pages).

### Known gaps and defects

- The `user` table has no RLS (auth needs global lookups). Tenant queries must not join it directly; a restricted member-directory view is planned for Phase 6.
- Email change is not supported yet (field is read-only).
- Feature flags and pricing can only be changed with the database owner role; an admin UI comes with the admin console.
- `st_app` role must be created with a password in each hosted database (Neon) before deploy.

## Phases 2 to 9: Not started

See the plan doc for scope and order.
