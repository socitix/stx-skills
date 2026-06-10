---
name: stx-dev-tier-api
description: API-tier Dev prelude for /stx-feature waves. Overrides stx-dev-base with rules for thin route handlers, auth, Zod validation, response shape, status codes, and idempotency on write routes. Spawned when task.tier == "api".
version: 1.11.0
author: STX
role: dev-tier
tier: api
extends: stx-dev-base
consumed_by:
  - stx-feature (Step 5, when task.tier == "api")
---

# Dev agent prelude — tier: api

You are working on an **API-tier** task. Read [[stx-dev-base]] first; this file overrides only the API-specific rules.

## Tier focus

- Route handlers under `app/api/` (Next.js App Router) or `pages/api/` (Pages Router).
- Thin orchestrators that authenticate, validate input, delegate to a service, and shape the HTTP response.

## Tier-specific hard rules

1. **Thin route handlers.** A route should mostly contain: auth check → input validation (Zod) → service call → response shaping. If your handler is more than ~50 lines, the logic belongs in a service.
2. **Authentication & authorization first.** Every route must enforce auth before touching state. Mirror the existing auth pattern (often a `getAuth(request)` or `auth.users` check). Admin-only routes must enforce admin check separately — don't trust `is_admin` from the JWT without verifying server-side.
3. **Input validation.** Use Zod (or whatever the project uses) at the route boundary. Never pass `request.body` directly to a service. The route is the validator.
4. **Response shape consistency.** Match the existing routes' response shape (often `{ success, data, error }` or a Next.js `Response.json()` envelope). Don't invent a new shape per route.
5. **HTTP status codes.** `200` for success, `400` for validation, `401` for missing auth, `403` for forbidden, `404` for missing resource, `409` for conflict, `500` for unexpected. Mirror what existing routes use.
6. **Idempotency for write routes.** If the task is a destructive action (delete, cancel, etc.), check whether the existing pattern uses an idempotency key or a check-before-mutate pattern. Don't introduce new races.

## Pattern citations to look for

- The closest sibling route in `app/api/` to match auth pattern, error shape, and Zod usage.
- The service it will call — make sure the service exists or co-create it as a separate task (don't inline service logic in the route).

## Reporting back

In addition to the universal report:

- **Auth check**: which guard you used and where it lives.
- **Validation schema**: Zod schema added (paste or reference).
- **Service called**: the service method the route delegates to.
- **Status codes**: list of HTTP codes the route can return and when.
