# Integrations Marketplace

Customer-facing marketplace at `/app/integrations` (Discover, Connected Apps, Automations,
Activity & Sync Logs, and a details page per app). The Developer Portal (API keys, webhooks,
API docs) stays under Settings, Developers and `/app/api-docs`.

Integrations never create signing data of their own. Imports go through
`createDocumentFromUpload`; sends, billing and certificates are the normal document flow; sync jobs
read the finished files the signing engine produced.

## What is live

| App                                                                                                       | Status                 | How it works                                                                      |
| --------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| Google Drive                                                                                              | Beta (when configured) | OAuth (`drive.file`), Google Picker import, auto-save of signed PDF + certificate |
| Beam Artist, Jectstack                                                                                    | Available              | Partner API key + webhook (unchanged)                                             |
| Slack                                                                                                     | Available              | Incoming webhook (unchanged)                                                      |
| Zapier, HubSpot, Make, Pipedrive, Jotform, Microsoft 365, Salesforce, Shopify and the rest of the roadmap | Coming Soon            | Catalogue entry only. No Connect button anywhere.                                 |

Availability and connection state are separate (`resolveAvailability`, `connectionState` in
`packages/core/src/integration-catalog.ts`):

- **Coming Soon**: no connector code (`available: false`).
- **Unavailable**: connector exists but this deployment lacks provider credentials.
- **Maintenance**: staff turned the feature flag off (`integration_google_drive`).
- **Beta / Available**: can be connected.

## Architecture

- `integration_connections`: one per provider per workspace, with account label, scopes, settings,
  health (`last_success_at`, `last_error_at`, `last_error`) and status
  (`active | expired | error | disabled`).
- `integration_credentials`: OAuth tokens sealed with AES-256-GCM under the server key
  (`WEBHOOK_SECRETS_KEY`). Never selected by listing queries, never logged, never sent to the
  browser except the short-lived access token the Google Picker requires.
- `integration_mappings`: links a document to external records (a Drive file).
- `integration_jobs`: queued sync work and immediate actions; this is also the Activity log.
  Details are sanitized (ids, names, folder), never tokens or document contents.
- SECURITY DEFINER functions (migration 0025): `st_integration_enqueue` turns
  `document.finalized` outbox events into jobs (one per connection, operation and event),
  `st_integration_claim` (SKIP LOCKED), `st_integration_finish` (exponential backoff 1 min to
  6 h, stop after `integrations.max_attempts`, default 6; permanent errors stop at once),
  `st_integration_store_tokens`, `st_integration_retry`, `st_integration_cancel`.
- The worker (`runIntegrationJobs`) runs after any request that kicks webhooks and from the daily
  cron. Uploads carry an app property with the job id, so a retry after a lost response finds the
  existing file instead of uploading a duplicate.
- OAuth (`integration-oauth.ts`): state + PKCE verifier in a sealed httpOnly cookie scoped to
  `/api/integrations`, valid 10 minutes, bound to the member who started the flow. Routes:
  `/api/integrations/[provider]/connect` and `/callback`.

Permissions (enforced in the database): connect, configure and disconnect need
`integrations.manage`; importing needs `documents.create`; the activity log needs
`integrations.manage` or `audit.view`.

Billing: imports create ordinary drafts, so sending is charged exactly like any other send (once,
on dispatch). Sync jobs and retries are never charged. Imported documents carry
`external_source = 'google_drive'` for attribution; it also flows into webhook payloads.

## Google Drive configuration

The Drive connector reuses the Sign in with Google OAuth client.

1. Google Cloud project `signature-tender`: enable **Google Drive API** and **Google Picker API**.
2. OAuth client "Signature Tender Web": add the authorized redirect URI
   `https://signaturetender.com/api/integrations/google_drive/callback`.
3. Google Auth Platform, Data access: add the `.../auth/drive.file` scope (non-sensitive; no
   verification needed).
4. Create an API key restricted to HTTP referrer `https://signaturetender.com/*` and to the
   Google Picker API.
5. Vercel environment variables (Production):
   - `GOOGLE_PICKER_API_KEY`: the API key from step 4 (a browser key, not secret, but restricted).
   - `GOOGLE_CLOUD_PROJECT_NUMBER`: the project number (the digits before the dash in the client ID).
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and `WEBHOOK_SECRETS_KEY` are already set.

Without these the card shows **Unavailable**.

## Operations

- Turn Google Drive off for everyone: set feature flag `integration_google_drive` to false
  (shows **Maintenance**; queued jobs stay queued).
- A connection whose refresh token Google rejects becomes **Connection Expired**; queued saves
  fail with `auth_revoked` and can be retried from the Activity log after reconnecting.
- Disconnecting revokes the token at Google, deletes stored tokens and cancels queued saves.
  Documents and signing evidence are never removed.

## Next phases

1. Zapier: REST-hook subscribe/unsubscribe endpoints in `/api/v1`, then a Zapier Platform app
   (auth, triggers for request events, actions for send / send from template). Stays Coming Soon
   until Zapier publishes it.
2. HubSpot: needs a HubSpot developer account and public app (client id/secret, scopes
   `crm.objects.deals.read`, `crm.objects.contacts.read`, `files`), then deal picker, template
   field mapping and attaching the signed PDF to the deal.
3. Licensed provider logos in `public/integrations/` (cards show monograms until then).
