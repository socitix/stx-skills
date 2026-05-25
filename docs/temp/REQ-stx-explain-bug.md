# Requirement: `/stx-explain-bug` skill

**Status:** Draft requirement — implementation deferred to a separate session.
**Author:** Sudipto (drafted via Claude).
**Date:** 2026-05-24.
**Implementation target:** `stx-skills` repo (per skills-package convention).
**Dogfood source:** `findependence` PR #89 (`/full-plan-result` 404). The bug was diagnosed, explained in a fixed format, and fixed on approval entirely by hand in that session — this doc rephrases that ad-hoc flow as a reusable skill.

---

## Problem

When a user reports a bug ("this URL 404s", "the total is wrong", "the button does nothing"), the most valuable first deliverable is **a clear, evidence-backed explanation of *why*** — not an immediate code change. Jumping straight to a fix:

- hides the root cause from the user, so they can't sanity-check the diagnosis before code changes;
- risks fixing a symptom instead of the cause;
- produces commits the user can't evaluate because they never saw the reasoning.

There is already `/stx-fix` (a test-first, two-agent QA → Coder loop) for bugs the user wants locked behind a regression test. But that is heavyweight, and it leads with a *test*, not an *explanation*. There is no skill whose primary product is **a rigorous, consistently-formatted root-cause explanation, delivered for approval before any edit.**

The dogfood proved the shape of the missing skill. The user explicitly asked for a fixed explanation format:

```
=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
ERROR: <one-line title>
=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

Observation: <what was seen / how it reproduces>

Reason Found: <the actual root cause, evidence-backed>

Code Involved: <the responsible code, shortened>

Code Fix: <the proposed change, shortened / pseudo if needed>

=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
```

…then, **on approval**, the fix was applied and verified end-to-end (including a live DB query that proved the root cause, and a throwaway probe that proved the fix, which was then removed).

---

## Goals

1. **Explanation first, fix second.** The skill's primary output is a root-cause explanation in the fixed format above. No file is edited until the user approves.
2. **Evidence over guesswork.** The diagnosis cites real artifacts — `file:line`, an actual DB row, a log line, a live reproduction — never a plausible-sounding hypothesis presented as fact.
3. **Minimal, root-cause fix on approval.** The smallest change that addresses the *cause*, additive/non-breaking where possible, inside a worktree, verified before "done".
4. **Honest scope.** Distinguish "fixes future occurrences" from "repairs existing bad data"; flag data backfills as separate and approval-gated.
5. **Graceful handoff.** When the user wants regression-test rigor, hand off cleanly to `/stx-fix` instead of duplicating its loop.

**Non-goals:** multi-feature decomposition (that's `/stx-feature`); test-first authoring (that's `/stx-fix`); broad refactors; performance tuning; anything where there's no concrete reported symptom to anchor on.

---

## Relationship to sibling skills

| Skill | Leads with | Agents | When to use |
|---|---|---|---|
| `/stx-explain-bug` | **a root-cause explanation** (fixed format), then a gated minimal fix | single orchestrator, read-only diagnosis | "Explain *why* this is broken, then fix it once I'm satisfied with the diagnosis." |
| `/stx-fix` | **a failing test** that reproduces the bug | QA + Coder loop | "Reproduce it with a test, then make the smallest change that passes." |
| `/stx-feature` | **requirements → architecture → tests** | Analyst/Architect/QA/Reviewer/Dev wave | New functionality across tiers. |

`/stx-explain-bug` is the lightest of the three and the natural **front door** for a reported bug: diagnose and explain, then either fix directly (simple cause) or hand off to `/stx-fix` (wants a regression test).

---

## Workflow (proposed)

Strict ordering. One hard approval gate between explanation and edit.

### 1. Capture the report
Take the symptom from the invocation: a URL, an error message, a screenshot, a failing behavior, a stack trace. If the symptom is too vague to investigate, ask **one** focused clarifying question (how to reproduce / what was expected).

### 2. Investigate — read-only
- Reproduce or locate the failure path in code (cite `file:line`).
- Pull **runtime evidence** where it exists and is non-destructive: query the offending DB row (read-only), read the relevant log lines, hit the failing endpoint, drive the live repro. The dogfood's decisive evidence was a single read-only DB query showing `email != session.email` and `user_id = null`.
- Form the root cause from the evidence, not from intuition.

### 3. Emit the explanation (the fixed format) — and HALT
- Render the `=-=-=` banner block exactly (Observation / Reason Found / Code Involved / Code Fix).
- **Recommended addition:** a short **textual data-flow trace** showing where the value diverges (the dogfood used an arrow-chain from form input → POST → insert → route auth → 404). This is the single most clarifying element and SHOULD be included whenever a value/state flows across layers.
- Stop. Do not edit anything. Wait for explicit approval of the fix.

### 4. Fix — on approval only
- If edits will be made and the repo is on `main`/`master`, create a worktree first (global governance rule).
- Apply the **smallest** change that addresses the root cause. Prefer additive/non-breaking (the dogfood added a `user_id` ownership link and broadened auth to `user_id OR email`, leaving `email` semantics intact).

### 5. Verify
- Prove the original failing path now works **and** that the previously-passing path didn't regress.
- Prefer the same evidence channel used to diagnose (re-run, DB check, live repro). If a throwaway probe/script is created to prove it, **remove it afterward** (the dogfood wrote a one-off Playwright probe, confirmed it, then deleted it).

