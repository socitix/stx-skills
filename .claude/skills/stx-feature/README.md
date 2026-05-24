# /stx-feature — design notes

This document explains *why* the skill is shaped the way it is. For the user-facing contract see [`SKILL.md`](./SKILL.md); for the renderable prompt body see [`template.md`](./template.md); for the per-artifact HTML scaffolds see [`templates/`](./templates/).

## Goals

1. Take the friction out of running multi-agent feature loops. The user described the same agent setup pattern in repeated sessions; this skill bakes it in.
2. Force a **failing test first** for every task — never let a Dev agent freeform-investigate-and-build.
3. Hard-separate **problem definition** (Analyst), **solution structure** (Architect), **test ownership** (QA), and **implementation** (Dev). Each agent has a narrow contract and a single artifact.
4. Make the rendered prompt and the three pre-Dev artifacts visible to the user **before** any Dev burns cycles — so requirement misreads or architecture misfits get caught at the cheapest possible moment.
5. Track suspicious changes in real time, not after the fact, so scope drift surfaces immediately.

## Sibling skill: `/stx-fix`

`/stx-fix` is the two-agent (QA + Coder) loop for a single reproducible bug. `/stx-feature` is the four-role (Analyst + Architect + QA + Dev) loop for a multi-task feature.

The split is intentional:

- Bugs have a failing test as the spec; you don't need an Analyst or Architect to "design" the fix.
- Features have multiple acceptance criteria, multiple tiers, parallel work — and a real risk that the user's words don't match what they meant. That's why /stx-feature has three pre-Dev artifacts (requirement-verse, architecture-verse, qa-verse) instead of one prompt review.

If you have a *small* feature that's effectively one task and one test, use `/stx-fix` with the failing test framed as "expected new behavior." If you have a *bug* that turns out to span multiple tiers, use `/stx-feature` to decompose it.

## Why four roles, not three

An earlier draft folded Analyst and Architect into a single "Designer" role. The user pushed back for good reasons:

- **Analyst** answers "what problem are we solving and how does it affect the existing system?"
- **Architect** answers "what's the smallest, most reusable shape for the solution within our codebase?"

Conflating them produces designs that solve the wrong problem, or solutions that don't fit the project's idioms. Splitting them gives the user **two cheap review moments** (Gate 1 and Gate 2) where the cost of correction is just "rewrite a Feature card" or "amend a Task's scope_paths."

## Why three gates

Each gate is a place to catch a different class of error cheaply:

1. **Gate 1 (after Analyst)** — catches *misunderstood requirements*. The Analyst's Feature decomposition is the user's chance to say "no, that's not what I meant" before any architecture happens.
2. **Gate 2 (after Architect)** — catches *misfit solutions*. The Architect's tier breakdown + cited patterns is the user's chance to say "we already have a service for that" before any tests get written.
3. **Gate 3 (after QA)** — catches *misencoded acceptance*. The failing tests are the user's chance to confirm the system will be measured against the right behavior before any Dev burns iterations.

Skipping any gate produces a class of expensive bug downstream. Three gates feels heavy on a one-task feature; it pays off on anything with >2 tasks.

## Why dry-run is the default

By default, the skill stops at Gate 3 after QA writes failing tests. Three reasons:

1. The first three phases (Analyst, Architect, QA) are the **decision-dense** ones. The Dev phase is the **execution-dense** one. Splitting these into separate sessions lets the user review the planning artifacts overnight if they want.
2. Failing tests written by an agent are a non-trivial artifact in their own right — they encode acceptance criteria as code. The user should review them with full attention, not while distracted by Dev progress reports.
3. If something is wrong in the failing tests, fixing it now is cheap. If a Dev runs against wrong tests for 5 iterations, fixing is expensive.

Users who know what they want can opt out by setting `continue_past_dry_run: true` at the interview.

## Why Dev agents are tier-specialized

A Dev agent prompted for "implement this UI component" thinks about Tailwind classes and a11y. The same agent prompted for "write a Supabase migration" thinks about RLS and indexes. Generic Dev prompts force the agent to context-switch every task; tier-specialized prompts pre-load the right idioms.

The tier prelude files (`templates/dev-prompts/tier-*.md`) are deliberately short. They override `base.md` only on tier-specific rules. The orchestrator prepends the right one based on `task.tier` from `architecture-verse.html`.

