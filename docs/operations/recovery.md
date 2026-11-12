# Backup and recovery (proposed, not yet tested)

Spec Part 17 asks for documented recovery. This is the plan for review. **None of it has been rehearsed yet**, and the targets below are proposals, not commitments. Before production, run a restore drill and record the result here.

## What holds the record

| Data                                                                  | Where                                              | What losing it means                                      |
| --------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Accounts, documents, requests, evidence log, audit log, credit ledger | Postgres (Neon)                                    | Loss of the record of who signed what, and of balances    |
| Original PDFs, signed copies, certificates                            | Object storage (S3-compatible, e.g. Cloudflare R2) | Files gone; hashes in Postgres still prove what they were |
| Emails                                                                | Email provider logs                                | Delivery history only; not part of the record             |

Every stored file has a SHA-256 in Postgres, and every download is checked against it. A restored file that does not match is refused, so a bad restore cannot silently serve a changed document.

## Proposed targets

- **RPO (data we could lose):** 5 minutes for Postgres, using Neon point-in-time restore. Files: none once versioning is on, because objects are written once and never overwritten.
- **RTO (time to restore service):** 4 hours, mostly for checks before reopening.

## Settings to switch on before production

1. Neon: keep point-in-time restore history for at least 7 days (paid plan), and take a named snapshot before every migration.
2. Object storage: turn on bucket versioning and a lifecycle rule that keeps deleted versions for 30 days, so an accidental or malicious delete can be undone.
3. A second copy of the bucket in another region or provider, refreshed daily.
4. Store credentials for the backup copy separately from the app's credentials, so the app cannot delete its own backups.

## Restoring Postgres

1. Pause sending: switch off the `production_signing` and `payments` flags (they are database rows, so do it on the restored branch too).
2. In Neon, create a branch from the main branch at a time just before the incident.
3. Point a staging deployment at the branch and run the checks below.
4. When they pass, promote the branch (or reset main from it) and update `DATABASE_URL` if the host changed.
5. Replay Stripe events received after the restore point from the Stripe dashboard. Event handling is idempotent, so repeats are safe.
6. Switch the flags back on.

## Restoring files

1. Restore deleted objects from versioning, or copy from the second copy.
2. Run the integrity check (Verify integrity on each document, or a script over `document_files`) to confirm every hash matches.

## Checks before reopening

- Evidence logs verify for a sample of completed requests (the hash chain is intact).
- Credit reconciliation on the Billing page shows no mismatches.
- A test request can be sent and signed end to end.

## Records past their retention period

Retention deletion removes stored files but keeps the document row, hashes, evidence and audit log, and records who deleted what. Automatic deletion is behind the `retention_deletion` flag, which is off. With versioning on, files deleted in the last 30 days can still be recovered if a deletion was a mistake; after that they are gone by design. Records on legal hold are never deleted.
