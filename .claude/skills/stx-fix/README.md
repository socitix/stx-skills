# /stx-fix — design notes

This document explains *why* the skill is shaped the way it is. For the user-facing contract see [`SKILL.md`](./SKILL.md); for the renderable prompt body see [`template.md`](./template.md).

## Goals

1. Take the friction out of running multi-agent bugfix loops. The user described the same agent setup in three previous sessions; that repetition is what `/stx-fix` removes.
2. Force a **failing test first** — never let an agent freeform-investigate-and-patch.
3. Hard-separate test ownership from code ownership so the Coder can't quietly weaken assertions to declare victory.
4. Make worktree compliance a first-class step, not something the user has to remember.
5. Make the rendered prompt visible to the user **before** any agent does any work, so the user can catch a misunderstood requirement at the cheapest possible moment.

## Why two agents, not three

An earlier draft included an Analyst agent between QA and Coder whose job was to break the bug into a numbered fix plan. The user removed it after seeing the trade-off:

- **Pro:** explicit decomposition for complex bugs.
- **Con (decisive):** every handoff loses information. Analyst writes a plan based on QA's test → Coder builds against the plan, not the test → if the plan was subtly wrong, the Coder can't tell, and the Analyst isn't around to correct mid-loop.

For most bugs, the failing test IS the spec. The Coder reads it directly and works backwards. If a future bug genuinely needs decomposition, that's a `multi-feat-multi-agent.md` shape, not this one.

## Why an explicit acceptance gate

The skill never starts the loop without showing the user the rendered prompt and getting a yes/no/edit answer. Two reasons:

1. **Misunderstood requirement is the most expensive bug.** If the user said "Pro Monthly should be marked Active" and the orchestrator interpreted that as "show a green badge" when the user meant "the entitlement gating should treat it as active," the test will be green but the bug will still be there. The acceptance gate catches that before agents burn cycles.
2. **The form is doing semantic compression.** Three or four user sentences become 200 lines of agent prompt. Showing the rendered output is the cheapest way to verify that compression preserved meaning.

## Why `--autonomous` exists (v1.2)

The acceptance gate is the right default, but it's wrong for two real workflows:

- **Batch retries after a halted loop.** The user already saw the rendered prompt last session, the form fields haven't changed, and forcing them to re-approve is friction without value.
- **Scripted invocations.** Cron-triggered or CI-triggered fixes (via `/schedule` or external systems) can't sit on an `AskUserQuestion`.

`--autonomous` resolves both: the gate is auto-approved, the optional-field interview is skipped, and the rendered prompt is still printed to stdout as the audit trail. What it pointedly does **not** bypass is anything destructive — `commit_policy` is forced to `no-commit` (per the global "Autonomous agent special rules" — no commits/deploys while unattended), reviewer halts and test-file edits still stop the loop, and the four required fields (`title`, `issues`, `repro`, `expected`) must be supplied at invocation or the skill halts with a one-line error.

The bar for "can `--autonomous` skip this?" is the same as the bar everywhere else in the user's global rules: **interactive confirmation** of something already implied → bypass; **destructive operation** or **commit/deploy** → never bypass.

## Why iteration caps are explicit

Loops without caps drift. The skill enforces two caps from the user's auto-memory (`feedback_qa_fixer_workflow.md`):

- **Soft cap (3 same-symptom):** if the Coder fixes a symptom, the test passes, but the same symptom returns the next iteration, the loop is converging on the wrong abstraction. Three is enough evidence; halt.
- **Hard cap (5 total, configurable):** absolute ceiling. Even if every iteration is "different," five Coder attempts means the bug is bigger than the fix shape we picked.

When a cap trips, the skill doesn't just stop — it writes a handoff doc with what was tried, why each attempt didn't work, and a working hypothesis. That makes the next session productive instead of a cold restart.

## Why the Coder is forbidden from touching test files

This rule comes directly from the user's auto-memory `feedback_qa_fixer_workflow.md`. The failure mode it prevents:

> Coder hits a stubborn test, decides the test "isn't realistic," edits it to make it pass, declares green. The bug is still there; the test is now lying.

`SKILL.md` elevates a test-file-touch to a halt-the-loop offense — the orchestrator stops the chain and surfaces it, instead of letting the Coder talk its way out.

## Worktree-first

The user's global rule (`~/.claude/CLAUDE.md`) is "never implicitly work on `main`." Step 1 of the skill is a hard worktree check before any other question. If the user is on main, the skill stops and proposes a new worktree before asking anything else. **Step 1.5** (v1.1.1) then `cd`s into the worktree and verifies branch ≠ `main` before the interview or any file write — including in Cursor, where IDE workspace folder may still be main.

See `docs/temp/REQ-worktree-enforcement-and-cursor-integration.md`.

## How this composes with other skills

- **`/stx-checkin`** is invoked at the end of the loop if `commit_policy = commit-after-green`.
- **`/stx-pr-merge`** is invoked at the end of the loop if `commit_policy = commit-and-pr` AND the user later approves the PR/merge chain.
- **`/stx-worktree-report`** can be run after a green loop to produce a polished HTML summary of what changed.

The skill doesn't shell out to those automatically — it surfaces them as the recommended next step in §9 of the rendered prompt.

## What the skill explicitly does NOT do

- It does **not** investigate the bug for the user. The repro and expected behavior are required inputs; the skill won't infer them from a vague report.
- It does **not** loop on the user's behalf when iteration caps trip. It halts and writes a handoff. A human decides what changes (test, scope, agent type) before any second attempt.
- It does **not** auto-commit. Even with `commit-after-green`, the skill asks before running `git commit`.
- It does **not** drive feature work. New features need a different planning shape; use `multi-feat-multi-agent.md` or a custom plan.

## Future work

- A small CLI binary (`stx-fix`) could pre-validate the form fields offline (e.g. confirm the repro URL is reachable, confirm the test runner exists). For now the validation happens during the interview step inside the assistant.
- A `--from-file <path-to-form.json>` mode would let the user re-run the same form non-interactively for retries after a halted loop.