### 6. Report
- State what changed (files + line refs), the proof, and any residuals:
  - **forward-fix vs. data repair** — which existing bad records remain and whether a backfill is offered (separately, approval-gated);
  - any **sibling cleanup** left intentionally undone;
  - optional **/stx-fix handoff** if the user now wants a regression test.

---

## Requirements

### R1 — Explanation precedes any edit (hard gate)
**Problem:** the value of the skill is the *explanation*; editing first defeats it.
**Acceptance:**
1. The skill produces the fixed-format explanation block before any write tool is used on project files.
2. No `Edit`/`Write` to source occurs until the user explicitly approves the proposed fix. (Read-only investigation tools are unrestricted.)
3. If the user only wants the explanation (no fix), the skill stops cleanly after Step 3.

### R2 — Fixed explanation format
**Problem:** consistency makes these explanations skimmable and comparable across bugs.
**Acceptance:**
1. The banner block is emitted verbatim in structure: the `=-=-=` rule, `ERROR: <title>`, the `=-=-=` rule, then `Observation:`, `Reason Found:`, `Code Involved:` (shortened), `Code Fix:` (shortened/pseudo), closing `=-=-=` rule.
2. `Code Involved` and `Code Fix` are *shortened* — the responsible lines, not whole files; pseudo-code allowed for the fix.
3. A textual data-flow trace is included whenever the bug involves a value/state crossing layers (form → API → DB → render, etc.).
4. The skill never fills `Reason Found` with a hypothesis stated as fact — see R3.

### R3 — Evidence-backed diagnosis (no guessing)
**Problem:** a confident-sounding wrong root cause is worse than "I need to check."
**Acceptance:**
1. `Reason Found` must reference at least one concrete artifact: a `file:line`, a real DB row/value, a log line, or a live reproduction.
2. When runtime state is needed (a specific record, an env value, a response), the skill obtains it via a **read-only** query/probe before concluding. Destructive inspection is never used to diagnose.
3. If the evidence is inconclusive, the skill says so and proposes the next read-only probe rather than guessing.

### R4 — Minimal, root-cause fix
**Problem:** symptom-patching and scope creep.
**Acceptance:**
1. The applied change targets the *cause* named in `Reason Found`, not a downstream symptom.
2. The change is the smallest viable one; additive/non-breaking is preferred and called out when chosen over a riskier rewrite.
3. Files touched stay within the diagnosed surface; unrelated refactors are out of scope.

### R5 — Verification before "done"
**Problem:** "fixed" without proof is not fixed.
**Acceptance:**
1. The skill demonstrates the original failing path now succeeds, using a reproducible check.
2. It confirms no regression on the previously-working path (e.g. the sibling code path / the existing happy case).
3. Any throwaway verification artifact (probe script, temp test, scratch row) is removed or clearly flagged; permanent tests are deferred to `/stx-fix`.

### R6 — Worktree governance for the fix
**Problem:** the global rule forbids implicit edits on `main`.
**Acceptance:**
1. If the fix will edit tracked files and HEAD is `main`/`master`, the skill creates (or confirms) a feature worktree before editing.
2. The explanation phase (read-only) does **not** require a worktree.

### R7 — Forward-fix vs. data-repair honesty
**Problem:** a code fix often repairs *future* cases but leaves existing bad records broken; conflating the two misleads the user.
**Acceptance:**
1. The report explicitly states whether existing bad data remains affected.
2. Any data backfill/migration to repair existing records is presented as a **separate, approval-gated** step (it is a data mutation under the Data-Protection rule), never bundled silently into the fix.

### R8 — Clean handoff to `/stx-fix`
**Problem:** some bugs warrant a permanent regression test; this skill shouldn't reimplement that loop.
**Acceptance:**
1. After a fix (or instead of one), the skill can recommend `/stx-fix` and pass along the reproduction + root cause so the QA agent can author a failing test without rediscovering the bug.
2. The skill does not author permanent test files itself (that boundary belongs to `/stx-fix`'s QA persona).

---

## Inputs / invocation (proposed)

```
/stx-explain-bug <symptom>           # e.g. "/full-plan-result/<id> 404s after submitting a new plan"
/stx-explain-bug                     # interactive: prompt for the symptom + repro
/stx-explain-bug --explain-only      # stop after the explanation; never offer to edit
/stx-explain-bug --fix               # pre-authorize the minimal fix (still shows explanation first)
```

## Output / artifact location (open question — see below)
Default: the explanation is delivered inline in the conversation. Optionally `--save` writes it to `docs/bugs/<slug>.md` (per the "all docs under /docs/" convention) for a durable record.

---

## Open questions for implementation

1. **Artifact persistence.** Inline-only by default, or always persist the explanation to `docs/bugs/<slug>.md`? (Durable trail vs. noise.)
2. **Auto mode + the R1 gate.** Like `/stx-feature`'s interview gate, the explanation-before-edit gate must survive auto mode — auto mode must not let the agent skip the explanation and go straight to editing. Mirror the interview-survival mechanism from the `/implement-feature v2` requirements (`docs/req_29f2ce76.md`, R1).
3. **Multi-cause bugs.** If investigation finds two independent causes, emit two banner blocks, or one with a combined `Reason Found`? (Lean: one block per distinct root cause.)
4. **Severity / confidence line.** Add an optional `Confidence:` line to the banner (high / medium / needs-more-evidence) to make R3's uncertainty explicit?
5. **Single-agent vs. delegated diagnosis.** Run diagnosis in the main orchestrator, or delegate to a read-only `Explore`/diagnostic sub-agent to keep context clean on large repos?
