# Architecture

## Principles

1. Every tenant-scoped read or write runs through `withActor()` in `packages/db`, which binds the user id for Postgres row-level security inside a transaction.
2. The web app connects as `st_app`, a role with no superuser or BYPASSRLS rights. Migrations run as the owner role.
3. Pages and routes call services in `packages/core`; services validate input with Zod, check permissions, change data and write an audit event in the same transaction.
4. Prices, limits, feature flags and legal text versions live in the database (`prices`, `subscription_plans`, `app_config`, `feature_flags`), not in code.
5. Unfinished features are shown as unavailable, never simulated.

## Modules (current and planned)

| Module                                         | Location                                                           | Phase |
| ---------------------------------------------- | ------------------------------------------------------------------ | ----- |
| Identity and authentication                    | Better Auth in `apps/web/src/lib/auth.ts`                          | 1     |
| Workspaces and permissions                     | `packages/core/src/workspaces.ts`, `permissions.ts`, RLS migration | 1     |
| Audit                                          | `packages/core/src/audit.ts`, `audit_events` (append-only)         | 1     |
| Configuration and pricing                      | `packages/core/src/config.ts`                                      | 1     |
| Documents, storage, PDF processing             | `packages/core` + `apps/worker`                                    | 2     |
| Recipients, fields, signing sessions, evidence | `packages/core`, `packages/signing-engine`                         | 3     |
| Billing and credits                            | `packages/core` + Stripe                                           | 4     |
| Public API, webhooks, integrations             | `apps/web/src/app/api/v1`                                          | 7     |

## Row-level security model

- `workspaces`: visible to active members (and to the creator, so the first insert can return its row). Updates need `workspace.manage`.
- `workspace_memberships`: visible to members of the same workspace. Inserts need `team.manage`, except the creator's first owner membership.
- `audit_events`: insert by members as themselves; read with `audit.view` or your own events. No update or delete grant.
- `user_profiles`: owner only.
- Helper functions `st_is_member` and `st_has_permission` are `SECURITY DEFINER` with a fixed `search_path` to avoid policy recursion.

## Environments

`APP_ENV` is one of development, test, staging, production. Non-production environments show a banner warning against real documents. The `production_signing` feature flag stays off until every release gate passes.
