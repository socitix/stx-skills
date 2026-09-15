---
name: stx-feature
description: Drives a multi-agent feature implementation wave. Interviews the user, runs Analyst → Architect → QA in sequence (each behind a gate), then schedules tier-specialized Dev agents under a Reviewer + QA control loop. Produces requirement-verse.html, architecture-verse.html, qa-verse.html, and result.html artifacts in docs/waves/, plus a cross-wave wave-wiki.html index. Use when a new feature (multi-task, possibly multi-tier) needs to be implemented, not a single bug fix. Supports --autonomous to auto-approve all interactive gates (still halts on destructive ops, commits, and pushes).
version: 1.11.3
author: STX
---

# /stx-feature

A guided multi-agent feature-implementation workflow. The skill interviews the user about a desired feature, runs three specialist agents (Analyst, Architect, QA) sequentially — each behind a user-approval gate — and then dispatches one or more tier-specialized Dev agents in a QA-controlled loop until every task in every feature is green.

This skill is a **sibling** to `/stx-fix`, not a replacement. `/stx-fix` handles a single reproducible bug with two agents (QA + Coder); `/stx-feature` handles new functionality that decomposes into multiple features and tasks across tiers (database / service / API / UI).

## Personas (loaded by reference)

Every agent contract lives in its own file under `.claude/agents/`. The skill loads them at spawn time — it never embeds them inline. See [`AGENTS.md`](../../../AGENTS.md) at the repo root for the full inventory.

| Persona file | Role | Used in |
|---|---|---|
| `.claude/agents/stx-analyst.md` | Analyst | Step 2 |
| `.claude/agents/stx-architect.md` | Architect | Step 3 (and Step 6 on escalation) |
| `.claude/agents/stx-qa.md` | QA | Step 4 + Step 6 (test rerun after Reviewer approves) |
| `.claude/agents/stx-reviewer.md` | Reviewer (new in v1.2) | Step 6, between Dev hand-back and QA rerun |
| `.claude/agents/stx-dev-base.md` | Dev (universal prelude) | Step 5 (every Dev) |
| `.claude/agents/stx-dev-tier-db.md` | Dev (db tier) | Step 5 when `task.tier == "db"` |
| `.claude/agents/stx-dev-tier-service.md` | Dev (service tier) | Step 5 when `task.tier == "service"` |
| `.claude/agents/stx-dev-tier-api.md` | Dev (api tier) | Step 5 when `task.tier == "api"` |
| `.claude/agents/stx-dev-tier-ui.md` | Dev (ui tier) | Step 5 when `task.tier == "ui"` |

When spawning each agent, paste the contents of the matching persona file into the agent's prompt verbatim, then prepend any task-specific context (task spec, file paths, prior verdicts). The orchestrator does NOT re-implement persona logic.

## When to use it

- A new feature (or small cluster of related features) needs to be implemented.
- The work spans more than one architectural tier, or has more than one acceptance test, or both.
- The user wants **failing tests written first**, **a written architecture decision**, and **suspicious-change tracking** — not freeform "go build it."

Do **not** use this skill for:
- Single-bug fixes — use `/stx-fix` instead.
- Refactors with no behavior change — there's no failing test to anchor to.
- Vague aspirations without acceptance criteria — interview the user to a concrete feature list first.

## Governance — read before running

This skill operates under the user's CRITICAL governance rules from `~/.claude/CLAUDE.md`:

