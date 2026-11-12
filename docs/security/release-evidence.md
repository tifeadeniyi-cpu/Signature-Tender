# Release evidence (2026-11-12)

Evidence gathered for the engineering gates in `docs/RELEASE_CHECKLIST.md`. Each gate still needs its named owner to review and approve it. Nothing here replaces the attorney review or the independent penetration test.

## Automated vulnerability scan

- `pnpm audit` before: 2 moderate, 0 high, 0 critical. Both were in development-only tools (`esbuild` under `drizzle-kit`, `minimatch` under `eslint`), not in anything shipped to users.
- Fixed with `pnpm.overrides` in the root `package.json`. `drizzle-kit check` and lint still pass.
- `pnpm audit` after: **No known vulnerabilities found.**
- Git history scanned for live Stripe keys, webhook secrets, Resend keys, AWS keys, private keys and Neon connection strings: none found. Only `.env.example` is tracked.
- Still to add: a scheduled CI job for `pnpm audit` and a dependency update bot.

## Storage isolation and permissions

- **Database:** every tenant table has row-level security. The app connects as `st_app`, which cannot bypass RLS (`rolbypassrls = false`, checked on staging 2026-11-12). Without a signed-in actor, `st_app` sees 0 workspaces and 0 documents (checked on the restore-drill branch).
- **Tests:** `tenant-isolation.test.ts` covers cross-tenant reads, IDOR, direct SQL updates, self-joining and the append-only audit log. `documents.test.ts` covers outsiders, editors and viewers. `signing.test.ts` scopes a signer to their own request at the database level. `library.test.ts` covers retrieval scoping. `teams.test.ts` covers role escalation and private contacts and templates.
- **Object storage:** the staging bucket `st-documents` is `private` (Neon API, 2026-11-12). Files are only served through app routes that do an RLS-checked lookup first; there are no public or presigned links. Object keys contain the workspace id and random UUIDs.
- **Recipient pages** send `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.

## Keys and secrets

- Secrets live only in Vercel environment variables (encrypted at rest). None are in the repository or its history (see the scan above).
- Signing links, invitation links, retrieval sessions and email codes are random and stored only as SHA-256 hashes.
- `BETTER_AUTH_SECRET` must differ per environment. Production Stripe keys are added by the owner in Vercel, never through chat or code.
- Error logs mask signing, invitation and retrieval tokens in paths and drop query strings (`src/instrumentation.ts`).

## Final-document integrity

- Every stored file (original, signed copy, certificate, template, logo) has a SHA-256 recorded at write time and checked on every read. A mismatch is a hard error, never a silent serve.
- `signing.test.ts` ("verifies file hashes and detects tampering with files or evidence") and `library.test.ts` (versions) cover this. The Versions tab lets anyone compare a copy's fingerprint locally.

## Security headers

- Pages now get a per-request **nonce Content Security Policy** from `src/proxy.ts`: `script-src 'self' 'nonce-…' 'strict-dynamic'`, with no `'unsafe-inline'` scripts. Styles keep `'unsafe-inline'` for React style attributes.
- API responses get `default-src 'none'`. HSTS, `nosniff`, `X-Frame-Options: DENY` and `frame-ancestors 'none'` are unchanged.
- `e2e/csp.spec.ts` checks the header, a fresh nonce per request, that every inline script carries the nonce, and that the browser reports no CSP violations. The full browser suite (19 tests, including PDF rendering and signing) passes under the new policy.

## Accessibility (automated)

- `e2e/a11y.spec.ts` runs axe-core with the WCAG 2.0, 2.1 and 2.2 A/AA rules on 23 pages: the public pages, sign-in and sign-up, the recipient signing and retrieval pages, and every main app page. **Result: no violations.**
- Automated tools find roughly a third of accessibility problems. A manual audit with a keyboard and a screen reader (VoiceOver and NVDA) is still needed before this gate is approved.

## Backups and restore drill

- Neon keeps point-in-time history for the staging project. On 2026-11-12 at 06:00 UTC a branch was restored from the live staging branch (`restore-drill-2026-11-12`, `br-summer-smoke-bbxc63dw`). It was ready in under 10 seconds.
- **Checks on the restored branch:** row counts matched the source (workspaces 1, documents 1, audit events 2, users 2), all 12 migrations were present, and 82 RLS policies were present. `st_app` still saw no data without an actor.
- Object storage is not covered by this drill. File restore depends on the storage provider's versioning, which still needs to be turned on and tested for production.
- The drill branch is left in place, suspended, until the owner says to delete it.

## Load test (local baseline)

- Production build (`next start`) on a 4-core container with local Postgres. autocannon, 25 concurrent connections, 15 seconds per route:

| Route                    | Requests/s | p50   | p97.5  | p99    | Errors |
| ------------------------ | ---------- | ----- | ------ | ------ | ------ |
| `/api/health`            | 1176       | 19 ms | 36 ms  | 40 ms  | 0      |
| `/sign-in`               | 253        | 92 ms | 138 ms | 159 ms | 0      |
| `/sign/<token>` (lookup) | 269        | 88 ms | 119 ms | 129 ms | 0      |
| `/retrieve`              | 308        | 76 ms | 112 ms | 117 ms | 0      |

- This is a baseline, not a production result. Vercel and Neon have different limits (function concurrency, connection pooling, cold starts). Before launch, repeat it against staging with the pooled Neon connection string, and include signing completion and finalization.

## Monitoring

- `GET /api/health` returns `{ ok, db }` with status 200, or 503 if the database is unreachable. It exposes no version or configuration.
- Unhandled server errors are logged as one JSON line with `event: "server.error"` (`src/instrumentation.ts`).
- **Owner setup still needed:**
  - an uptime monitor on `/api/health`;
  - a Vercel alert or log drain matching `server.error` and `health.db_unreachable`;
  - Stripe webhook failure emails;
  - Resend bounce and complaint alerts.
