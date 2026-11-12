# Threat model (STRIDE)

Living document. Each later phase adds its own section.

| Category               | Threat                                    | Control in place                                                                                                               | Test                                              |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Spoofing               | Credential stuffing or brute force        | Rate limits on sign-in, sign-up, reset and TOTP; 12-char passwords; breached-password check (staging/prod); TOTP MFA; passkeys | Manual; rate limit is config-tested in staging    |
| Spoofing               | Unverified email used to act as someone   | Sign-in refused until email verified                                                                                           | e2e: unverified sign-in redirects to verification |
| Tampering              | Changing another workspace via forged ids | RLS policies + service permission checks                                                                                       | `tenant-isolation.test.ts`                        |
| Tampering              | Forged workspace-switch cookie            | Membership re-checked on every request                                                                                         | Service test (forbidden on non-member)            |
| Repudiation            | Denying a settings change                 | `audit_events` written in the same transaction; app role cannot update or delete                                               | `tenant-isolation.test.ts` (append-only)          |
| Information disclosure | Reading other tenants' data               | RLS with FORCE; app role has no BYPASSRLS; nothing visible without an actor                                                    | `tenant-isolation.test.ts`                        |
| Information disclosure | Account enumeration via reset             | Identical response whether or not the account exists                                                                           | Manual                                            |
| Information disclosure | XSS / clickjacking                        | React escaping, CSP, X-Frame-Options DENY, frame-ancestors 'none'                                                              | Headers set in `next.config.ts`                   |
| Denial of service      | Auth endpoint flooding                    | Database-backed rate limits                                                                                                    | Staging                                           |
| Elevation of privilege | Editor changing workspace settings        | `workspace.manage` required in service and RLS                                                                                 | Service + RLS tests                               |

## Phase 3: signing links and evidence

| Category               | Threat                                     | Control in place                                                                                                                                     | Test                                                |
| ---------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Spoofing               | Guessing or forging a signing link         | 256-bit random tokens; only a SHA-256 hash is stored; links expire; rotated when re-sent; invalidated on cancel                                      | `signing.test.ts` (unknown/malformed links, cancel) |
| Spoofing               | Forwarded link used by someone else        | Optional one-time email code: 6 digits, 10-minute expiry, single use, 5 attempts, 5 sends, 30 s resend gap; browser session bound by httpOnly cookie | `signing.test.ts`, `signing.spec.ts`                |
| Tampering              | Document changed after sending             | Source SHA-256 snapshotted on send and re-verified on every signer completion and at finalization; drafts frozen once sent                           | `signing.test.ts`                                   |
| Tampering              | Editing or deleting evidence               | `signing_events` is append-only for the app role and hash-chained; integrity check recomputes the chain and file hashes                              | `signing.test.ts` (tamper detection)                |
| Tampering              | Signer filling another signer's fields     | RLS: only `recipient_id = st_current_signer()` can update a field                                                                                    | `signing.test.ts`                                   |
| Repudiation            | Signer denies signing                      | Consent with disclosure version and hash, adoption method and image hash, explicit intent, IP and browser, all in the chain and certificate          | `signing.test.ts`                                   |
| Information disclosure | Signer browsing other data                 | Signer context sees only its own request and document; no workspace rows                                                                             | `signing.test.ts` (RLS scope)                       |
| Information disclosure | Token leaking via Referer, cache or search | `Referrer-Policy: no-referrer`, `no-store` and `noindex` on `/sign` and `/api/sign`                                                                  | Headers in `next.config.ts`                         |
| Information disclosure | Metadata in uploaded signature images      | Client redraws to PNG; server keeps only drawing chunks and proves the image decodes                                                                 | `signing.test.ts`                                   |
| Denial of service      | Double submit or race on completion        | Row locks, status checks and a unique open-request index; finalization is idempotent                                                                 | `signing.test.ts`                                   |
| Elevation of privilege | Sending without permission                 | `documents.send` required in service and RLS                                                                                                         | `signing.test.ts` (viewer refused)                  |

## Open items

- `user` table readable by `st_app` (needed by auth). Mitigation planned: restricted view for member listings (Phase 6).
- CSP allows `'unsafe-inline'` scripts for Next.js; move to nonce-based CSP before production.
- Signer-side rate limiting is per recipient in the database; add IP-level limits at the edge (Vercel firewall) before production.
- Finalization runs inline after the last signature; move it to a background worker with retries in Phase 5/9.
- Secrets management: use Vercel/Neon encrypted environment variables; rotate `BETTER_AUTH_SECRET` per environment.
