# Signature Tender

**Send. Sign. Pay Once.** An electronic signature platform where senders pay per signing request, with no subscription required.

> Status: Phase 1 (foundation). Signing, payments and document upload are not live yet. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Repository layout

| Path            | What it is                                                                         |
| --------------- | ---------------------------------------------------------------------------------- |
| `apps/web`      | Next.js app: marketing site, auth, dashboard, settings                             |
| `packages/db`   | Drizzle schema, SQL migrations (including row-level security), reference data seed |
| `packages/core` | Domain services: permissions, workspaces, profile, audit, pricing config           |
| `docs/`         | Architecture, progress, security and release checklists                            |

## Local setup

Requirements: Node 22+, pnpm 10, PostgreSQL 16.

```bash
pnpm install
# Create roles and databases (owner runs migrations; st_app is what the app uses, so RLS applies)
psql -U postgres -c "create role st_owner login superuser password 'st_owner';" \
  -c "create role st_app login password 'st_app';" \
  -c "create database signature_tender owner st_owner;" \
  -c "create database signature_tender_test owner st_owner;"
cp .env.example apps/web/.env.local   # then edit values
DATABASE_URL_OWNER=postgres://st_owner:st_owner@localhost:5432/signature_tender pnpm db:migrate
DATABASE_URL_OWNER=postgres://st_owner:st_owner@localhost:5432/signature_tender pnpm db:seed
pnpm dev
```

Without `RESEND_API_KEY`, verification and reset emails are written as JSON files to `apps/web/.mail/` instead of being sent.

## Checks

```bash
pnpm typecheck && pnpm lint
pnpm test        # unit + tenant-isolation tests (needs the test database)
pnpm build && pnpm test:e2e   # Playwright end-to-end
```

## Brand assets

The logo family (Midnight Navy and Champagne Gold) lives in `apps/web/public/branding/signature-tender/` and is referenced only through `apps/web/src/lib/brand-assets.ts`. Files were recoloured from the approved burgundy masters without changing the artwork; the masters are raster only, so vector (SVG) versions remain a separate design task.
