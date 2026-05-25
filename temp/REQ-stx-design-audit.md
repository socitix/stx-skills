# Requirement: `stx-design-audit` skill

**Status:** Draft requirement — implementation deferred to a separate session.
**Author:** Sudipto (drafted via Claude)
**Date:** 2026-05-18
**Implementation target:** `stx-skills` repo (per skills-package convention). User wrote "stx-socitix" — flagged as a likely typo since skills live in `stx-skills`; confirm before implementing.

---

## Problem

Every project Sudipto runs should have a **valid design system** discoverable at conventional paths so that:

- Any Claude agent (or human contributor) working on UI code finds the canonical tokens without guessing.
- Hex values, spacing, motion timings come from one place — not scattered through components.
- Non-obvious design choices are captured as ADRs, not lost.

Today this is enforced only by convention (and by the new global rule in `~/.claude/CLAUDE.md`). Drift is inevitable without a tool. A skill should be able to audit a project and either:

- Confirm the design system is valid, or
- Surface what's missing / non-standard and offer to fix it.

Canonical structure (defined in `~/.claude/CLAUDE.md` → "Follow The Project's Design System"):

```
docs/
  design-system.md                  # Prose: tokens + patterns + a11y + motion
  design/
    README.md
    patterns/
      README.md
      <slug>.md                     # e.g. home.md
    decisions/
      README.md
      NNNN-<title>.md               # ADRs, append-only
    assets/
      README.md
tailwind.config.{ts,js}              # Tokens as code (colors, spacing, motion)
src/styles/tokens.css                # Optional: CSS custom properties
```

`socitix` is the **reference implementation** of this structure (as of branch `chore/consolidate-design-docs`). Use it as the gold standard.

---

## Goals

1. **Detect** whether a project has a valid design system at the canonical paths.
2. **Diagnose** specific issues if partially valid.
3. **Suggest + scaffold** the canonical structure if missing or non-standard.
4. **Surface** non-standard entries (e.g. `DESIGN_SPECS.md` at root, design files outside `docs/design/`, hex values in components that should be tokens).
5. **Report** results in a terse terminal summary plus an optional HTML artifact (mirroring `stx-worktree-report`).

## Non-goals

- Generating the *content* of the design system. The skill scaffolds structure with READMEs and TODOs; humans fill in tokens.
- Visual regression testing.
- Linting actual rendered output (Lighthouse, axe, etc.) — out of scope.
- Migrating a project from one design system framework to another (e.g. Bootstrap → Tailwind).

---

## Skill name and surface

**Proposed name:** `stx-design-audit`

Matches existing skill prefix convention (`stx-checkin`, `stx-feature`, `stx-fix`, `stx-image`, `stx-worktree-report`). "Audit" is more accurate than "check" because the skill produces a report and recommends actions, not just a pass/fail.

**Alternatives considered:**

- `stx-design-check` — leaner, but downplays the suggestion/scaffold step.
- `design-system-validate` — drops `stx-` prefix; inconsistent with the rest of the package.
- `stx-design-system` — too vague (verb-less).

**Invocation:** `/stx-design-audit [--fix] [--report]`

| Flag | Behavior |
| --- | --- |
| (none) | Read-only audit; prints summary to terminal. |
| `--fix` | Interactive — for each missing or non-standard item, prompt and apply. |
| `--report` | Writes `docs/temp/design-audit-<YYYYMMDD>.html` (Mermaid + file diffs) using the same template family as `stx-worktree-report`. |

Must work in **main** or **worktree** — read-only audit is safe on main; `--fix` follows the global worktree rule (refuses to write on main without explicit override).

---

## Validation rules

### Level 1 — Required files (hard failure if missing)

| Check | Pass condition |
| --- | --- |
| `docs/design-system.md` exists | File present and non-empty |
| `docs/design/README.md` exists | File present |
| `docs/design/patterns/` exists | Directory present with at least `README.md` |
| `docs/design/decisions/` exists | Directory present with at least `README.md` |
| `docs/design/assets/` exists | Directory present with at least `README.md` |
| Token source exists | `tailwind.config.{ts,js,mjs,cjs}` OR `src/styles/tokens.css` |

### Level 2 — Content sanity (warning if violated)

| Check | Warn condition |
| --- | --- |
| `design-system.md` declares core colors | Searches for `--color-primary` / `colors.primary` / `Primary` heading |
| `design-system.md` declares typography scale | Searches for headings like "Type Scale" or `font-size:` blocks |
| `design-system.md` declares motion guidelines | Searches for headings like "Motion" or `transition` blocks |
| Tailwind tokens match prose | Cross-check: every named color in `design-system.md` exists in `tailwind.config.*` |
| ADR numbering is sequential | `NNNN-` prefixes form a contiguous sequence starting at `0001` |

### Level 3 — Non-standard entries (surface, do not fail)

| Check | Surface condition |
| --- | --- |
| Stray design docs | Any `*DESIGN*.md` or `*design-spec*.md` at the repo root (should be in `docs/design/patterns/`) |
| Hardcoded hex in components | Grep `src/**/*.{tsx,jsx,ts,js,css}` for `#[0-9a-fA-F]{6}` outside of `tailwind.config.*` and `src/styles/` |
| Unused token | Any color defined in `tailwind.config.*` not referenced anywhere in `src/` |
| Pattern referencing missing token | A `docs/design/patterns/*.md` referencing `bg-foo` where `foo` is not in `tailwind.config.*` |
| ADR mutation | Git history shows edits to an existing ADR (ADRs are append-only) |

