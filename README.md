# stx-skills

Organization-wide [Claude Code](https://docs.claude.com/en/docs/claude-code) and [Cursor](https://cursor.com) skills collection — nine slash-commands and ten versioned agent personas that drive feature waves, bug fixes, commits, PR merges, documentation, and magazine-quality reports, all built around the worktree model. Install into any project without publishing to npm.

📖 **[Open the walkthrough →](https://socitix.github.io/stx-skills/)** — full doc with diagrams, expandable skill catalog, settings reference.

Current release: **v1.10.0** · MIT licensed.

---

## Quick install

**Source of truth:** everything lives under `stx-skills/.claude/skills/` and `.claude/agents/` (Claude-native markdown). The installer copies from there — Cursor installs apply transforms at copy time.

### Claude Code (default)

```bash
# From the GitHub repo — no clone needed
cd ~/projects/my-app
npx github:socitix/stx-skills

# From a local sibling clone
npx ../stx-skills

# From an absolute path
npx /Users/me/projects/stx-skills

# Install into an explicit target
npx ../stx-skills ~/projects/my-app
```

### Cursor IDE

```bash
cd ~/projects/my-app
npx github:socitix/stx-skills --cursor
# or from a sibling clone:
npx ../stx-skills --cursor
```

Writes to `.cursor/skills/` and `.cursor/agents/` with install-time transforms:

- `.claude/agents/` → `.cursor/agents/` in all paths
- `Agent` tool → `Task` tool · `AskUserQuestion` → `AskQuestion`
- Named persona spawns → `Task(subagent_type: "stx-analyst")` etc.
- Slash-command skills get `disable-model-invocation: true` in frontmatter

### Both IDEs

```bash
npx ../stx-skills --both
```

Installs Claude-native files to `.claude/` **and** Cursor-transformed files to `.cursor/` in one pass.

> ⚠️ **Syntax note.** The package path goes right after `npx`. Do not prefix it with `install` — `npx install ../stx-skills` fails with `could not determine executable to run` because npx treats `install` as the package name. (`npm install` is different; that's the `npm` CLI.) The word `install` is accepted only *after* the package spec: `npx ../stx-skills install` works as a no-op verb.

Re-running the installer **refreshes** — existing STX skill directories are wiped and replaced with the latest. Non-`stx-*` agent files in the target are preserved.

### Installer options

```bash
npx ../stx-skills --cursor                  # Cursor IDE only → .cursor/
npx ../stx-skills --both                    # Claude + Cursor in one command
npx ../stx-skills --link                    # symlink Claude skills (dev mode)
npx ../stx-skills --skill stx-feature       # install only one skill
npx ../stx-skills --list                    # show what's available
npx ../stx-skills --help
```

### Running multi-agent waves in Cursor

The `/stx-feature` and `/stx-fix` skills are **orchestrator instructions** — the main Cursor agent reads the skill and spawns subagents via the **Task** tool:

| Phase | Parallel? | How |
|---|---|---|
| Analyst → Architect → QA | Sequential (3 user gates) | One Task per phase |
| Dev wave | Up to 3 parallel | Multiple Task calls in one turn when `scope_paths` don't overlap |
| Dev ↔ Reviewer ↔ QA loop | Sequential per task | Task chain per task |

Persona contracts live in `.cursor/agents/stx-*.md`. The orchestrator does not embed them inline — it delegates to named subagent types.

### Skill-driven worktree model (not IDE-folder-driven)

STX enforces worktrees in the **skill protocol**, not by which folder you opened in the IDE:

1. `/stx-feature` and `/stx-fix` run on **main**, create `.claude/worktrees/<name>/`, then **Step 0.5 / 1.5** `cd` into it and verify branch ≠ `main`.
2. All wave artifacts and code edits happen from that worktree cwd (or absolute paths under it).
3. Every spawned subagent gets a **Worktree** preamble with the absolute path.

**Cursor caveat:** Step 0.5 changes the agent's shell cwd but does **not** switch the Cursor workspace folder. Cursor's native `/worktree` command and `.cursor/worktrees.json` are a **separate** system — STX does not invoke them. For long UI sessions you may still open the worktree folder manually; for waves, trust Step 0.5 + absolute paths.

Optional hard gate for consuming repos: `.cursor/hooks.json` denying Write on `main` (see `docs/temp/REQ-worktree-enforcement-and-cursor-integration.md`).

---

## Agents (Wave 1 v1.8 → Wave 2 v1.9)

The multi-agent wave (`/stx-feature`) and the bug-fix loop (`/stx-fix`) spawn agents from versioned persona files under [`.claude/agents/`](.claude/agents/) instead of inline prompts in `SKILL.md`. **Ten personas** total — the **Reviewer is new in v1.9**, sitting between Dev hand-back and QA's test rerun:

| Persona | Role | Consumed by |
|---|---|---|
| `stx-analyst.md` | Decomposes feature request → Features with acceptance criteria | `/stx-feature` |
| `stx-architect.md` | Decomposes Features → tier-tagged Tasks | `/stx-feature` |
| `stx-qa.md` | Authors failing tests, reruns them, only agent that may edit tests | `/stx-feature`, `/stx-fix` |
| **`stx-reviewer.md`** ★ | **Reads Dev diff between Dev and QA. Emits structured verdict; halt on test-file edit / weakened assertion / SUT mock.** | **`/stx-feature` (new in v1.9)** |
| `stx-coder.md` | Single-bug implementer | `/stx-fix` |
| `stx-dev-base.md` | Universal Dev prelude (scope guardrails, hand-back format) | `/stx-feature` |
| `stx-dev-tier-db.md` | DB-tier overlay: migrations, RLS, data-protection guards | `/stx-feature` |
| `stx-dev-tier-service.md` | Service-tier overlay: three-tier pattern, result shapes | `/stx-feature` |
| `stx-dev-tier-api.md` | API-tier overlay: thin handlers, Zod, auth, idempotency | `/stx-feature` |
| `stx-dev-tier-ui.md` | UI-tier overlay: React + Tailwind + shadcn, a11y | `/stx-feature` |

See [`AGENTS.md`](AGENTS.md) for the full inventory, frontmatter spec, and versioning policy. Each wave records its `persona_versions` (including the Reviewer) in `wave-state.json` for reproducibility. The Reviewer's verdicts are appended to `wave-state.json.reviewer_verdicts[]` per iteration — the foundation for Wave 3 (execution-feedback loop) metrics.

The installer copies `.claude/agents/` alongside `.claude/skills/` into every consuming project.

---

## Skill catalog

Every skill is one of three types based on where you run it:

| Type | Meaning | Skills |
|---|---|---|
| **main-bound** | You're on `main` and want to start something (skill spawns a worktree) | `/stx-feature`, `/stx-fix` |
| **worktree-bound** | You're in a feature worktree (skill operates on it) | `/stx-pr-merge`, `/stx-worktree-report` |
| **any-bound** | Runs anywhere — utilities | `/stx-checkin`, `/stx-image`, `/stx-magazine-report`, `/stx-help`, `/stx-help-html` |

### `/stx-feature` — multi-agent feature wave  *(main-bound)*

Interview → Analyst → Architect → QA → tier-specialized Dev agents. Three approval gates, suspicious-change tracking, iteration caps. Produces `requirement-verse.html`, `architecture-verse.html`, `qa-verse.html`, `result.html` under `docs/waves/<wave-id>/`, plus a cross-wave `docs/waves/wave-wiki.html` index rebuilt at the end of every wave.

```bash
/stx-feature                                              # Fully interactive
/stx-feature Admin multi-delete on /dashboard             # Seed the request
/stx-feature --resume wave-admin-multi-delete-7f3a        # (planned)
```

See [.claude/skills/stx-feature/SKILL.md](.claude/skills/stx-feature/SKILL.md).

### `/stx-fix` — two-agent bug-fix loop  *(main-bound)*

Drives a QA → Coder loop against a reproducible bug. QA writes the failing test first; the Coder makes the smallest change to pass. Coder cannot touch test files — that halts the loop. Iteration cap default 5.

```bash
/stx-fix                                       # Interactive
/stx-fix Timer offset wrong after DST          # Pre-supply the title
```

See [.claude/skills/stx-fix/SKILL.md](.claude/skills/stx-fix/SKILL.md).

### `/stx-checkin` — secure commit + push  *(any-bound)*

Pre-commit security scan, deleted-file confirmation, branch-aware push/PR. Blocks secrets (`.env`, `*.pem`, `credentials.json`, …) and warns on noise (`.DS_Store`, `node_modules/`, files >10 MB).

```bash
/stx-checkin                       # Interactive
/stx-checkin -m "feat: add login"  # With commit message
/stx-checkin --dry-run             # Preview only
/stx-checkin --skip-push           # Commit without push
```

See [.claude/skills/stx-checkin/SKILL.md](.claude/skills/stx-checkin/SKILL.md).

### `/stx-pr-merge` — commit → PR → merge → cleanup chain  *(worktree-bound)*

Ten-step chain with build-validation gates around the merge. Halts on any failure for user review. Falls back to `gh api -X DELETE …git/refs/heads/<branch>` when local-checkout blocks branch deletion.

```bash
/stx-pr-merge                                    # Run with chained approval
/stx-pr-merge --interactive                      # Prompt at each gate
/stx-pr-merge --dry-run                          # Print every command without executing
/stx-pr-merge --pr-title "fix: timer offset"     # Pre-supply the PR title
```

Pre-flight → commit → push & PR → **build #1** → squash-merge → refresh main → **build #2** → worktree cleanup → branch delete.

See [.claude/skills/stx-pr-merge/SKILL.md](.claude/skills/stx-pr-merge/SKILL.md).

### `/stx-worktree-report` — single-file worktree HTML report  *(worktree-bound)*

Produces a polished `*.html` under `docs/` documenting a worktree's changes. Same shape every time: stats, status pills, approach trade-off table, two Mermaid diagrams, per-file diffs with informative hunks, test output, deferred caveats.

```bash
/stx-worktree-report                                          # cwd, infer everything
/stx-worktree-report --worktree ../feature-branch             # explicit path
/stx-worktree-report --base develop                           # diff base (default: main)
/stx-worktree-report --title "PNG → PDF migration"            # override title
```

See [.claude/skills/stx-worktree-report/SKILL.md](.claude/skills/stx-worktree-report/SKILL.md).

### `/stx-magazine-report` — magazine-style HTML deliverable from any source  *(any-bound)*

Turns any analytical brief — blood panel, GTM deck, 10-K, interview corpus, renovation plan — into a single self-contained `.html` file in the visual register of a printed magazine: cover, TL;DR scorecard, finding cards with severity meters, targets table, action cards with pill badges, click-to-expand detail library, donut/bar charts, closing prediction band. Print-friendly, mobile responsive, self-contained.

Ships with four editorial palettes:

| Style | Register | Best for |
|---|---|---|
| #1 Navy Blue | McKinsey-meets-Monocle | GTM, board reports, investment memos, audits |
| #2 Veew Teal | Warmer handbook | Playbooks, onboarding, walkthroughs, customer-facing |
| #3 Crimson Magazine | Vogue / Cereal / Kinfolk | Health, wellness, travel, food |
| #4 Surprise me | Claude picks | Anything that doesn't fit the others |

```bash
/stx-magazine-report                                                # Fully interactive
/stx-magazine-report --style 2 --locale "Kolkata, India"            # Pre-supply choices
/stx-magazine-report --source ./inputs/q3-portfolio.pdf \
                     --output ./reports/q3-portfolio.html           # Explicit I/O
```

Writes to the working folder (or topic-named subfolder). Returns the file path + top 3 findings in chat. Never commits.

See [.claude/skills/stx-magazine-report/SKILL.md](.claude/skills/stx-magazine-report/SKILL.md) and the [reusable prompt template](.claude/skills/stx-magazine-report/prompt.md).

### `/stx-image` — AI-context-safe image audit  *(any-bound)*

Reports unused and oversized images with a "why" for each target, then optionally resizes via macOS `sips` or removes unused. Default mode makes zero changes.

```bash
/stx-image                                  # Analyze cwd
/stx-image public/                          # Analyze a subdirectory
/stx-image --apply                          # Resize oversized in-place
/stx-image --apply --delete-unused          # Also remove unreferenced
/stx-image --size-kb 300 --max-dimension 1280   # Tighter thresholds
```

Thresholds default to 500 KB and 1568 px (Claude Vision's internal cap); logos/icons target 512 px.

See [.claude/skills/stx-image/SKILL.md](.claude/skills/stx-image/SKILL.md).

### `/stx-help` — terse text-mode reference  *(any-bound)*

Prints every skill grouped by type with one-line descriptions. Ends with a pointer to `/stx-help-html` for the visual walkthrough.

```bash
/stx-help
```

See [.claude/skills/stx-help/SKILL.md](.claude/skills/stx-help/SKILL.md).

### `/stx-help-html` — editorial walkthrough  *(any-bound)*

Opens [`help.html`](.claude/skills/stx-help-html/help.html) — the full walkthrough doc with diagrams, expandable skill catalog, settings reference, and pending-features backlog. Same content drives the GitHub Pages site (see below).

```bash
/stx-help-html
```

See [.claude/skills/stx-help-html/SKILL.md](.claude/skills/stx-help-html/SKILL.md).

---

## GitHub Pages

The walkthrough doc is published as a GitHub Pages site at **[https://socitix.github.io/stx-skills/](https://socitix.github.io/stx-skills/)** — anyone can browse it without installing the package.

The Pages content is `docs/index.html`, a synced copy of `.claude/skills/stx-help-html/help.html`. Pages source is configured as `main` branch, `/docs` folder.

**Keeping docs in sync:** the canonical source is `.claude/skills/stx-help-html/help.html` (it ships with the skill). `npm run build` also runs `prepare-docs`, which copies it to `docs/index.html`. Edit only the canonical; the build pushes it to `docs/`.

```bash
npm run build           # tsc + copy to docs/index.html
npm run prepare-docs    # just the copy step
```

---

## Development

```bash
npm install
npm run build       # compile TypeScript + sync docs/index.html
npm run watch       # recompile TS on change
npm run clean       # remove dist/

# Smoke test skills
node dist/skills/stx-checkin.js --dry-run
node dist/skills/stx-image.js --help
node dist/skills/stx-worktree-report.js --pretty
node dist/cli/install.js --list
```

### Adding a new skill

1. Add `src/skills/<skill-name>.ts` with a `#!/usr/bin/env node` shebang (only if the skill has a CLI binary).
2. Create `.claude/skills/<skill-name>/SKILL.md` with YAML frontmatter (`name`, `description`, `version`, `author`) and optionally `README.md` with design notes.
3. If the skill has a binary, register it in `package.json`:
   ```json
   "bin": { "<skill-name>": "./dist/skills/<skill-name>.js" }
   ```
4. Document the skill in this README and add a catalog entry in `.claude/skills/stx-help-html/help.html`.
5. `npm run build` to verify it compiles and sync the docs.

The installer auto-discovers every directory under `.claude/skills/` — no registration needed there.

---

## File structure

```
stx-skills/
├── package.json                              # bin: stx-skills + 4 skill binaries
├── tsconfig.json
├── src/
│   ├── cli/
│   │   ├── install.ts                        # npx stx-skills entry point
│   │   └── cursor-transform.ts               # --cursor install-time transforms
│   └── skills/
│       ├── stx-checkin.ts
│       ├── stx-pr-merge.ts
│       ├── stx-image.ts
│       └── stx-worktree-report.ts
├── dist/                                     # gitignored — compiled output
├── docs/
│   └── index.html                            # GitHub Pages — synced from help.html
├── AGENTS.md                                 # persona inventory (v1.8+)
├── .claude/
│   ├── agents/                               # 10 versioned persona files
│   │   ├── stx-analyst.md
│   │   ├── stx-architect.md
│   │   ├── stx-qa.md                        # shared by stx-feature + stx-fix
│   │   ├── stx-reviewer.md                  # new in v1.9 — between Dev and QA
│   │   ├── stx-coder.md
│   │   ├── stx-dev-base.md
│   │   └── stx-dev-tier-{db,service,api,ui}.md
│   └── skills/
│       ├── stx-feature/        (SKILL.md + templates/)
│       ├── stx-fix/            (SKILL.md + template.md)
│       ├── stx-checkin/        (SKILL.md + README.md)
│       ├── stx-pr-merge/       (SKILL.md + README.md)
│       ├── stx-image/          (SKILL.md + README.md)
│       ├── stx-magazine-report/(SKILL.md + README.md + prompt.md)
│       ├── stx-worktree-report/(SKILL.md + template.html)
│       ├── stx-help/           (SKILL.md)
│       └── stx-help-html/      (SKILL.md + README.md + help.html)  ← canonical doc
└── scripts/
    └── install.sh                            # fallback bash installer
```

---

## License

MIT
