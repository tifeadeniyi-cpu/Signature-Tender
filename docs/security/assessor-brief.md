# Brief for the independent security assessment

This is for the firm that runs the penetration test required by the release checklist. Share it
with them along with `threat-model.md`, `architecture.md` and `release-evidence.md`.

## What Signature Tender is

A multi-tenant electronic signature service. Members upload PDFs, place fields, and send signing
requests. Recipients sign through emailed links with no account. Completed documents get a signed PDF
and a completion certificate, backed by a hash-chained evidence log.

## Environment for testing

- Test against **staging**, never the live production database. Before testing starts, the owner
  gives previews and staging their own Neon branch (`docs/operations/infrastructure-review.md`,
  finding 1), and the tester gets a dedicated deployment URL.
- Test signing is free and clearly marked TEST, so testers can run real signing flows without
  payments.
- The owner provides the following, created for the test and removed afterwards:
  - two workspaces, each with an Owner, Manager, Editor, Viewer and API Developer;
  - a staff account added to `platform_admins` with two-factor sign-in;
  - API keys with different scopes.

## In scope

| Area                   | What to look at                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Workspace isolation    | Any way for one workspace to read or change another's documents, files, contacts, templates, reports or billing    |
| Roles                  | Members exceeding their role (for example an Editor sending, a Viewer reading audit history)                       |
| Recipient links        | Guessing, reuse after completion or expiry, links reaching other recipients' fields, the email code, signing order |
| Evidence and integrity | Changing documents, signatures or the evidence log without detection; certificate accuracy                         |
| Files                  | Direct access to stored files, upload parsing (malformed or hostile PDFs), signature image handling                |
| Public API             | Key scopes, the workspace boundary, idempotency, rate limits, embedded signing links                               |
| Webhooks and Slack     | SSRF through endpoint URLs (including DNS rebinding), secret handling, payload contents                            |
| Payments               | Sending without paying, spending a credit twice, Stripe webhook forgery (test mode)                                |
| Authentication         | Sign-up, verification, password reset, sessions, two-factor sign-in, passkeys, staff access                        |
| Staff administration   | Reaching `/admin` or its data without being staff; staff seeing document contents                                  |
| Web security           | Content Security Policy, framing, cross-site request forgery, injection, open redirects                            |

## Out of scope

- Denial of service and load against shared infrastructure (Vercel, Neon, Resend, Stripe).
- Social engineering and physical access.
- The third-party services themselves.

## Known issues (no need to report)

These are listed in `threat-model.md` under "Open items":

- Previews currently share production data. This will be fixed before testing.
- Edge-level IP rate limiting is not in place yet.
- The billing webhook uses a session setting rather than its own database role.

## Reporting

Rate findings Critical, High, Medium or Low. Critical and High findings are fixed and retested before
launch. The release checklist records the report and the retest.
