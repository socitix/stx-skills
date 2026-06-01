# CLAUDE.md — stx-skills project guidance

Project-specific instructions for working in this repo. Read this in addition
to the user's global `~/.claude/CLAUDE.md` (data protection, worktree-first,
no commits without approval, design system, etc.). Global rules win on
conflict; this file adds project-shape rules they don't cover.

## What this repo is

`stx-skills` ships a collection of [Claude Code](https://claude.com/claude-code)
skills (`.claude/skills/<name>/`) and personas (`.claude/agents/<name>.md`),
plus a TypeScript installer (`src/cli/install.ts` → `dist/cli/install.js`) and
a handful of skill-bound CLIs (`src/skills/*.ts`). Every shipped skill is
described in three places — its `SKILL.md`, its `catalog.json`, and the
generated help docs. Those three must stay in sync.

GitHub Pages is configured to serve from the repo root (branch `main`, path
`/`). The published URL is https://socitix.github.io/stx-skills/ and the entry
point is `index.html` at the repo root. That `index.html` is a **generated
artifact** — see the docs pipeline below.

## CRITICAL RULE: Update help docs whenever a skill changes

The single source of truth for user-facing skill documentation is
`.claude/skills/<name>/catalog.json` (one per shipped skill). Both
`/stx-help` (terminal listing) and `/stx-help-html` (published HTML
walkthrough at https://socitix.github.io/stx-skills/) are **generated** from
those catalogs by `npm run build`.

**This means: whenever you modify any of the following for an existing
shipped skill, you must also update its `catalog.json` and run
`npm run build`:**

- `version` field in `SKILL.md` frontmatter
- The skill's one-line `description` (frontmatter)
- New or removed CLI flags / invocations
- Renamed / added / removed sub-commands
- Major behavior changes that affect "Use when" / "Don't use when" guidance
- Iteration caps, halt conditions, or artifacts produced
- The skill's zone (main-bound / worktree-bound / any-bound)

Hand-editing `.claude/skills/stx-help/SKILL.md` between its `<!-- BEGIN AUTO -->`
and `<!-- END AUTO -->` markers, or `.claude/skills/stx-help-html/help.html`
between its `<!-- BEGIN AUTO -->` / `<!-- END AUTO -->` markers, or the
repo-root `index.html` is **always wrong** — those regions are overwritten on
every `npm run build`. Change the upstream `catalog.json` instead.

### The build pipeline

```
.claude/skills/<name>/catalog.json   ← source of truth (one per skill)
        │
        │  npm run build  =  tsc && node dist/cli/generate-help.js
        ▼
.claude/skills/stx-help/SKILL.md        (between AUTO markers)
.claude/skills/stx-help-html/help.html  (between AUTO markers)
index.html                              (repo root — mirror of help.html)
        │
        │  GitHub Pages: branch=main, path=/
        ▼
https://socitix.github.io/stx-skills/
```

### Before any commit that touches a skill

1. **Edit** `SKILL.md` and `catalog.json` together. The version field in both
   must match; the build will fail if they drift.
2. **Run** `npm run build`. This regenerates the three generated outputs
   listed above.
3. **Stage all of it** — `SKILL.md`, `catalog.json`, and the three
   regenerated files — in the same commit. A PR that bumps `SKILL.md`
   without the matching `catalog.json` + regenerated outputs will fail
   the next `npm run check-docs`.

### Verification

```bash
npm run check-docs    # tsc + regen into memory + diff against tracked files
                      # exits 1 if regeneration would change anything
```

Treat `npm run check-docs` as a pre-commit gate. CI should run it; locally
it's the fast way to confirm nothing was missed.

### Adding a new shipped skill

1. Create `.claude/skills/<name>/SKILL.md` (with `name`, `version`,
   `description`, `author`, `zone` frontmatter).
2. Create `.claude/skills/<name>/catalog.json` following
   `.claude/skills/catalog.schema.json`. The folder name and `catalog.name`
   must match.
3. (Optional) Add the new name to `CARD_ORDER` in `src/cli/generate-help.ts`
   if you care about its position in the rendered cards. Otherwise it
   appears alphabetically at the end.
4. Run `npm run build` and commit everything.

### Removing or renaming a skill

1. Delete (or rename) the skill's directory under `.claude/skills/`.
2. Remove its entry from `CARD_ORDER` in `src/cli/generate-help.ts`.
3. Run `npm run build` — the generator emits whatever catalogs exist now,
   so deleted skills drop out automatically.
4. Commit.

## Design rule: catalog.json is documentation, SKILL.md is contract

- `SKILL.md` is what the LLM loads when the skill fires. Keep it focused
  on **what the skill does** and **how to invoke each step**. Audience: the
  agent executing the skill.
- `catalog.json` is what the help docs render. Keep it focused on **when to
  use it** and **what it produces**. Audience: a developer scanning the
  catalog deciding whether to invoke it.

They cover overlapping ground (versions, invocations, halts) but with
different framings. Keep both updated; don't merge them.

## Versioning

Each shipped skill carries its own SemVer in `SKILL.md` frontmatter and
`catalog.json`. The repo's `package.json` version (`stx-skills`) is the
installer/CLI version — independent of any single skill. Bump the
package version when the installer, generator, or shipped CLIs change;
bump a skill version when its `SKILL.md` semantics change.

## See also

- `.claude/skills/catalog.schema.json` — JSON Schema for catalog.json files
- `src/cli/generate-help.ts` — the generator that drives `npm run build`
- `AGENTS.md` (repo root) — persona inventory; covers the 10 personas
  under `.claude/agents/`
