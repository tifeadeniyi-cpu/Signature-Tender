# Incident response plan (draft for review)

This plan is a starting point for the owner and counsel to review. It has not been rehearsed.
Notification duties depend on the data involved, where the affected people live, and contracts.
Counsel decides them, not this document.

## Severity

| Level | Examples                                                                                                  | First response    |
| ----- | --------------------------------------------------------------------------------------------------------- | ----------------- |
| SEV1  | Documents or evidence exposed to the wrong person; tampering suspected; secrets leaked                    | Within 1 hour     |
| SEV2  | Signing, finishing or retrieval down for everyone; payments taken without the matching request being sent | Within 4 hours    |
| SEV3  | One feature broken (webhooks, Slack, reports); elevated errors with a workaround                          | Next business day |

## Roles

- **Incident lead** (owner by default): decides severity, assigns work, and approves customer messages.
- **Technical responder:** investigates, contains and fixes.
- **Counsel:** for SEV1, decides legal notification duties and reviews wording.

## First hour (SEV1 and SEV2)

1. **Contain.** Switch off what is affected. Feature flags are rows in `feature_flags` and take effect
   at once:
   - `production_signing`: stops new real requests.
   - `payments`: stops checkout.
   - `public_api`: stops the API and webhook delivery.
     Then revoke the affected API keys and staff accounts (`platform_admins`).
2. **Preserve evidence.** Take a Neon snapshot or branch at the current time before changing data.
   Export Vercel logs for the period. Do not delete rows. The evidence log is hash-chained, and
   integrity checks (`verifyRequestIntegrity`) show whether it was changed.
3. **Rotate secrets** that may be exposed. Rotate them in Vercel, then redeploy:
   - `BETTER_AUTH_SECRET` signs everyone out.
   - `WEBHOOK_SECRETS_KEY`: re-encrypt the webhook secrets first, or tell customers to rotate their endpoint secrets.
   - Stripe keys.
   - `RESEND_API_KEY`.
   - The storage credentials.
   - The database password for `st_app`.
4. **Record a timeline** in the incident document: what was seen, when, and by whom.

## Investigation aids

- Audit log (`audit_events`): member and staff actions, including every staff view (`admin.viewed`).
- Evidence log (`signing_events`): every signing step with IP address and user agent.
- `server.error` log lines carry a digest that matches the error page a user saw.
- Staff operations page (`/admin/operations`): failed finishes, failed webhooks and payment issues.

## Recovery

Follow `recovery.md` for database and file restores. Every file is checked against its stored
SHA-256 when it is served, so a restored file that doesn't match is refused.

## Afterwards

- Write a short review within 5 business days: the cause, what worked, what didn't, and the fixes,
  each with an owner.
- Add a test or an alert for the cause where possible.
- Update `threat-model.md`.

## Contacts to fill in before launch

| Role           | Name | Contact |
| -------------- | ---- | ------- |
| Incident lead  |      |         |
| Technical      |      |         |
| Counsel        |      |         |
| Neon support   |      |         |
| Vercel support |      |         |
| Stripe support |      |         |
