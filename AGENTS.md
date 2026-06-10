# AGENTS.md

Persona inventory for the STX Skills package. Each persona is a versioned markdown file under [`.claude/agents/`](.claude/agents/) consumed by one or more skills at spawn time.

This file is the **portable standard** named in pattern #6 of the 2026 agentic-coding convergence (AGENTS.md + skills + MCP). Teams browsing this repo can map every agent role to its contract without reading skill internals.

## How personas are used

At spawn time, the skill orchestrator:

1. Reads the persona file from `.claude/agents/<name>.md`.
2. Pastes its body verbatim into the sub-agent's prompt.
3. Appends task-specific context (file paths, prior verdicts, the specific failing test).
4. Records the persona version in `wave-state.json.persona_versions` so the wave is reproducible.

Personas are **not** modified by skills at runtime. To evolve a contract, edit the persona file directly and bump its `version` in the YAML frontmatter.

## Inventory

| Persona | File | Role | Consumed by |
|---|---|---|---|
| Analyst | [`.claude/agents/stx-analyst.md`](.claude/agents/stx-analyst.md) | Decomposes feature request into Features with acceptance criteria (works from the orchestrator-run interview transcript; raises open_questions[] for blocking gaps) | `/stx-feature` (Step 2) |
| Architect | [`.claude/agents/stx-architect.md`](.claude/agents/stx-architect.md) | Decomposes Features into tier-tagged Tasks with scope_paths + dependencies (raises open_questions[] for blocking implementation gaps) | `/stx-feature` (Step 3 + soft-cap escalation in Step 6) |
| QA | [`.claude/agents/stx-qa.md`](.claude/agents/stx-qa.md) | Authors failing tests; reruns them; only agent that may edit test files (scaffolding approval via open_questions[] to the orchestrator) | `/stx-feature` (Step 4 + Step 6 test rerun), `/stx-fix` (loop) |
| Reviewer | [`.claude/agents/stx-reviewer.md`](.claude/agents/stx-reviewer.md) | Reads Dev diff between Dev hand-back and QA rerun; emits structured verdict; detects test-file edits + assertion-weakening + SUT mocking as halt offenses | `/stx-feature` (Step 6, between Dev and QA) |
| Coder | [`.claude/agents/stx-coder.md`](.claude/agents/stx-coder.md) | Single-bug implementer for /stx-fix | `/stx-fix` (loop) |
| Dev (universal prelude) | [`.claude/agents/stx-dev-base.md`](.claude/agents/stx-dev-base.md) | QA-Dev contract, scope guardrails, story-style code, hand-back format | `/stx-feature` (Step 5, every Dev) |
| Dev (db tier) | [`.claude/agents/stx-dev-tier-db.md`](.claude/agents/stx-dev-tier-db.md) | DB-tier overlay: migrations, RLS, data-protection guards | `/stx-feature` (Step 5 when `task.tier == "db"`) |
| Dev (service tier) | [`.claude/agents/stx-dev-tier-service.md`](.claude/agents/stx-dev-tier-service.md) | Service-tier overlay: three-tier service pattern, result shapes | `/stx-feature` (Step 5 when `task.tier == "service"`) |
| Dev (api tier) | [`.claude/agents/stx-dev-tier-api.md`](.claude/agents/stx-dev-tier-api.md) | API-tier overlay: thin handlers, Zod, auth, idempotency | `/stx-feature` (Step 5 when `task.tier == "api"`) |
| Dev (ui tier) | [`.claude/agents/stx-dev-tier-ui.md`](.claude/agents/stx-dev-tier-ui.md) | UI-tier overlay: React + Tailwind + shadcn, a11y, browser verification | `/stx-feature` (Step 5 when `task.tier == "ui"`) |

Total: **10 personas** across **2 skills**. Every persona's frontmatter `version` is the **unified package version** — stamped by `npm run build`, never hand-edited (see Versioning policy below).

## Persona frontmatter shape

Every persona file starts with YAML frontmatter:

```yaml
---
name: stx-<role>
description: One-line summary of what this persona does.
version: <semver>
author: STX
role: <analyst|architect|qa|coder|dev-base|dev-tier>
tier: <db|service|api|ui>             # only on tier personas
extends: stx-dev-base                  # only on tier personas
inputs:
  - <what the orchestrator provides at spawn time>
outputs:
  - <what the persona produces>
gates:
  - "<gate name and what it gates>"    # only on gated personas
consumed_by:
  - <skill name and step>
---
```

The version field is the **unified package version** — identical to `package.json` and to every other skill and persona. It is stamped by `node dist/cli/sync-versions.js` (part of `npm run build`); never edit it by hand.

## Conventions

- **One persona, one file.** Don't merge two roles into one persona file even if their contracts overlap by 80%.
- **Tier personas overlay the base persona.** They never duplicate the base contract — they only state what's different.
- **Wikilinks for cross-references.** Use `[[stx-dev-base]]` inside a persona body to reference another persona. The orchestrator resolves these as relative paths.
- **No inline contracts in SKILL.md files.** If a SKILL.md needs to spawn an agent, it loads the persona by file reference. The grep guard for this is:
  ```bash
  grep -rE "Analyst's contract|Architect's contract|QA's contract|Coder's contract|Reviewer's contract" .claude/skills/
  ```
  Should return zero hits (except in `## See also` / `## Personas` reference blocks).

## Versioning policy

**Unified versioning.** The whole package — installer, CLIs, every skill, every persona — ships under one SemVer: the `package.json` version. There is no per-persona cadence.

- A release bumps `package.json` once (via `/stx-version-bump` or the `/stx-pr-merge` bump step). `npm run build` then stamps that version into every skill `SKILL.md` + `catalog.json`, every persona frontmatter, and the README "Current release" line; `npm run check-docs` fails if anything drifted.
- Pick the bump level from the most significant change in the release: PATCH for fixes/wording, MINOR for additive contract or behavior changes, MAJOR for breaking contract changes.
- Never hand-edit a `version:` field — the stamper owns them all.

`wave-state.json.persona_versions` still records the version read from each persona file at wave start; under unified versioning all entries match the release, and a mismatch reveals a drifted install.

## Adding a new persona

1. Create `.claude/agents/<name>.md` with the frontmatter above and a clear contract body.
2. Add a row to the **Inventory** table here.
3. Add `<name>` to `wave-state.json.persona_versions.properties` in `.claude/skills/stx-feature/templates/wave-state.schema.json` (if consumed by `/stx-feature`).
4. Update the consuming skill's SKILL.md to load the persona by reference.
5. Run `npm run build` — the new persona's frontmatter `version` is stamped to the unified package version automatically (set any placeholder; the stamper overwrites it).

## See also

- [`README.md`](README.md) — package overview and install instructions
- [`.claude/skills/stx-feature/SKILL.md`](.claude/skills/stx-feature/SKILL.md) — wave orchestrator
- [`.claude/skills/stx-fix/SKILL.md`](.claude/skills/stx-fix/SKILL.md) — bug-fix orchestrator
- [`.claude/skills/stx-feature/templates/wave-state.schema.json`](.claude/skills/stx-feature/templates/wave-state.schema.json) — canonical wave state including `persona_versions`
