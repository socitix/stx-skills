---
name: stx-dev-tier-service
description: Service-tier Dev prelude for /stx-feature waves. Overrides stx-dev-base with rules for the three-tier service pattern, result shapes, and error handling. Spawned when task.tier == "service".
version: 1.11.0
author: STX
role: dev-tier
tier: service
extends: stx-dev-base
consumed_by:
  - stx-feature (Step 5, when task.tier == "service")
---

# Dev agent prelude — tier: service

You are working on a **service-tier** task. Read [[stx-dev-base]] first; this file overrides only the service-specific rules.

## Tier focus

- Pure (or near-pure) business logic.
- Implementations of the three-tier service pattern: `lib/services/server/`, `lib/services/client/`, `lib/services/shared/` (see `~/.claude/CODING_REFERENCE.md`).
- Functions that return `{ success: boolean, data?: T, error?: string }` result shapes.

## Tier-specific hard rules

1. **Three-tier separation.** If the project follows the pattern:
   - Server-only logic (DB access, secrets, server-side SDKs) → `lib/services/server/`.
   - Client-only logic (browser-only APIs, React state helpers) → `lib/services/client/`.
   - Pure helpers usable from both → `lib/services/shared/`.
   Do not reach across tiers. Server services may import shared; client services may import shared; nothing imports across server↔client.
2. **Result shape.** Service methods return `{ success, data?, error? }`. Throw only for truly unexpected errors. Use early returns for validation and expected conditions.
3. **Error handling pattern (from `~/.claude/CLAUDE.md`).** Five sections per method:
   1. Early validation returns.
   2. Valid non-error early returns ("no work to do").
   3. Main execution flow.
   4. Single happy-path return.
   5. Catch block for unexpected errors only.
4. **No business logic in API routes.** If you're tempted to inline logic in `app/api/`, stop — that's the `api` tier's territory. Make a thin caller.
5. **Pure means pure.** If a function takes IO (network, disk, randomness), declare it. Mark pure helpers in JSDoc.

## Pattern citations to look for

- The closest sibling service in `lib/services/server/` or `lib/services/shared/`. Match its file shape, exports, and test style.
- An existing test (`*.test.ts` or `e2e/*.spec.ts`) that exercises a service method.

## Reporting back

In addition to the universal report:

- **Tier confirmation**: which of server / client / shared this lives in and why.
- **Result-shape compliance**: confirm `{ success, data, error }` or document deviation.
- **Imports across tiers**: list any cross-tier imports and justify.
