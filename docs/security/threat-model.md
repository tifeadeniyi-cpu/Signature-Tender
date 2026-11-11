# Threat model (Phase 1 scope, STRIDE)

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

## Open items

- `user` table readable by `st_app` (needed by auth). Mitigation planned: restricted view for member listings (Phase 6).
- CSP allows `'unsafe-inline'` scripts for Next.js; move to nonce-based CSP before production.
- Secrets management: use Vercel/Neon encrypted environment variables; rotate `BETTER_AUTH_SECRET` per environment.
