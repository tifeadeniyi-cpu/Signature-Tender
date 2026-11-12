# Infrastructure review (2026-11-12)

This review covers the hosted setup as it is today. It is based on the Vercel project settings (names
only, no values were read) and the Neon project. It is input for the architecture review gate, not a
sign-off.

## What runs where

| Part            | Service                                          | Notes                                                                       |
| --------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| Web app and API | Vercel project `signature-tender` (team Myllenn) | Next.js; `main` deploys to signaturetender.com; every branch gets a preview |
| Database        | Neon `signature-tender`, us-east-1, one branch   | App connects as `st_app` (row-level security); migrations as owner          |
| Files           | Neon object storage bucket `st-documents`        | Every file has a SHA-256 in the database and is checked when served         |
| Email           | Resend, domain signaturetender.com verified      |                                                                             |
| Payments        | Stripe test mode, not configured on Vercel yet   | `payments` flag off                                                         |
| Scheduled jobs  | Vercel Cron, daily `/api/cron/webhooks`          | Sends webhooks and retries documents that failed to finish                  |

`APP_ENV` is `staging` for both production and preview deployments, so the site behaves as staging:
`production_signing` and `public_api` stay off there.

## Findings

| #   | Finding                                                                                                                                                                                                                                                              | Risk   | Recommendation                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Preview deployments use the same `DATABASE_URL`, `DATABASE_URL_OWNER`, storage bucket and `BETTER_AUTH_SECRET` as production. A preview build migrates the production database (this caused the 2026-11-12 incident), and preview code can read and write live data. | High   | Create a Neon branch for previews (or the Neon Vercel integration that makes one per preview). Set Preview-only `DATABASE_URL`, `DATABASE_URL_OWNER`, a separate bucket and a separate `BETTER_AUTH_SECRET`. |
| 2   | `BETTER_AUTH_URL` for previews is the production domain, so preview sign-in links and emails point at production.                                                                                                                                                    | Medium | Set it per environment once previews have their own data.                                                                                                                                                    |
| 3   | `WEBHOOK_SECRETS_KEY` is not set. Webhook secrets are encrypted with a key derived from `BETTER_AUTH_SECRET`. Code now refuses this when `APP_ENV=production`.                                                                                                       | Medium | Add a random 32+ character `WEBHOOK_SECRETS_KEY` (Production) before turning on `public_api`.                                                                                                                |
| 4   | Cron runs once a day (Hobby plan limit). Webhook retries and finishing retries wait up to a day.                                                                                                                                                                     | Medium | On a Pro plan, change `apps/web/vercel.json` to run every few minutes.                                                                                                                                       |
| 5   | One database branch and one region; point-in-time history depends on the Neon plan.                                                                                                                                                                                  | Medium | Confirm restore history of at least 7 days; take a named snapshot before each release.                                                                                                                       |
| 6   | File storage versioning is not confirmed, and the backup copy is not separate.                                                                                                                                                                                       | Medium | Turn on versioning or a daily copy to a second provider, with credentials the app does not hold (see `recovery.md`).                                                                                         |
| 7   | `DEV_MAIL_DIR` is still set on Vercel but unused since Resend went live.                                                                                                                                                                                             | Low    | Remove it.                                                                                                                                                                                                   |
| 8   | No uptime monitor or log alert is configured.                                                                                                                                                                                                                        | Medium | Uptime check on `/api/health`; alert on `server.error`, `health.db_unreachable` and `finalization.retry` failures.                                                                                           |
| 9   | Edge rate limiting relies on the app and database only.                                                                                                                                                                                                              | Medium | Add Vercel Firewall rate limits for `/sign/*`, `/retrieve`, `/api/v1/*` and sign-in before production.                                                                                                       |
| 10  | The owner database credential is available to every build.                                                                                                                                                                                                           | Low    | Acceptable while builds run migrations; restrict it to Production once previews have their own branch.                                                                                                       |

## What is in good shape

- The app role has no `BYPASSRLS`. Workspace isolation is enforced by the database and covered by tests.
- Sensitive variables are stored as Vercel "sensitive" values.
- Security headers include a nonce-based Content Security Policy and framing protection.
- Builds fail if a migration was skipped (since Phase 9).
- Staff administration requires two-factor sign-in or a passkey, and every staff view is audited.

## Owner actions, in order

1. Previews on their own Neon branch, bucket and auth secret (finding 1).
2. `WEBHOOK_SECRETS_KEY` for Production (finding 3).
3. Uptime monitor and log alerts (finding 8).
4. Storage versioning or a separate copy (finding 6).
5. Vercel Firewall rules (finding 9).
6. Remove `DEV_MAIL_DIR` (finding 7).
