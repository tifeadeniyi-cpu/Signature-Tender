# Integrations marketplace: operations

How the connector framework works, what it needs in each environment, and how to set up the
provider apps that only the account owner can create.

## How it fits together

- **Catalogue:** `packages/core/src/connectors/registry.ts`. Every marketplace entry is listed
  there. `implemented: false` entries are always shown as Coming Soon and cannot be connected,
  whatever an admin sets. An entry becomes `implemented: true` only in the pull request that builds
  and tests it.
- **Availability vs connection status:** availability comes from the registry, an admin override
  (`app_config` key `integrations.availability`, set through `st_integration_set_availability`,
  audited), the `integrations` feature flag and whether the provider's OAuth app credentials are
  configured. A connection's status (`active`, `expired`, `permission_required`, `error`,
  `disabled`) lives on `integration_connections`.
- **No second signing engine:** connectors only link external records (`integration_mappings`) to
  the canonical documents and signing requests, and send through the same services as the website
  and `/api/v1`. Billing is the normal credit ledger: one charge per dispatched request, nothing
  for drafts, syncs or retries.
- **OAuth:** `/api/integrations/oauth/<provider>/start` checks permission and availability, then
  redirects with a random state and a PKCE (S256) challenge. State and verifier travel only in an
  encrypted, httpOnly, 10-minute cookie scoped to the callback path. The callback checks the state
  (constant time), the provider and the signed-in user, exchanges the code on the server and stores
  the tokens encrypted.
- **Tokens:** `integration_credentials`, AES-256-GCM. The key is derived with HKDF from
  `WEBHOOK_SECRETS_KEY` under its own label (`integration-tokens-v1`), so it never equals the
  webhook-secrets key. Tokens are refreshed shortly before expiry in their own transaction, with
  the row locked. Disconnecting revokes the grant at the provider (where supported), deletes the
  tokens, turns off the connection's automations and cancels its waiting jobs. Links and logs stay.
- **Automations and jobs:** an automation (`integration_event_subscriptions`) says "when this
  Signature Tender event happens, run this connector action". A trigger on `webhook_events` (the
  existing event outbox) queues one `integration_sync_jobs` row per matching rule and event; the
  `(rule, event)` idempotency key means the same event can never queue the work twice. Jobs run as
  the member who created the rule or queued the job, so they can only do what that member's role
  allows today.
- **Job runner:** `runIntegrationJobs` claims due jobs with `st_integration_claim_jobs` (skip
  locked; a job stuck running for 10 minutes is reclaimed), runs them, and records the outcome with
  `st_integration_finish_job`. Retryable failures (provider down, rate limited) wait 30s, 1m, 2m...
  capped at 6 hours or the provider's Retry-After, up to the job's attempt limit (default 6).
  Managers can retry a failed job or cancel a waiting one.
- **When jobs run:** after the actions that queue them (`kickIntegrationJobs`) and on the daily
  cron (`/api/cron/webhooks`). The developer API platform work adds a shared background queue;
  the integration runner will be registered as one of its consumers, not duplicated.
- **Health:** every provider call updates `last_success_at` / `last_failure_at` and the error
  code. A 401 or a refused refresh marks the connection Expired; a 403 marks Permission required.
  A connection only shows Connected after a real provider call succeeded.
- **Logs:** `integration_activity` holds sanitised entries. Keys that could hold tokens, secrets,
  emails, or document contents are dropped, and bearer tokens, long secrets and email addresses
  are scrubbed from messages.

## Permissions

| Permission | Who has it by default | Allows |
|---|---|---|
| `integrations.manage` | Owner, Admin, API Developer | Connect workspace-wide accounts, manage any connection, create automations, retry jobs |
| `integrations.use` | Owner, Admin, Manager, Editor, API Developer | Use workspace connections, connect a personal account |
| `integrations.view_logs` | Owner, Admin, API Developer | Read all of the workspace's integration activity and jobs |

Members without `view_logs` still see their own activity. Partner (Beam Artist, Jectstack) and
Slack connections still need both `integrations.manage` and `api.manage`, as before. Everything is
enforced in the database (row-level security), not only in the UI.

## Environment

| Variable | Needed for |
|---|---|
| `WEBHOOK_SECRETS_KEY` | Required in production before any OAuth connection (token encryption). Same value webhooks already need. |
| `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` | Google Drive. Optional: falls back to `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Sign in with Google) if that client has the Drive API and redirect added. |
| `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` | HubSpot. |
| `CRON_SECRET` | The cron route that runs due jobs. |

Feature flag `integrations` (on in every environment by default) can switch OAuth connectors off
without a deploy. Connectors still need to be built and configured to connect.

Environment changes in Vercel need a redeploy.

## Provider setup (owner)

Redirect URIs use the site URL (`BETTER_AUTH_URL`), for example
`https://signaturetender.com/api/integrations/oauth/google_drive/callback`.

### Google Drive

1. In Google Cloud Console, open the project used for Sign in with Google (or create one).
2. APIs & Services → Library → enable **Google Drive API** (and **Google Picker API** for the file
   picker).
3. OAuth consent screen → add the scope `https://www.googleapis.com/auth/drive.file`. This scope
   only reaches files the person picks or the app creates, and Google treats it as non-sensitive,
   so it does not need Google's restricted-scope security assessment. Keep the app In production
   with the privacy policy and terms URLs filled in.
4. Credentials → the Web OAuth client → add the authorized redirect URI
   `https://signaturetender.com/api/integrations/oauth/google_drive/callback`.
5. Either reuse that client (nothing else to add) or create a separate one and set
   `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET` in Vercel. Redeploy.

### HubSpot

1. Create a HubSpot developer account and a **public app** (Apps → Create app).
2. Auth → redirect URL `https://signaturetender.com/api/integrations/oauth/hubspot/callback`.
3. Scopes: `oauth`, `crm.objects.deals.read`, `crm.objects.deals.write`,
   `crm.objects.contacts.read`, `crm.objects.companies.read`, `files`.
4. Copy the client ID and secret into `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET` in Vercel.
   Redeploy. Use a developer test account first.

### Zapier

1. Create a Zapier developer account (developer.zapier.com) and a new private integration.
2. The integration definition (actions, triggers, auth) comes in the Zapier phase. It uses API
   keys first; OAuth follows when the developer API platform adds it.
3. Zapier reviews public integrations before they are listed. The marketplace keeps Zapier as
   Coming Soon until Zapier approves it.

## Staff

Staff can pause or hide a built connector (available, beta, coming soon, maintenance,
unavailable) and see connection and job counts per provider. Both go through database functions
that check platform staff and audit changes. Staff never see customer tokens, accounts or
agreements through these tools.
