---
name: stx-dev-tier-ui
description: UI-tier Dev prelude for /stx-feature waves. Overrides stx-dev-base with rules for React + Tailwind + shadcn, a11y, mobile-first responsive, graceful form validation, destructive-action confirmations, and browser verification. Spawned when task.tier == "ui".
version: 1.11.0
author: STX
role: dev-tier
tier: ui
extends: stx-dev-base
consumed_by:
  - stx-feature (Step 5, when task.tier == "ui")
---

# Dev agent prelude — tier: ui

You are working on a **UI-tier** task. Read [[stx-dev-base]] first; this file overrides only the UI-specific rules.

## Tier focus

- React components in `components/` and pages in `app/`.
- Tailwind utilities + the project's component library (commonly shadcn/ui on Radix primitives).
- Forms (often React Hook Form + Zod), state via React state / context, no inline business logic.

## Tier-specific hard rules

1. **Reuse the component library.** Before writing a new component, search for an existing one (`components/ui/`, `components/<area>/`). Use the existing button, dialog, table, etc. — do not introduce a parallel implementation.
2. **shadcn/ui patterns.** If the project uses shadcn, use its variants and slots. Avoid Radix-direct imports when a shadcn wrapper exists.
3. **No business logic in components.** Components call hooks; hooks wrap services; services do the work. If you're tempted to put a fetch / mutation inline in the component, stop — that's a service tier or hook responsibility.
4. **Accessibility.** Every interactive element needs a label, role, and keyboard support. Confirm tab order, focus-visible, escape-to-close on modals. Mirror the existing components' a11y patterns.
5. **Mobile-first responsive.** Tailwind classes follow mobile-first; add `md:` / `lg:` breakpoints for larger screens, not the other way around.
6. **Form validation must not crash.** Per project rule: form validation must fail gracefully — never let a validation exception unmount the page.
7. **Destructive actions need confirmation.** Any UI affordance that deletes / cancels / modifies in a way the user can't easily undo must show a confirmation dialog with clear text about what will happen.

## Browser verification

If `use_browser_mcp == true` (declared in the orchestrator's prompt), use Chrome DevTools or Playwright MCP after your change to:

1. Navigate to the relevant route.
2. Drive the user flow that the failing test asserts.
3. Confirm the acceptance criteria visually.
4. Capture a screenshot (or console messages) as evidence.

Do NOT skip this if the task is user-visible.

## Pattern citations to look for

- The closest sibling component for layout, props shape, and styling.
- The closest sibling hook in `hooks/` for data-fetching pattern.
- An existing modal/dialog for confirmation flows.

## Reporting back

In addition to the universal report:

- **Components touched / added**: paths.
- **Reused library components**: which shadcn/Radix primitives you used.
- **A11y notes**: tab order, ARIA labels, focus behavior.
- **Browser confirmation**: brief description of what you verified (and screenshot path if captured).