1. **Always Work In A Worktree (HIGHEST PRIORITY).** The skill MUST confirm the user is on a non-`main` worktree before any agent runs. If the user is on `main` / `master`, the skill **stops and proposes** a new worktree before continuing.
2. **No Commits or Deployments Without Approval.** Any commit, push, or PR step at the end of the wave is gated on explicit user approval.
3. **Data Protection.** No destructive operation (no test deletion, no force-pushes, no branch removal) without an explicit named approval. This is especially important when the *feature itself* is destructive (e.g. multi-delete) — Dev agents MUST add environment guards and never run delete-style tests against production data.
4. **QA / Dev separation (per user's auto-memory `feedback_qa_fixer_workflow.md`).** Dev agents MUST NOT edit the QA agent's test files. Touching a test file is a halt-the-loop offense.

### Autonomous mode (`--autonomous`)

When the user invokes the skill with `--autonomous`, the orchestrator treats every **non-destructive interactive gate** as pre-approved and proceeds without pausing. This is the only behavior change — the agents, artifacts, scope rules, iteration caps, and halt conditions are all identical.

**What `--autonomous` auto-approves:**

- Step 0 worktree confirmation when already on a non-`main` branch.
- Step 0 worktree creation when on `main` — the orchestrator picks a slug from `initial_request` and proceeds (no `AskUserQuestion`).
- The orchestrator's requirement interview (Step 2) — skipped entirely; the Analyst is told `autonomous: true` and decomposes `initial_request` using best judgment, recording assumptions on each Feature card.
- All open-questions rounds (Steps 2–4) — agents are told `autonomous: true` and resolve gaps with documented best-judgment assumptions instead of returning `open_questions[]`.
- **Gate 1** (`requirement-verse.html`), **Gate 2** (`architecture-verse.html`), **Gate 3** (`qa-verse.html`) — auto-approved; each gate is still logged into `wave-state.json.gates[]` with `auto_approved: true` and a UTC timestamp.
- The "stop at dry-run vs continue past dry-run" question — defaults to **continue past dry-run**.
- The "concurrency cap" question — defaults to **3** (unless overridden via `--concurrency=N`).

**What `--autonomous` NEVER bypasses (must still STOP and ask):**

- Creating a commit, push, PR, or merge. The wave finishes with uncommitted changes and `result.html`; the user runs `/stx-checkin` or `/stx-pr-merge` manually. This matches the global "Autonomous agent special rules" — no commits/deploys while unattended.
- Worktree removal, branch deletion, `git push --force`.
- Any destructive database operation (`DELETE`, `DROP`, `TRUNCATE`, `UPDATE` without `WHERE`).
- File deletion outside the wave's `scope_paths`, or any deletion of user-authored content not produced by this wave.
- All reviewer halt verdicts (`test-file-edit-detected`, `assertion-weakened`, `sut-mocked`) — these still halt the loop and surface to the user; autonomous mode does **not** auto-resume past them.
- Iteration caps (soft 3, hard 5) and suspicious-changes ceiling (3) still trip and still write `handoff.md`.

**What `--autonomous` fails on (cannot fabricate):**

- Missing `initial_request`. If the user invokes `/stx-feature --autonomous` with no feature description and no argument, the skill halts with: *"`--autonomous` requires an initial feature description as the argument."* — it does not silently start an Analyst with no seed.

**Audit trail.** Every auto-approved gate writes a row to `wave-state.json.gates[]`:

```json
{
  "gate": "requirement_verse",
  "auto_approved": true,
  "approved_at": "2026-05-30T14:21:09Z",
  "reason": "autonomous mode"
}
```

`result.html` renders this list at the top of the report so the user can see which gates were skipped.

## Concepts

- **Wave** — a single invocation of `/stx-feature`. One wave produces one worktree, one branch, one PR, and a directory `docs/waves/wave-{slug}-{4-char-random}/`.
- **Feature** — a kanban card. Lives in `requirement-verse.html`. Has acceptance criteria.
- **Task** — a unit of implementation work under a Feature. Lives in `architecture-verse.html`. Each task is tagged with a `tier` (db / service / api / ui) and `scope_paths` (the files it may touch). One QA test maps to each task.
- **Gate** — a hard pause where the user must approve an artifact (HTML) before the next phase runs.
- **Tier-specialized Dev agent** — a Dev agent spawned with `stx-dev-base.md` plus the matching `stx-dev-tier-*.md` persona overlay, determined by the task's `tier` field.

## Artifacts (written into the consuming project)

Per-wave artifacts live under `docs/waves/wave-{slug}-{xxx}/`; one cross-wave index lives at `docs/waves/wave-wiki.html`:

| File | Scope | Owner | Purpose |
|---|---|---|---|
| `wave-state.json` | per wave | Agents (Analyst / Architect / QA) + orchestrator | Source of truth and the **only file agents write**: features, tasks, statuses, iteration counters, `suspicious[]`, `escalations[]`, `persona_versions` |
| `codebase-map.md` | per wave | `stx-feature map` | Index of the consuming codebase — components, routes, services, tests, doc headings. Built once at Step 1.6, read by every agent |
| `briefs/*.json` | per wave | `stx-feature brief` | Per-role slices of `wave-state.json` handed to each agent at spawn |
| `requirement-verse.html` | per wave | **Rendered** from state | Features list with acceptance criteria |
| `architecture-verse.html` | per wave | **Rendered** from state | Tasks per Feature with tier + scope_paths; §3 Revisions derived from `escalations[]` |
| `qa-verse.html` | per wave | **Rendered** from state | Failing tests mapped task → test file, plus tasks needing manual verification |
| `result.html` | per wave | **Rendered** from state | End-of-wave summary: gates, per-task status, reviewer verdicts, suspicious changes |
| `handoff.md` | per wave | Skill orchestrator | Only written when an iteration cap trips or the wave is halted |
| `wave-wiki.html` | **all waves** | Skill orchestrator | Cross-wave index at `docs/waves/wave-wiki.html` (one level above the wave dirs). Rebuilt on every `result.html` write by scanning every `docs/waves/wave-*/wave-state.json`. `fix-*/` folders are excluded and are aggregated separately in `docs/waves/fix-wiki.html` by `/stx-fix`. Lists all waves with status, started/finished, description, features done/total, and a link into each wave. |

## Artifact rendering — the orchestrator's job, never an agent's

**JSON is canonical; HTML is presentation.** Agents write `wave-state.json` and nothing else. Every HTML artifact is produced by a deterministic renderer that ships with the skill:

```bash
stx-feature render docs/waves/<wave-id>            # every artifact with state behind it + the wiki
stx-feature render docs/waves/<wave-id> --only wiki  # just the cross-wave index
stx-feature validate docs/waves/<wave-id>          # check state without writing anything
```

**Resolving the binary** (first that exists wins):

1. `node .claude/skills/stx-feature/stx-feature.js` — the installed skill dir.
2. `npx stx-feature` — also the path for a `--link`ed dev install, whose skill dir symlinks the *source* tree and therefore has no compiled script.

Run `render` after every agent hand-back, after every state change in the Dev loop, and at Step 8. It is idempotent: it overwrites, never appends, and an artifact with no state behind it yet is skipped rather than written empty.

**Never hand-edit a rendered artifact.** Change `wave-state.json` and re-render. This is what makes the artifacts trustworthy: they cannot say something the state does not. Several things the personas used to be asked to remember are now structural — the Architect's "append a Revision, never overwrite the task" is just an `escalations[]` entry that renders as a Revision card, and per-task reviewer-rejection counts, total iterations, and the agent tally are computed at render time rather than stored and kept in sync by hand.

`render` validates first and writes nothing if the state is malformed, naming the offending field path. Treat a validation failure as a halt condition, not something to render around.

`wave-wiki.html` aggregates across every `docs/waves/wave-*/wave-state.json` and is **rebuilt from scratch** each time, so a re-run, `--resume`, or a manually added/removed wave directory always self-heals. Templates and the state schema ship with the skill (see `templates/`).

## Workflow

Strict ordering. Three approval gates. The skill never starts a phase without the previous phase's gate being explicitly approved.

### Interviews & the open-questions protocol (orchestrator-run)

**Subagents cannot reach the user.** `AskUserQuestion` depends on the main conversation and is unavailable inside spawned agents — so every user interaction in this workflow happens here, in the orchestrator, never inside the Analyst / Architect / QA. Two mechanisms:

1. **Up-front interview (Step 2 only).** Before spawning the Analyst, the orchestrator interviews the user via `AskUserQuestion` (grouped 2–4 questions per call) and appends the full Q&A transcript to the Analyst's spawn prompt.
2. **Open-questions rounds (any of Steps 2–4).** An agent that hits a blocking ambiguity stops without writing its artifact and returns a structured `open_questions[]` block (format defined in each persona file). The orchestrator then:
   - asks the user each question via `AskUserQuestion` (grouped, using the agent's `options` where given),
   - re-invokes the same persona with the original prompt **plus** the accumulated Q&A transcript appended under `## Interview transcript`,
   - records the round in `wave-state.json.interviews[]` as `{ step, agent, round, questions[], answers[], at }`.
   - **Cap: 2 open-question rounds per agent per step.** A third round means the request is under-specified — halt the wave and surface the unresolved questions to the user instead of looping.

**`--autonomous`:** both mechanisms are disabled — no up-front interview, and agents are told `autonomous: true` (personas then make best-judgment assumptions inline instead of returning `open_questions[]`).

### Step 0 — Confirm worktree state

Before any other question:

```bash
git rev-parse --abbrev-ref HEAD
git worktree list --porcelain
```

- **On a feature branch in a non-main worktree:** confirm one-line ("We're on `<branch>` at `<path>` — work here?"). If yes, continue. **`--autonomous`:** skip the confirmation; just print one line and continue.
- **On `main` / `master`:** STOP. Use `AskUserQuestion` to propose a worktree name derived from the user's initial feature description. Do NOT proceed until a worktree exists. **`--autonomous`:** derive the slug from `initial_request` (kebab-case, ≤30 chars, alphanum + `-`), create `.claude/worktrees/wave-<slug>` on branch `feat/wave-<slug>`, print one line, continue. Do NOT call `AskUserQuestion`.

Worktree command pattern:

```bash
git worktree add .claude/worktrees/wave-<slug> -b feat/wave-<slug>
ln -sf <main-repo>/.env.local .claude/worktrees/wave-<slug>/.env.local  # if applicable
```

### Step 0.5 — Switch session into the worktree (mandatory)

After creating or confirming a worktree, **before any file write, interview question, or agent spawn**:

```bash
MAIN="$(git rev-parse --show-toplevel)"
WT=".claude/worktrees/wave-<slug>"   # or existing worktree path
cd "$WT"
git rev-parse --abbrev-ref HEAD       # must NOT be main or master
git rev-parse --show-toplevel         # must equal $(pwd)
```

- If branch is `main` / `master` → **halt**. Do not proceed.
- Print: `Working in <branch> at <abs-path>`.
- Capture for `wave-state.json`: `worktree_path` (abs), `branch`, `main_worktree_path` (= `$MAIN`).
- All shell commands for the rest of this wave run from `$WT` (or use `git -C "$WT"` / absolute paths under it).
- **Cursor note:** switching shell cwd does not change the IDE workspace folder. Step 0.5 is still required — do not write wave artifacts from the main checkout.

When spawning any subagent (Analyst through Dev), **prepend** this block to the task prompt:

> **Worktree:** `<worktree_path>`. All reads, writes, and shell commands MUST run from this directory (or use `git -C` / absolute paths under it). Do not edit files in the main checkout at `<main_worktree_path>`.

### Step 1 — Capture initial feature description

The user MAY invoke the skill with a feature description, e.g.:

```
/stx-feature Admin multi-delete on /dashboard
```

If so, take the argument as `initial_request`. Otherwise, ask the user one open question: *"In a few sentences, describe the feature you want implemented."* The result populates `initial_request` in `wave-state.json`.

**`--autonomous`:** the argument is required. If the user invoked `/stx-feature --autonomous` with no description, **halt** with the message: *"`--autonomous` requires an initial feature description as the argument."* Do NOT ask the open question and do NOT proceed with a synthetic seed.

This is the **seed** for everything downstream. Subsequent agents add clarity; they do not replace it.

Also at this step: record the persona versions that will drive the wave. Read the YAML frontmatter of every persona file under `.claude/agents/` and write a `persona_versions` block to `wave-state.json`. Also write `worktree_path`, `branch`, and `main_worktree_path` from Step 0.5. Since the package uses **unified versioning** (every skill and persona is stamped with the `package.json` version by `npm run build`), all entries normally show the same release version — the block still records what was actually read from each file, so a drifted install is visible:

```json
"persona_versions": {
  "analyst": "1.11.0",
  "architect": "1.11.0",
  "qa": "1.11.0",
  "reviewer": "1.11.0",
  "dev_base": "1.11.0",
  "dev_tier_db": "1.11.0",
  "dev_tier_service": "1.11.0",
  "dev_tier_api": "1.11.0",
  "dev_tier_ui": "1.11.0"
}
```

This locks the wave to a specific release snapshot — essential for future cross-wave metrics aggregation.

### Step 1.6 — Build the codebase map (mandatory, before any spawn)

Every agent otherwise re-walks `components/`, `app/`, the service tree and the test layout to find the patterns it must cite. Do that walk once, here, and hand the result to all of them:

```bash
stx-feature map --root "$WT" --out "docs/waves/<wave-id>/codebase-map.md"
```

The map indexes components and their exported symbols, the route tree, services/lib, the test layout and runner configs, and the headings of `CLAUDE.md` / `AGENTS.md` / `docs/design-system.md`. It is an index, not a summary — agents still open what they need, they just no longer have to discover what exists. It degrades gracefully: a repo with no `app/` or `components/` tree gets those sections marked empty rather than an error.

Pass its path to every agent you spawn from Step 2 onward.

### Step 2 — Requirement interview, then Analyst (Agent 1)

**Interview first (orchestrator, not the Analyst).** Before spawning, interview the user via `AskUserQuestion` — grouped 2–4 questions per call — covering:

- What problem is this feature solving?
- Who is the user / actor?
- Acceptance criteria per feature (one numbered list per feature).
- Blast radius from the **existing system** point of view (which user flows, which data shapes, which permissions).
- Out-of-scope items (explicit non-goals).

Record the Q&A transcript to `wave-state.json.interviews[]`.

**Spawn:** `Agent` with `subagent_type: general-purpose` (or `Explore` for read-only research first if scoping is unclear). Prepend the **Worktree** block from Step 0.5, paste the contents of `.claude/agents/stx-analyst.md` into the agent's prompt verbatim, then append:

> The current wave-state is at `<path-to-wave-state.json>` — write your Features there and **write no HTML**; the orchestrator renders `requirement-verse.html` from your JSON. The codebase map is at `<path-to-codebase-map.md>`; read it before exploring the repo and open only the files it points you at. The initial request is: `<initial_request>`.
>
> ## Interview transcript
> `<the full Q&A from the orchestrator-run interview>`

After the Analyst hands back, render Gate 1's artifact:

```bash
stx-feature render docs/waves/<wave-id> --only requirement
```

The Analyst follows the contract in its persona file. Do not embed contract logic here. If the Analyst hands back an `open_questions[]` block instead of Features, run an open-questions round per the protocol above (ask the user, re-invoke with the extended transcript; max 2 rounds, then halt).

In **`--autonomous`** mode, skip the up-front interview entirely and append instead: `autonomous: true. There is no interview transcript; decompose the initial_request using your best judgment, record assumptions on each Feature card, and do NOT return open_questions[].`

★ **Gate 1: user approves `requirement-verse.html`.** Use `AskUserQuestion` with three options: *Approve*, *Edit a feature*, *Cancel wave*. Do not proceed without explicit approval.

**`--autonomous`:** skip the `AskUserQuestion` call. Treat the gate as approved. Append a row to `wave-state.json.gates[]` with `gate: "requirement_verse"`, `auto_approved: true`, `approved_at: <utc>`, `reason: "autonomous mode"`. Print one line: *"Gate 1 auto-approved (autonomous)."*

### Step 3 — Architect (Agent 2)

**Build the Architect's brief first** — do not hand it the rendered HTML:

```bash
stx-feature brief docs/waves/<wave-id> --for architect
```

This writes `briefs/architect.json`: the initial request, the out-of-scope list, and every Feature with its acceptance criteria — and none of the running logs. Handing the Architect `requirement-verse.html` *and* the `wave-state.json` it was rendered from is the same content twice, and the HTML is the larger copy.

**Spawn:** `Agent` with `subagent_type: general-purpose`. Prepend the **Worktree** block from Step 0.5, paste the contents of `.claude/agents/stx-architect.md` into the agent's prompt verbatim, then append:

> Your brief is at `<path-to-briefs/architect.json>` and the codebase map at `<path-to-codebase-map.md>`. Do NOT read `requirement-verse.html`. Write your Tasks into `<path-to-wave-state.json>` and **write no HTML** — the orchestrator renders `architecture-verse.html` from your JSON.

The Architect follows the contract in its persona file. If the Architect hands back an `open_questions[]` block (implementation-strategy gaps) instead of Tasks, run an open-questions round per the protocol above (ask the user, re-invoke with the Q&A appended under `## Interview transcript`; max 2 rounds, then halt).

In **`--autonomous`** mode, also append: `autonomous: true. Do NOT return open_questions[]; resolve any implementation gaps using best judgment and document each assumption inline in architecture-verse.html under "Autonomous assumptions" per Feature.`

After the Architect hands back, render Gate 2's artifact:

```bash
stx-feature render docs/waves/<wave-id> --only architecture
```

★ **Gate 2: user approves `architecture-verse.html`.** Scope is now FROZEN — anything not listed in tasks or marked in scope_paths is off-limits for the wave.

**`--autonomous`:** skip the `AskUserQuestion` call. Treat the gate as approved. Append a row to `wave-state.json.gates[]` with `gate: "architecture_verse"`, `auto_approved: true`, `approved_at: <utc>`, `reason: "autonomous mode"`. Scope is still frozen. Print one line: *"Gate 2 auto-approved (autonomous). Scope frozen."*

### Step 4 — QA Agent (Agent 3)

**Build QA's brief first:**

```bash
stx-feature brief docs/waves/<wave-id> --for qa
```

**Spawn:** `Agent` with `subagent_type: general-purpose`. Prepend the **Worktree** block from Step 0.5, paste the contents of `.claude/agents/stx-qa.md` into the agent's prompt verbatim, then append:

> Your brief is at `<path-to-briefs/qa.json>` and the codebase map at `<path-to-codebase-map.md>`. Do NOT read `requirement-verse.html` or `architecture-verse.html`. Record `test_path`, `test_kind`, `coverage_summary` and `failure_output` (or `test_unwritable`) per task in `<path-to-wave-state.json>`, plus the wave-level `vitest_installed`, and **write no HTML** — the orchestrator renders `qa-verse.html` from those fields.

The QA agent follows the **authoring contract** section of its persona file. If QA hands back an `open_questions[]` block (e.g. requesting approval to scaffold Vitest), run an open-questions round per the protocol above — scaffolding approval is a user decision the orchestrator collects via `AskUserQuestion`, never the subagent.

After QA hands back, render Gate 3's artifact:

```bash
stx-feature render docs/waves/<wave-id> --only qa
```

★ **Gate 3 (Dry-run boundary): user approves `qa-verse.html` AND the failing tests.** This is the most expensive gate to fail past — failing tests that encode the wrong acceptance criteria poison the rest of the wave.

By default, the skill **stops here** unless the user explicitly chose to continue past dry-run in the interview.

**`--autonomous`:** skip the `AskUserQuestion` call. Treat the gate as approved AND treat "continue past dry-run" as the chosen path. Append a row to `wave-state.json.gates[]` with `gate: "qa_verse"`, `auto_approved: true`, `approved_at: <utc>`, `reason: "autonomous mode"`. Print one line: *"Gate 3 auto-approved (autonomous). Proceeding to Dev wave."* The other halt conditions in Step 6 (reviewer halt verdicts, iteration caps, suspicious-changes ceiling) are NOT bypassed — they still surface to the user.

### Step 5 — Dev wave (Agents 4..n)

After gate 3 approval, the orchestrator schedules Dev agents.

**Scheduling rules:**
- A task is **eligible** when all its `depends_on` tasks are `done`.
- Two eligible tasks may run **in parallel** only if their `scope_paths` arrays have **no overlap** (no shared files, no shared globs).
- Concurrency cap: 3 parallel Dev agents by default (user-configurable in interview).

**Persona dispatch.** Each Dev agent is spawned with a tier-specialized prompt assembled from two persona files:

| `task.tier` | Persona files to concatenate (base first, then tier overlay) |
|---|---|
| `db` | `.claude/agents/stx-dev-base.md` + `.claude/agents/stx-dev-tier-db.md` |
| `service` | `.claude/agents/stx-dev-base.md` + `.claude/agents/stx-dev-tier-service.md` |
| `api` | `.claude/agents/stx-dev-base.md` + `.claude/agents/stx-dev-tier-api.md` |
| `ui` | `.claude/agents/stx-dev-base.md` + `.claude/agents/stx-dev-tier-ui.md` |

**Build the Dev's task brief** before each spawn:

```bash
stx-feature brief docs/waves/<wave-id> --for dev --task <task.id>
```

This writes `briefs/dev-<task.id>.json`: that one task, its Feature's acceptance criteria, the frozen out-of-scope list, the caps, and the test path — and nothing about the other tasks in the wave.

After concatenating the two persona files, prepend the **Worktree** block from Step 0.5, then append the task-specific context:

> Your task is `<task.id> — <task.title>`. Your brief is at `<path-to-briefs/dev-<task.id>.json>` and the codebase map at `<path-to-codebase-map.md>`. The failing test is at `<task.test_path>`. Do NOT read `architecture-verse.html` — everything you need about your task, including the frozen out-of-scope list, is in the brief.

The Dev follows the contract in its persona files. Do not re-explain Dev rules here — the persona files are the source of truth.

### Step 6 — Dev ↔ Reviewer ↔ QA loop

Per task:

```
QA confirms test fails for the right reason
   ↓
Dev (tier-specialized) implements
   ↓
Dev runs test + lint + build, hands back diff
   ↓
Reviewer reads diff vs task spec  ← .claude/agents/stx-reviewer.md
   ├─ approved=true       → hand off to QA
   ├─ approved=false      → bounce to Dev with concerns[] (iteration++)
   └─ halt verdict        → STOP wave for this task (test-file edit / SUT mock / assertion weakened)
   ↓
QA reruns test independently      ← .claude/agents/stx-qa.md verification contract
   ├─ green → mark task done
   └─ red   → return to Dev with specific failure (iteration++)
```

**Why the Reviewer sits between Dev and QA.** Without a Reviewer, QA's rerun is the only signal between "Dev says done" and "task closed." A Dev that mocks the system-under-test or weakens the assertion can drive QA green and bypass the test the bug was written to catch. The Reviewer is the integrity gate: it reads the diff, line-by-line, before QA touches it. Its verdict is appended to `wave-state.json.reviewer_verdicts[]` per iteration.

**Spawning the Reviewer.** After every Dev hand-back, rebuild the task brief so the Reviewer sees the prior verdicts on this task:

```bash
stx-feature brief docs/waves/<wave-id> --for reviewer --task <task.id>
```

Then spawn the Reviewer via `Agent` with `subagent_type: general-purpose`. Prepend the **Worktree** block from Step 0.5, paste the contents of `.claude/agents/stx-reviewer.md` verbatim, then append:

> The Dev's diff (full output of `git diff` since the last accepted state) is below. Your brief is at `<path-to-briefs/reviewer-<task.id>.json>` — it carries the task spec, the frozen out-of-scope list, and your prior verdicts on this task. Apply your checklist and emit your verdict per the persona contract.

**Re-render as state changes.** After each iteration closes (a verdict appended, a task marked done, a `suspicious[]` event logged), run `stx-feature render docs/waves/<wave-id>` so the artifacts on disk match the state. This is cheap and idempotent; skipping it is how artifacts drift.

**Caps:**
- **Soft cap — 3 iterations on the same task:** halt this task, escalate to Architect. An iteration is incremented by **either** a Reviewer rejection **or** a QA red — both count. Re-spawn the Architect with its persona file plus the task brief + the latest reviewer verdict. The Architect appends an entry to `wave-state.json.escalations[]` (and amends the task in place if needed); re-rendering turns that entry into a "Revision N" card in §3 of `architecture-verse.html` while §2 keeps the original task block. Then the loop resumes.
- **Hard cap — 5 total iterations on the same task:** halt the wave for this task. Write `handoff.md` and surface to user.
- **Reviewer halt verdict — instant wave halt for this task:** `test-file-edit-detected`, `assertion-weakened`, or `sut-mocked` short-circuits the loop without incrementing counters. The user decides whether to escalate to Architect or close out the wave.

QA's pause authority (build breaks twice, scope violation, test-bypass detection caught at rerun time) is defined in `.claude/agents/stx-qa.md` under **Pause authority**. Reviewer halts and QA pauses are independent — a Dev can be halted by either.

### Step 7 — Feature done / Wave done

- **Feature done** = all its tasks are `done` (QA-confirmed green) AND no open `suspicious[]` items targeting that feature.
- **Wave done** = all features done.

### Step 8 — Render `result.html` and report

Final orchestrator step:

1. **Complete `wave-state.json`.** Set the final `status`, `finished_at`, `files_touched[]` (deduplicated, with add/del counts), `agents_spawned` per role, and `next_action` — one line telling the user what to do next. The result page is rendered from these fields, so anything missing here is missing from the report.

2. **Render everything:**

   ```bash
   stx-feature render docs/waves/<wave-id>
   ```

   This writes `result.html` and rebuilds `docs/waves/wave-wiki.html` in one pass. `result.html` carries the gates audit trail, the per-feature/per-task status table, per-task reviewer-rejection counts, the full `reviewer_verdicts[]` trail with concerns and suggestions, every `suspicious[]` event, the Architect `escalations[]`, files touched, and the derived iteration and agent totals. The wiki scans **every** `docs/waves/wave-*/wave-state.json`, sorts by `started_at` descending, links each row to that wave's `result.html` when it exists, and is regenerated from scratch rather than appended. `fix-*/` folders are excluded — `/stx-fix` aggregates those into `docs/waves/fix-wiki.html`.

3. Surface to user with a one-paragraph summary and next-action prompt (commit? PR?). **`--autonomous`:** the summary still surfaces, but the orchestrator does NOT run a commit/push/PR even if all tasks are green. State explicitly: *"Wave complete. Changes are uncommitted on `<branch>`. Run `/stx-checkin` or `/stx-pr-merge` to ship."* This matches the global autonomous-agent rule: never commit/deploy unattended.

## Iteration caps (summary)

- **Soft cap — 3 same-task iterations:** halt task, escalate to Architect, append Revision section. An iteration = one Reviewer rejection OR one QA red.
- **Hard cap — 5 same-task iterations:** halt wave, write `handoff.md`.
- **Suspicious-changes ceiling — 3 events on the same task:** auto-halt the task even if not at iteration cap.
- **Reviewer halt verdicts (instant):** `test-file-edit-detected`, `assertion-weakened`, `sut-mocked` — no counter increment, immediate halt.

These reconcile the user's auto-memory `feedback_qa_fixer_workflow.md` (≤3 same-topic) with the longer-running nature of feature work (multi-task loop).

## Halt conditions

The skill stops and surfaces — never silently continues — when:

- Worktree state cannot be confirmed (detached HEAD, no git, etc.).
- A persona file under `.claude/agents/` cannot be read at spawn time (treat as a fatal config error — do not fall back to inline prompts).
- `stx-feature validate` (or the validation inside `render`) rejects `wave-state.json`. The renderer names the offending field path and writes nothing. Fix the state — never hand-write the HTML to work around it, and never disable the check.
- The user declines any of the three gates.
- The Analyst cannot extract features from the initial_request (vague request — surfaces a clarifying interview round, run by the orchestrator).
- An agent's `open_questions[]` rounds exceed the cap (2 per agent per step) — the request is under-specified; halt and surface the unresolved questions.
- The Architect cannot tier a task (`tier == "unknown"` → halt, ask user).
- The QA agent cannot write a test for a task (timing-sensitive, infra-dependent) — QA documents *why* and proposes manual verification; orchestrator surfaces this rather than silently skipping.
- A Dev agent edits a test file or touches files outside `scope_paths`.
- The Reviewer returns a halt verdict (`test-file-edit-detected`, `assertion-weakened`, `sut-mocked`) — instant halt for the task, no iteration counter increment.
- An iteration cap or suspicious-changes ceiling trips.
- `npm run lint` or `npm run build` fails for a reason unrelated to the task.
- Out-of-scope guardrails (from `requirement-verse.html` or `architecture-verse.html`) are violated.

## Usage

```
/stx-feature                                    # Fully interactive
/stx-feature <one-line feature description>     # Seed initial_request, then interactive
/stx-feature --autonomous <feature description> # Auto-approve all 3 gates + worktree + Analyst/Architect interviews; halt only on destructive ops, commit/PR, reviewer halts, and iteration caps
/stx-feature --autonomous --concurrency=N <…>   # Override the default Dev concurrency cap (default 3)
/stx-feature --resume <wave-id>                 # (planned) Re-read wave-state.json, cd to worktree_path, re-run Step 0.5 verify, continue from saved status
```

`--autonomous` requires a feature description (positional argument or after the flag). Invoking `/stx-feature --autonomous` with no description halts immediately — the skill never fabricates `initial_request`. See **Autonomous mode** under Governance for the full list of what is and isn't bypassed.

The skill itself is conversational — you drive it with `/stx-feature`, not from a shell. It does ship one supporting binary, which the orchestrator calls on the user's behalf and which is safe to run by hand:

```
stx-feature map    [--root <dir>] [--out <file>]                  # build codebase-map.md
stx-feature brief  <wave-dir> --for <role> [--task <id>]          # slice state for one agent
stx-feature validate <wave-dir>                                   # check state, write nothing
stx-feature render <wave-dir> [--only requirement,architecture,qa,result,wiki]
```

Roles for `brief`: `analyst`, `architect`, `qa`, `reviewer`, `dev` (the last two require `--task`). All four subcommands are read-only with respect to the consuming project's source — they only touch `docs/waves/`.

The skill writes to disk: `docs/waves/wave-<slug>-<xxxx>/` in the consuming project.

## Requirements

- Git 2.30+ for modern `git worktree` semantics.
- Node.js 18+ — for the bundled `stx-feature` renderer as well as `npm run lint` / `npm run build`.
- A buildable command and at least one test runner in the consuming project (Playwright, Vitest, or both). Vitest is scaffolded only with user approval.
- For browser verification: Chrome DevTools or Playwright MCP server registered in the session.
- The eight persona files at `.claude/agents/stx-{analyst,architect,qa,dev-base,dev-tier-db,dev-tier-service,dev-tier-api,dev-tier-ui}.md`. The installer copies these alongside `.claude/skills/`.

## See also

- [`AGENTS.md`](../../../AGENTS.md) — repo-root persona inventory
- [`template.md`](./template.md) — the embedded orchestrator prompt template
- [`README.md`](./README.md) — design notes and rationale
- [`templates/`](./templates/) — bundled HTML templates and `wave-state.schema.json`
- [`stx-feature.js`](./stx-feature.js) — the bundled renderer (source: `src/skills/stx-feature.ts`, engine: `src/lib/template.ts`)
- [`/stx-fix`](../stx-fix/SKILL.md) — the single-bug sibling skill (shares `stx-qa.md`)
- [`/stx-checkin`](../stx-checkin/SKILL.md) — used to commit/push after wave completion
- [`/stx-pr-merge`](../stx-pr-merge/SKILL.md) — used to open and merge the wave PR
- [`/stx-worktree-report`](../stx-worktree-report/SKILL.md) — alternative end-of-wave reporting
