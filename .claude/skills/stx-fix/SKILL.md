---
name: stx-fix
description: Drives a two-agent QA → Coder loop against a known bug (or small cluster of related bugs). Interviews the user to fill the prompt template, confirms the worktree state, presents the rendered prompt for explicit user acceptance, then kicks off the loop. Use when the user has a reproducible bug and wants a failing test written first, then the smallest code change that makes it pass. Supports --autonomous to auto-approve the acceptance gate and optional-field interview (still halts on destructive ops, commits, and pushes). Writes a per-fix folder under docs/waves/fix-{slug}/ containing fix-report.html and fix-state.json, plus a top-level docs/waves/fix-wiki.html index across all fixes.
version: 1.11.0
author: STX
---

## Personas (loaded by reference)

This skill spawns two agents. Their contracts live in `.claude/agents/`:

| Persona file | Role |
|---|---|
| `.claude/agents/stx-qa.md` | QA (test owner) — shared with `/stx-feature` |
| `.claude/agents/stx-coder.md` | Coder (single-bug implementer) |

`template.md` references these persona files in §5 of the rendered prompt. See [`AGENTS.md`](../../../AGENTS.md) at the repo root for the full inventory.

# /stx-fix

A guided multi-step bugfix workflow. The skill interviews the user for the bug details, confirms the worktree state, renders a complete prompt from the embedded `template.md`, gets explicit user acceptance, and then drives a strict QA → Coder → QA loop until the bug is fixed (or until the iteration cap is hit and the loop is escalated).

## When to use it

- A reproducible bug (or small cluster of related bugs) needs to be fixed.
- The user wants the **failing test written first**, then the smallest code change that makes it pass — not freeform "investigate and patch."
- The work fits inside a single worktree.

Do **not** use this skill for:
- New features (use a different planning flow).
- Refactors with no behavior change (no failing test to anchor to).
- Vague reports without a reproduction (interview the user to a concrete repro first).

## Governance — read before running

This skill operates under the user's CRITICAL governance rules from `~/.claude/CLAUDE.md`:

