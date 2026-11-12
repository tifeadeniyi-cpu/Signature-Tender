# Release checklist (spec Part 35)

No real customer documents until every row is approved with evidence.

| Gate                                                                                         | Owner      | Evidence                                                                             | Status                       |
| -------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------ | ---------------------------- |
| Threat model completed and reviewed                                                          | TBD        | docs/security/threat-model.md                                                        | Evidence ready, needs review |
| Architecture review                                                                          | TBD        | docs/architecture.md, docs/operations/infrastructure-review.md                       | Evidence ready, needs review |
| Automated vulnerability scans clean (critical/high)                                          | TBD        | docs/security/release-evidence.md                                                    | Evidence ready, needs review |
| Independent penetration test, fixes retested                                                 | TBD        | Brief: docs/security/assessor-brief.md                                               | Not started                  |
| Storage isolation and permissions validated                                                  | TBD        | docs/security/release-evidence.md                                                    | Evidence ready, needs review |
| Key and secret handling validated                                                            | TBD        | docs/security/release-evidence.md                                                    | Evidence ready, needs review |
| Final-document integrity validated                                                           | TBD        | docs/security/release-evidence.md                                                    | Evidence ready, needs review |
| Audit evidence and certificate reviewed by counsel                                           | TBD        |                                                                                      | Not started                  |
| Incident response and backups reviewed; restore drill                                        | TBD        | docs/operations/incident-response.md (draft); database drill done; file restore open | In progress                  |
| Attorney review (ESIGN/UETA, consent, terms, privacy, retention, excluded documents)         | TBD        | Brief: docs/legal/attorney-brief.md                                                  | Not started                  |
| Privacy and retention disclosures published                                                  | TBD        |                                                                                      | Not started                  |
| Stripe and email production configuration confirmed                                          | TBD        | Resend domain verified (signaturetender.com); live Stripe keys pending               | In progress                  |
| Accessibility audit (WCAG 2.2 AA)                                                            | TBD        | e2e/a11y.spec.ts (automated pass; manual audit open)                                 | In progress                  |
| Load and performance tests                                                                   | TBD        | scripts/load-test.mjs; local baseline in release-evidence.md; staging run open       | In progress                  |
| Monitoring and alerting live                                                                 | TBD        | /api/health, server.error logs; alerts need owner setup                              | In progress                  |
| API: `CRON_SECRET` and `WEBHOOK_SECRETS_KEY` set; `public_api` flag enabled by product owner | Queen tife |                                                                                      | Not started                  |
| Staff admin: staff list reviewed, passkey or 2FA required for staff accounts                 | TBD        | docs/operations/admin.md (2FA or passkey enforced in code)                           | Evidence ready, needs review |
| Previews use their own database branch, bucket and auth secret                               | Queen tife | docs/operations/infrastructure-review.md (finding 1)                                 | Not started                  |
| `production_signing` flag enabled by product owner                                           | Queen tife |                                                                                      | Not started                  |