## Why scope_paths over freeform "investigate as needed"

Two reasons:

1. **Parallelism safety.** Two Devs editing the same file is silent corruption. Disjoint `scope_paths` is a checkable rule.
2. **Scope drift detection.** A Dev that edits outside its declared `scope_paths` is doing something the Architect didn't plan for. That's not always wrong — sometimes the Architect missed a dependency. But it should be *surfaced*, not silent.

A Dev's diff is checked against scope_paths after each iteration. Out-of-scope file edits are logged to `wave-state.json.suspicious[]` and rendered into `result.html`. Three events on the same task auto-halt it.

## Why wave-state.json is canonical, HTML is rendered

HTML is great for humans, bad for orchestrators. If the wave halts mid-loop and resumes in a new session, the orchestrator needs to read structured state — "which tasks are done, which are paused, which suspicious events are open" — not parse free-form HTML. JSON gives us:

- Reliable resume after pause.
- Cheap state queries ("how many tasks are eligible to start?").
- Schema validation (`wave-state.schema.json`) so agents that write the file can be checked for compliance.

HTML is regenerated from JSON after each state change. It's a view, not a model.

## Why iteration caps reconcile differently than /stx-fix

`/stx-fix`'s caps are soft 3 / hard 5 *per bug*. `/stx-feature`'s caps are soft 3 / hard 5 *per task*. A wave with 8 tasks can spend 40 iterations total without violating either cap — and that's correct behavior, because each task is its own little loop.

The user's auto-memory says "halt if any agent loops >3× on the same topic." Same task = same topic, so soft cap 3 honors the memory. Hard cap 5 is the absolute ceiling per task; if a single task can't be done in 5 attempts, the architecture is wrong and Architect amendment hasn't helped.

## Why story-style code is a guideline, not a halt

Code style is subjective. If QA can reject a green-test Dev iteration because "the function names aren't action-named enough," loops stall on aesthetics. The right place for style is in the Dev prompt prelude (it's there in `base.md`) — agents will follow it when they can, and style review happens at PR time, not in the loop.

## How this composes with other skills

- `/stx-checkin` — invoked after wave done if `commit_policy == commit-after-green`.
- `/stx-pr-merge` — invoked after wave done if `commit_policy == commit-and-pr` AND the user approves the PR/merge chain.
- `/stx-report` — alternative end-of-wave reporting. `result.html` is wave-focused; `/stx-report` is worktree-focused.
- `/stx-fix` — the sibling for single bugs.

## What this skill explicitly does NOT do

- It does **not** investigate the feature for the user. The `initial_request` is required input; the Analyst will ask follow-up questions but won't invent a feature from a one-word prompt.
- It does **not** loop on the user's behalf when iteration caps trip. It halts and writes `handoff.md`. A human decides what changes (test, scope, architecture) before any retry.
- It does **not** auto-commit. Even with `commit-after-green`, the skill asks before running `git commit`.
- It does **not** auto-publish or auto-merge. PR creation and merge are separate user-approved steps via `/stx-checkin` and `/stx-pr-merge`.
- It does **not** maintain history across waves. Each wave is independent. A second wave for related work starts from scratch (intentional — old artifacts going stale is worse than re-decomposing).

## Worktree session switch (v1.2.1)

Step 0 creates the worktree; **Step 0.5** `cd`s into it and verifies branch ≠ `main` before any artifact or agent runs. `wave-state.json` records `worktree_path`, `branch`, and `main_worktree_path`. Every spawned agent gets a **Worktree** preamble so edits land on the feature branch even when the operator's IDE is still opened on main (especially Cursor).

See `docs/temp/REQ-worktree-enforcement-and-cursor-integration.md` for the full rationale and Cursor integration notes.

## Future work

- A CLI binary (`stx-feature`) that pre-validates the form (worktree exists, test runners installed, etc.) before the assistant takes over.
- A `--resume <wave-id>` mode that reads `wave-state.json`, runs Step 0.5 against `worktree_path`, and picks up from saved status.
- A `--linear-issue <id>` mode that creates/updates a Linear issue per wave (currently out of scope per user direction).
- A wave-level diff visualizer in `result.html` that shows scope-path coverage vs actual file changes.