1. **Always Work In A Worktree (HIGHEST PRIORITY).** This skill MUST confirm the user is on a worktree before any test or code edit. If the user is on `main` / `master`, the skill **stops and proposes** a new worktree before continuing.
2. **No Commits or Deployments Without Approval.** Any commit, push, or PR step at the end of the loop is gated on explicit user approval.
3. **Data Protection.** No destructive operation (no test deletion, no force-pushes, no branch removal) without an explicit named approval.
4. **QA / Fixer separation (per user's auto-memory `feedback_qa_fixer_workflow.md`).** The Coder MUST NOT edit the test files. Touching test files is a halt-the-loop offense.

### Autonomous mode (`--autonomous`)

When the user invokes `/stx-fix --autonomous`, the orchestrator treats every **non-destructive interactive gate** as pre-approved and proceeds without pausing. The agents, iteration caps, and halt conditions are unchanged.

**What `--autonomous` auto-approves:**

- Step 1 worktree confirmation when already on a non-`main` branch.
- Step 1 worktree creation when on `main` — slug derived from `title` (kebab-case, ≤30 chars). No `AskUserQuestion`.
- Step 2 **optional** field interview — `scope_hints`, `out_of_scope`, `use_browser_mcp`, `iteration_cap`, `commit_policy` all default per `template.md`'s FORM_FIELDS; `commit_policy` is forced to `no-commit` (overrides the FORM_FIELDS default of `commit-after-green`).
- Step 4 + Step 5 acceptance gate — rendered prompt is still shown for the audit log, but the `AskUserQuestion` call is skipped and a one-line "Acceptance gate auto-approved (autonomous)." is printed before Step 6 starts.

**What `--autonomous` NEVER bypasses (must still STOP and ask):**

- `commit_policy` is forced to `no-commit`. No commit, push, PR, or merge runs even if all tests are green. User runs `/stx-checkin` or `/stx-pr-merge` manually. (This matches the global "Autonomous agent special rules": no commits/deploys while unattended.)
- Worktree removal, branch deletion, `git push --force`.
- Any destructive database operation in test setup (`DELETE`, `DROP`, `TRUNCATE`, `UPDATE` without `WHERE`).
- File deletion outside the worktree's working set.
- Coder editing a test file, loosening an assertion, or mocking the SUT — all still halt the loop.
- Iteration caps (soft 3, hard `iteration_cap`) and out-of-scope violations still halt.

**What `--autonomous` fails on (cannot fabricate):**

The four **required** FORM_FIELDS (`title`, `issues`, `repro`, `expected`) cannot be defaulted — they encode the bug. If any are missing after parsing the invocation, the skill halts with: *"`--autonomous` requires title / issues / repro / expected. Re-invoke `/stx-fix --autonomous` with these fields supplied (a YAML file via `--from <path>`, or a fully-formed natural-language description with a title line, numbered issues, repro steps, and expected behavior)."* It does NOT silently start a Coder with no acceptance criteria.

## Workflow steps

The skill runs strictly in order. The user is asked to confirm at the **review gate** (step 5) before any test or code is written.

### Step 1 — Confirm worktree state (always first)

Before asking any other questions, the skill must check the current git state:

```bash
git rev-parse --abbrev-ref HEAD
git worktree list --porcelain
```

Decision tree:
- **On a feature/bugfix branch in a non-main worktree:** confirm the worktree path with the user (one-line: "We're on `<branch>` at `<path>` — work here?"). If yes, continue. If no, treat as if on main. **`--autonomous`:** skip the confirmation; print one line and continue.
- **On `main` / `master`:** STOP. Propose a new worktree. Use `AskUserQuestion` with two options: (a) create a new worktree with a sensible name derived from the bug title, (b) the user supplies a custom name. Do NOT proceed to step 2 until a worktree exists. **`--autonomous`:** derive the slug from `title` (kebab-case, ≤30 chars), create `.claude/worktrees/bugfix-<slug>` on branch `bugfix/<slug>`, print one line, continue. Do NOT call `AskUserQuestion`.

The worktree command pattern:

```bash
git worktree add .claude/worktrees/<name> -b bugfix/<name>
ln -sf <main-repo>/.env.local .claude/worktrees/<name>/.env.local  # if applicable
```

### Step 1.5 — Switch session into the worktree (mandatory)

After creating or confirming a worktree, **before Step 2 (interview) or any file write**:

```bash
MAIN="$(git rev-parse --show-toplevel)"
WT=".claude/worktrees/<name>"
cd "$WT"
git rev-parse --abbrev-ref HEAD       # must NOT be main or master
git rev-parse --show-toplevel         # must equal $(pwd)
```

- If branch is `main` / `master` → **halt**. Do not proceed.
- Print: `Working in <branch> at <abs-path>`.
- All shell commands for the rest of this fix run from `$WT`.
- **Cursor note:** shell `cd` does not change the IDE workspace folder. Still required — do not write tests or code from the main checkout.

When spawning QA or Coder subagents, **prepend**:

> **Worktree:** `<abs-path-to-WT>`. All reads, writes, and shell commands MUST run from this directory. Do not edit files in the main checkout at `<MAIN>`.

### Step 2 — Interview the user (fill the form)

Use `AskUserQuestion` (or grouped questions in a single call when possible) to collect every field declared in the FORM_FIELDS YAML block at the top of `template.md`. Group related questions to minimize round-trips.

Required fields (must be answered):

| Field | Question style | Notes |
|---|---|---|
| `title` | Free-text | One short line. Becomes PR title and working label. |
| `issues` | Free-text, numbered list | One line per distinct symptom. No causes, no fixes — symptoms only. |
| `repro` | Free-text | URL, user/state, steps. Concrete enough to replay. |
| `expected` | Free-text, numbered list | Mirrors `issues` 1:1. This is the acceptance criteria. |
| `test_kind` | Radio | `playwright`, `vitest-unit`, or `both`. Default: `playwright` for UI bugs, `vitest-unit` for service/logic bugs. |
| `iteration_cap` | Number | Default 5. |
| `commit_policy` | Radio | `no-commit`, `commit-after-green`, `commit-and-pr`. Default: `commit-after-green`. |

Optional fields (skip if not provided):

| Field | Question style | Default |
|---|---|---|
| `scope_hints` | Free-text | Empty / "unknown — investigate." |
| `out_of_scope` | Free-text | Empty. |
| `use_browser_mcp` | Yes/No | Default `yes` for Playwright tests, `no` for unit-only. |

Interview etiquette:

- **Don't ask all 10 questions at once.** Group into 2–3 rounds of `AskUserQuestion`.
- **Re-state the user's input** in your own words after the interview, before rendering — this catches misunderstandings cheaply.
- **Never invent values** for required fields. If the user is vague, ask a clarifying follow-up.

**`--autonomous`:** skip the interview entirely. Required fields (`title`, `issues`, `repro`, `expected`) must be supplied at invocation; if any are missing, halt per the **Autonomous mode** rule above. Optional fields default per FORM_FIELDS, except `commit_policy` which is forced to `no-commit`. Do not re-state the input or ask for confirmation — proceed directly to Step 3.

### Step 3 — Render the template

Substitute every `{{FIELD}}` placeholder in `template.md` with the user's answer, and resolve every `{{#if FIELD == "value"}} … {{/if}}` conditional block. Strip the FORM_FIELDS YAML and the HOW THE EXTENSION SHOULD USE THIS FILE comment block — those are renderer instructions, not part of the agent prompt.

The rendered output is a single markdown document with the sections:

1. Setup (only if a new worktree was just created)
2. The issues
3. Reproduction
4. Expected behavior (acceptance criteria)
5. Scope
6. Agent roles and contracts (QA + Coder)
7. The loop
8. Done criteria
9. After green
10. Reporting back to the user

### Step 4 — Show the rendered prompt to the user

Present the rendered prompt in a fenced code block (or as a clearly-marked preview) for the user to read. Do not start the loop yet. State explicitly:

> "Here is the rendered prompt that will drive the QA → Coder loop. Review and approve before I start."

**`--autonomous`:** still print the rendered prompt — it's the audit log of what the loop will execute — but immediately follow it with *"Acceptance gate auto-approved (autonomous). Starting Step 6."* and skip Step 5.

### Step 5 — Acceptance gate (HARD STOP)

Use `AskUserQuestion` with three options:

1. **Approve and start.** The skill proceeds to step 6.
2. **Edit a field.** The skill loops back to step 2 for the named field, re-renders, and re-asks. (Keep all other fields.)
3. **Cancel.** The skill stops and writes nothing.

Do NOT proceed without explicit approval. A vague "looks good, maybe go" is not approval — re-ask.

**`--autonomous`:** skip this step entirely. Do not call `AskUserQuestion`. Proceed straight to Step 6 — the implicit approval is the `--autonomous` invocation itself.

### Step 6 — Run the QA → Coder loop

Once approved, execute the rendered prompt as the orchestrator. The orchestrator (the assistant running this skill) becomes the **router and judge**. It does NOT write production code or tests directly — it spawns sub-agents.

Sub-agent assignment guidance:

- **QA agent** — spawn via `Agent` tool with `subagent_type: general-purpose` (or a dedicated test agent if available). Paste the contents of `.claude/agents/stx-qa.md` into the agent's prompt verbatim, then append §1 (issues), §3 (expected), and the test-kind constraint from the rendered prompt. Hand the failing test back to the orchestrator for verification.
- **Coder agent** — spawn via `Agent` tool with `subagent_type: general-purpose`. Paste the contents of `.claude/agents/stx-coder.md` into the agent's prompt verbatim, then append the failing test paths, the issue list, the suspected files, and the out-of-scope list.

Both persona files contain the full contract, hard rules, and reporting format. The orchestrator does NOT re-implement persona logic here. If a persona file cannot be read at spawn time, halt — do not fall back to inline prompts.

Loop control is the orchestrator's job. The sub-agents do not decide when the loop ends.

**Structured hand-back collection (feeds Step 7 artifacts).** The orchestrator MUST collect two structured arrays from the agents during the loop so the artifact writer in Step 7 has the data it needs:

- **`tests_written[]`** — repo-relative paths of every failing test file authored by the QA agent at the start of the loop. Per `.claude/agents/stx-qa.md` v1.1.0, QA returns these in its structured hand-back; the orchestrator appends them to the running `fix-state.json#/tests_written` array. One entry per file (a single file may cover multiple numbered issues).
- **`files_touched[]`** — production files modified by the Coder agent across all iterations, as `{ path, add, del }` rows. Per `.claude/agents/stx-coder.md` v1.1.0, the Coder returns these in its structured hand-back; the orchestrator merges them into `fix-state.json#/files_touched`, aggregating `add` / `del` counters across iterations (one row per file, deduplicated by `path`).

Both arrays are persisted to `fix-state.json` at every iteration boundary so that even a halted-at-cap run carries the partial trail through to the Step 7 report.

### Step 7 — Done or halted

Apply the rendered §7 (Done criteria) and §8 (After green) sections. Surface the final report per §9.

If the iteration cap trips, write the handoff doc to `docs/tasks/<title-slug>-handoff.md` and surface to the user with a one-paragraph summary. Do NOT silently retry.

#### Step 7a — Write the per-fix artifact folder (always, before terminal summary)

Regardless of terminal status (`done`, `halted-at-cap`, `blocked`, `cancelled`), the orchestrator writes a per-fix artifact folder under `docs/waves/fix-{slug}/` so every fix run leaves the same shape on disk. This mirrors the per-wave folder shape `/stx-feature` already writes for `docs/waves/<wave_id>/`.

**Procedure (run in order, from the worktree root):**

1. **Resolve the target folder.** `target = docs/waves/fix-{slug}/` where `{slug}` is `fix-state.json#/fix_slug` (the same kebab-case slug used for the worktree). The full folder name is therefore `docs/waves/fix-<slug>/` and `fix_id` is `fix-<slug>`.
2. **Collision handling — HARD STOP if `target` already exists.** Halt and use `AskUserQuestion` with three options (mirroring the worktree-on-main decision tree in Step 1):
   1. **Overwrite.** Delete the existing folder contents and write fresh artifacts in place. Destructive — requires explicit selection.
   2. **Append numeric suffix.** Write to `docs/waves/fix-{slug}-2/` (or `-3`, `-4`, … — pick the lowest free integer ≥ 2). Non-destructive; preserves the prior run.
   3. **Cancel — DEFAULT.** Do not write any artifact. Surface the existing path to the user and stop. The fix-state stays in memory; no file changes on disk.
   In `--autonomous` mode this gate is **not** auto-approved — collision is treated as destructive intent, so the orchestrator halts and asks even when running unattended. Default remains cancel.
3. **Create the folder.** `mkdir -p docs/waves/fix-{slug}/` once the collision check passes.
4. **Write `docs/waves/fix-{slug}/fix-state.json`.** Validate against `.claude/skills/stx-fix/templates/fix-state.schema.json` before persisting — schema drift halts the write. All required fields per the schema must be present (`fix_id`, `fix_slug`, `status`, `started_at`, `title`, `issues`, `repro`, `expected`, `test_kind`, `iteration_cap`, `commit_policy`, `iterations_used`, `tests_written`, `files_touched`); `finished_at` is set to the loop's terminal timestamp. `halt_reason` is non-null whenever `status != "done"`.
5. **Render and write `docs/waves/fix-{slug}/fix-report.html`** from the bundled template at `.claude/skills/stx-fix/templates/fix-report.html`. Substitute the `{{FIELD}}` placeholders from `fix-state.json` directly (string fields), and resolve every `{{#each …}}` block by iterating the underlying array (`tests_written`, `files_touched`).
6. **Issue-parsing note (schema/template impedance).** `fix-state.json#/issues` is stored as a **string** — the original markdown numbered list captured from the `{{issues}}` form input — but the renderer's `{{#each issues}}` block in `fix-report.html` expects an **array**. Before substituting, the orchestrator MUST parse the numbered markdown list into an array of `{ n, summary, status, fix_files, notes }` objects (one per numbered line), pairing each item with the matching line from `expected` (acceptance criterion), the per-issue terminal status, and the subset of `files_touched[].path` that QA / Coder annotated as fixing that issue. The on-disk JSON keeps the original markdown string so it round-trips with the form; the parse is renderer-side only.
7. **Halt-path behaviour.** Even when the loop terminated abnormally (`halted-at-cap` / `blocked` / `cancelled`), `fix-state.json` and `fix-report.html` are still written, with `status` set to the appropriate non-`done` value and `halt_reason` populated. The user always gets a readable post-mortem on disk, never a silent failure.
8. **Order of writes (strict):** `fix-state.json` → `fix-report.html` → `fix-wiki.html` (cross-fix index, see Step 7b) → terminal summary printed to the user. State is the source of truth; the HTML is rendered from it; the wiki is rebuilt from all states.
9. **Surface to the user.** After all three files are written, the terminal one-paragraph summary ends with the literal line `Report written to <abs-path-to-fix-report.html>` so the user has a one-click path into the rendered artifact.

#### Step 7b — Rebuild `docs/waves/fix-wiki.html` (cross-fix index)

After the per-fix `fix-state.json` and `fix-report.html` are on disk, the orchestrator rebuilds the cross-fix index at `docs/waves/fix-wiki.html` from the bundled template at `.claude/skills/stx-fix/templates/fix-wiki.html`. This mirrors `/stx-feature`'s Step 8 wave-wiki rebuild, except it aggregates fixes (not waves) and lives in a sibling file.

- Scan **every** `docs/waves/fix-*/fix-state.json` on disk (exact glob: `docs/waves/fix-*/fix-state.json`). Do not skip halted, blocked, or cancelled runs — every `fix-*/` folder is included regardless of `status`. The just-written fix is one of the rows; older fixes are the rest.
- For each, read `fix_id`, `fix_slug`, `status`, `started_at`, `finished_at`, `title`, plus a short summary (e.g. first line of `issues`, trimmed to ~140 chars).
- Set each row's link to `./{{fix_id}}/fix-report.html` when that file exists, else `./{{fix_id}}/`.
- Sort rows by `started_at` **DESC** (newest first) and render **all** fixes, regardless of status, with a status pill (`status-done` / `status-halted-at-cap` / `status-blocked` / `status-cancelled`).
- This is a full regenerate, not an append — overwrite `docs/waves/fix-wiki.html` each time so it stays consistent with the `fix-*/` directories on disk. The rebuild is **idempotent**: re-running it with the same on-disk state always produces a byte-identical file, so a re-run, a `--resume`, or a manually added/removed `fix-*/` folder always self-heals.
- **Separation from `/stx-feature`.** `/stx-fix` MUST NOT touch `docs/waves/wave-wiki.html` — that file is owned by `/stx-feature`'s Step 8 and is rebuilt only from `docs/waves/wave-*/wave-state.json`. Only `fix-wiki.html` is rewritten here. Likewise `/stx-feature` does not touch `fix-wiki.html`. The two indexes are siblings under `docs/waves/` and are maintained independently by their respective skills.

## Iteration caps (from the rendered template, summarized)

- **Soft cap — 3 cycles on the same surface bug:** halt and escalate. Same symptom across 3 attempts means the loop is converging on the wrong abstraction.
- **Hard cap — N total cycles** (user-configurable, default 5): absolute ceiling. Halt and escalate.

When a cap trips: stash uncommitted changes (or commit on a `wip/<slug>` branch), write the handoff doc, escalate.

## Halt conditions

The skill stops and surfaces — never silently continues — when:

- Worktree state cannot be confirmed (git not initialized, detached HEAD, etc.).
- The user declines the acceptance gate at step 5.
- The QA agent reports a test cannot be written for an issue (with a stated reason).
- The Coder agent edits a test file (immediate halt — escalate).
- The Coder agent loosens or skips an assertion (immediate halt — escalate).
- An iteration cap trips.
- `npm run lint` or `npm run build` fails for a reason unrelated to the bug.
- The out-of-scope list in §4 of the rendered prompt is touched.

## Usage

```
/stx-fix                                    # Interactive; the skill interviews the user
/stx-fix <bug title>                        # Pre-supply the title; everything else is interactive
/stx-fix --autonomous --from <path.yaml>    # Autonomous; required fields read from YAML, optional fields defaulted, commit_policy forced to no-commit
/stx-fix --autonomous "<full description>"  # Autonomous from a single natural-language paragraph — only valid when the description contains a title line + numbered issues + repro + expected; otherwise halts
```

This skill does not have a CLI binary — it is purely conversational and runs inside the assistant.

In `--autonomous` mode the orchestrator never calls `AskUserQuestion`. Missing required fields halt with a one-line error; missing optional fields default per `template.md`'s FORM_FIELDS, with `commit_policy` overridden to `no-commit`. See **Autonomous mode** under Governance for the full list of what is and isn't bypassed.

## Requirements

- Git 2.30+ (for modern `git worktree` semantics)
- Node.js 18+ (for `npm run lint` / `npm run build` validation)
- The project must have a buildable command and a test runner (Vitest, Playwright, or both)
- For browser verification: a Chrome Dev / Playwright MCP server registered in the session

## See also

- [`AGENTS.md`](../../../AGENTS.md) — repo-root persona inventory
- [`.claude/agents/stx-qa.md`](../../agents/stx-qa.md) — QA persona (shared with `/stx-feature`)
- [`.claude/agents/stx-coder.md`](../../agents/stx-coder.md) — Coder persona
- [`template.md`](./template.md) — the embedded prompt template
- [`README.md`](./README.md) — design notes and rationale
- [`/stx-checkin`](../stx-checkin/SKILL.md) — used by `commit-after-green` and `commit-and-pr` policies to perform the actual commit/push