### Level 4 — Suggestions (informational)

- No ADR yet despite non-trivial design system → suggest authoring `0001-*.md`.
- `assets/` is empty → suggest adding reference screenshots.
- Pattern file lacks the standard sections (Overview / Composition / Tokens / Variants / Rationale).

---

## User experience

### Terminal output

```
$ /stx-design-audit

Design system audit — socitix
─────────────────────────────────────────────
✓ docs/design-system.md
✓ docs/design/README.md
✓ docs/design/patterns/ (1 pattern: home.md)
✓ docs/design/decisions/ (1 ADR: 0001-home1-conversion-focused.md)
✓ docs/design/assets/ (empty — see suggestions)
✓ tailwind.config.js (4 colors, 7 animations)

⚠ Warnings (2):
  • src/components/header-large/index.tsx:14 — hardcoded #1F6C98, suggest token `custom-blue`
  • Token `custom-blue` defined in tailwind.config.js but never referenced

ℹ Suggestions (1):
  • docs/design/assets/ is empty — consider adding a reference screenshot

Result: VALID with 2 warnings.

Re-run with --fix to interactively resolve. --report for HTML output.
```

### `--fix` interactive flow

For each finding, prompt:

```
⚠ src/components/header-large/index.tsx:14 — hardcoded #1F6C98
  → Replace with `bg-custom-blue` Tailwind class?
  [y] apply  [n] skip  [a] apply all  [q] quit
```

### `--report` artifact

Single-file HTML using the `stx-worktree-report` template family (see `.claude/skills/gen-worktree-report/`):

- Executive summary (valid/invalid + counts)
- Each Level 1–4 finding with file:line links
- Mermaid diagram of the canonical structure vs the actual structure
- Side-by-side diff preview for any `--fix` candidates

---

## Scaffold mode (when nothing exists)

If Level 1 is entirely empty:

```
No design system found at canonical paths.

Scaffold the canonical structure?
  docs/design-system.md            (boilerplate with placeholders)
  docs/design/README.md
  docs/design/patterns/README.md
  docs/design/decisions/README.md
  docs/design/assets/README.md

  tailwind.config.js               (will not overwrite if exists)
                                   (otherwise creates with empty `colors`, `spacing`)

[y] scaffold  [n] cancel
```

Scaffold templates should match what `socitix` has on branch
`chore/consolidate-design-docs` — copy verbatim with project name swapped.

---

## Edge cases to handle

- **Monorepo** — accept `--root <path>` or auto-detect `docs/design-system.md` per workspace package.
- **No `docs/` folder at all** — offer to create it as part of scaffold.
- **Custom design system framework** (vanilla-extract, styled-system, etc.) — out of scope for v1; document as future enhancement.
- **`.gitignore`d design files** — warn (likely a mistake).
- **Symlinked design system** (shared across projects) — follow the symlink and validate at target.

---

## Out-of-scope (v1)

- Auto-generating tokens from the prose design-system.md (we'd need a parser).
- Pushing tokens from Tailwind config back into Figma.
- Detecting accessibility violations.
- CI integration / GitHub Actions wrapper.

---

## Acceptance criteria

A v1 implementation is done when:

- [ ] `/stx-design-audit` runs on `socitix` (post-merge of `chore/consolidate-design-docs`) and reports **VALID**.
- [ ] `/stx-design-audit` runs on a sibling project lacking the structure (e.g. `findependence` if it doesn't have one yet) and offers to scaffold.
- [ ] `/stx-design-audit --fix` correctly replaces a planted hex value with a Tailwind token reference.
- [ ] `/stx-design-audit --report` produces a single-file HTML artifact in `docs/temp/`.
- [ ] Skill metadata, README, and `SKILL.md` follow the same pattern as `stx-checkin` and `stx-worktree-report`.
- [ ] Read-only audit is safe on `main`; `--fix` refuses to write without a worktree.

---

## Open questions for the implementation session

1. **Implementation home** — confirm: `stx-skills/src/skills/stx-design-audit/` (matches sibling skills)? User's note said "stx-socitix" which is presumed to be a typo.
2. **Token cross-check** — how strict should the prose-vs-Tailwind reconciliation be? Strict (every named color must exist in both) or lenient (warn only)?
3. **Hex detection** — limit to `src/` or include `app/` and `pages/` too? Probably include all, but worth confirming.
4. **HTML report template** — reuse the `gen-worktree-report` Mermaid template or fork a slimmer one?
5. **Should the skill check for an `~/.claude/CLAUDE.md`-style "design system rule"** in the project CLAUDE.md (if one exists)? Optional v1 enhancement.

---

## References

- `~/.claude/CLAUDE.md` → "CRITICAL RULE: Follow The Project's Design System" (the rule this skill enforces).
- `socitix` reference layout: branch `chore/consolidate-design-docs`.
- Sibling skills for style/structure: `stx-checkin`, `stx-worktree-report`, `stx-image`.
