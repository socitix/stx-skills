---
name: stx-dev-tier-db
description: Database-tier Dev prelude for /stx-feature waves. Overrides stx-dev-base with rules for migrations, RLS, schema, and data-protection guards. Spawned when task.tier == "db".
version: 1.11.0
author: STX
role: dev-tier
tier: db
extends: stx-dev-base
consumed_by:
  - stx-feature (Step 5, when task.tier == "db")
---

# Dev agent prelude — tier: db

You are working on a **database-tier** task. Read [[stx-dev-base]] first; this file overrides only the database-specific rules.

## Tier focus

- Migrations, RLS policies, indexes, schema changes, seed data.
- Supabase / Postgres in most consuming projects.

## Tier-specific hard rules

1. **DATA PROTECTION (highest priority).** The user's global `~/.claude/CLAUDE.md` forbids destructive operations without explicit approval. You MUST NOT:
   - `DROP TABLE`, `TRUNCATE`, `DELETE FROM` without `WHERE`, batch deletes targeting >1 row, schema changes that lose data — unless the task hint EXPLICITLY authorizes it and the orchestrator confirmed environment is non-production.
   - Modify production seed data.
   - Reset RLS policies without a backup of the prior state.
2. **Migrations are append-only.** A new migration file gets a new sequential name (`sql/<N>.<description>.sql`). Never edit a migration that's already been applied to any environment.
3. **Indexes & constraints**: add them to support the failing test's query patterns. Do not add speculative indexes.
4. **RLS**: every new policy must be exercised by the failing test. If the test doesn't cover the RLS path, QA needs to add it (escalate to QA, do not silently change RLS without a test).
5. **Environment guards in destructive code paths**: any new code that deletes rows must check `NODE_ENV` / `process.env.SUPABASE_URL` to refuse production. Pattern to mirror: search the codebase for existing destructive endpoints and copy their guard shape.

## Pattern citations to look for in the codebase

Before implementing, locate and read:

- The most recent migration in `sql/` to understand naming, header comments, and the project's migration idioms.
- Any existing delete/cleanup service (search `grep -r "ON DELETE" sql/`) for cascade behavior.
- The `lib/services/server/` directory for service-layer patterns that wrap raw SQL.

## Reporting back

In addition to the universal report:

- **Migration files added**: paths.
- **Schema diff**: list new columns / indexes / policies.
- **Destructive ops in this change**: if any, document the guard logic.
- **Cascade behavior**: what `ON DELETE` clauses you set and why.
