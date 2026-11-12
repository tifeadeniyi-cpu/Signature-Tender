# Database migrations

Migrations live in `packages/db/migrations` and run on every Vercel build (`pnpm --filter @st/db migrate`).

## How Drizzle decides what to run

Drizzle applies a migration only if its journal timestamp is newer than the newest migration recorded
in `drizzle.__drizzle_migrations`. It does not compare names. So if a database records a migration
from another branch with a later timestamp, older migrations from the main line are skipped without
an error.

This happened on 2026-11-12. A preview of an unmerged branch ran its own `0012`/`0013` against the
shared database, and the Phase 7 deploy then skipped `0012_api` and `0013_api_rls`.

## The guard

After migrating, `runMigrations` checks that every journal entry is recorded, either by its timestamp or
by its file hash. If any entry is missing, the build fails with the skipped timestamps. Nothing is
half-applied, because each skipped migration simply never ran.

## Fixing a skipped migration

1. In `packages/db/migrations/meta/_journal.json`, give the skipped entries new `when` values. They
   must be later than the newest recorded timestamp and earlier than the next entry, and stay in order.
2. Run the migrations locally against a copy of that state, then against a fresh database.
3. Push. The next build applies the skipped migrations.

## Rules that prevent it

- Previews must not use the production database. Give the Preview environment its own Neon branch
  (see `infrastructure-review.md`).
- Before merging a branch with migrations, regenerate them on top of `main` so their numbers and
  timestamps come after everything already on `main`.
- Never edit a migration that has been applied anywhere shared. Add a new one.
- Destructive migrations (dropping columns or tables, rewriting data) need the owner's approval and a
  Neon snapshot first.
