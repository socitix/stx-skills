---
name: stx-pr-merge
description: End-to-end feature-branch workflow — commit, version-bump (conservative auto-infer; feat:/fix:/perf: → patch, feat!:/BREAKING → major, else none), push, open PR, build-validate, squash-merge, refresh main, tag vX.Y.Z and push tag, build-validate again, then clean up the worktree and branch. Halts on any step failure for user review. Records /stx-feature wave token+time usage at close-out.
version: 1.2.0
author: STX
---

# /stx-pr-merge

A guided multi-step git workflow that takes a feature branch from "uncommitted work" all the way through PR merge and worktree cleanup, with build validation gates on either side of the merge. Designed to be run by Claude Code in concert with the user's explicit step-chain approval.

## When to use it

- You're on a feature branch in a worktree, work is finished, and you want one chain that commits → PRs → merges → cleans up.
- You want hard build-validation gates around the merge so a broken main is caught immediately.
- You want the workflow to halt and surface anomalies (dirty worktree, build failures, unrelated errors) instead of silently continuing.

Do **not** use this skill for partial flows (e.g. just commit, just push). Use `/stx-checkin` for those.

## Governance — read before running

This skill operates under the user's CRITICAL governance rules from `~/.claude/CLAUDE.md`:

1. **Data Protection (HIGHEST PRIORITY).** No destructive operation runs without an explicit, named approval. Branch deletion, worktree removal, and force-deletes are all destructive and are gated.
2. **No Commits or Deployments Without Approval (HIGHEST PRIORITY).** `git commit`, `git push`, `gh pr create`, and `gh pr merge` all require approval before execution.
3. **Multi-Step Workflow Approvals exception.** When the user explicitly enumerates the chain ("commit, push, open PR, merge, refresh, clean") that single approval covers every named step. Steps **not** named are still gated separately.
4. **Stop and surface, do not skip.** A failed conditional step (build red, push rejected, merge conflict, unexpected file) halts the chain and reports back. The skill never silently retries or works around an anomaly.
5. **Treat the unexpected as a halt.** Untracked files you didn't create, an already-dirty parent worktree, a remote ahead of local, an unrelated test failure — all halt the chain pending user direction.

## Workflow steps

The chain runs strictly in order. Any failure stops the chain.

### Pre-flight

- `git status` — confirm working tree state. Anything unexpected (files the user didn't ask you to touch) halts.
- `git rev-parse --abbrev-ref HEAD` — confirm current branch is **not** `main` / `master`. If it is, halt.
- `git remote -v` — confirm a remote (`origin`) is configured. If not, halt.
- Capture the current worktree path (`git rev-parse --show-toplevel`) — this is the **feature worktree** that will be removed at the end.
- Resolve the **main worktree** (`git worktree list --porcelain`, find the entry whose branch is `refs/heads/main`). Capture its path — this is where build-validation #2 and worktree cleanup run.

### Record wave usage (best-effort)

If this branch was produced by a `/stx-feature` wave, record the wave's token + time usage **now — before the Commit step**, so the updated `wave-state.json` is staged with the commit and merged into the PR.

```bash
node "<skill-dir>/stx-pr-merge.js" --log-usage \
  --worktree-path "<feature worktree path from pre-flight>" \
  --branch "<branch>"
```

What it does:

- Finds the `docs/waves/*/wave-state.json` whose `worktree_path` / `branch` matches this branch. If none matches (a manual branch, or a `/stx-fix`), it prints one line and **skips** — there is nothing to log.
- Sums `message.usage` across the wave's transcripts under `~/.claude/projects/<encoded-worktree>/` — **every orchestrator session and every subagent** (`<session>/subagents/*.jsonl`: Analyst, Architect, QA, Reviewer, tier Devs), deduped by line `uuid`. Because each wave owns its worktree, that directory is exactly this wave's spend.
- Computes wall-clock time from the wave's `started_at` to now.
- Writes a `usage` block (token totals + duration + session/subagent counts) into `wave-state.json`.

This step is **best-effort**: it always exits 0. Any failure prints a one-line warning and the chain continues. A usage-logging failure must **never** fail or roll back a merge. (The full `stx-pr-merge.js` chain runs this same step automatically right after pre-flight; the standalone command above is for the Claude-driven prose path.)

### Commit

1. Stage explicit files by name (never `git add .` or `git add -A` blindly — see governance rule #1).
2. Draft a Conventional Commits message (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`).
3. Print the message and the staged file list to the user.
4. On approval, `git commit` with the heredoc form so multi-line messages survive shell quoting:
   ```bash
   git commit -m "$(cat <<'EOF'
   <subject>

   <body>

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

### Version bump (between Commit and Push)

Reads the just-made commit subject, picks a SemVer bump level (conservative auto-policy by default), writes a separate `chore(release): bump version to X.Y.Z` commit on top of the feature commit. The squash-merge in STEP 4 folds both commits back into one on `main`, so the on-main history stays clean.

**Auto-inference policy (default `--bump auto`):**

| Commit subject pattern | Inferred level |
|---|---|
| `feat:` / `fix:` / `perf:` | `patch` |
| `feat!:` / `fix!:` / `BREAKING CHANGE:` in body | `major` |
| `chore:` / `docs:` / `refactor:` / `style:` / `test:` / `ci:` / `build:` | `none` |
| Anything else | `none` (pass `--bump` to force) |

**`minor` and `major` are explicit-only.** The auto-policy never picks them on its own; pass `--bump minor` / `--bump major` (or use `/stx-version-bump`) when this PR warrants more than a patch. The one exception is `!` / `BREAKING CHANGE:`, which signals `major` deliberately.

Mechanics:

1. Find `package.json` with a `version` field (or `--version-file <path>` for non-Node repos). No source → skip silently.
2. Re-run safety: if `package.json` is already ahead of the latest `vX.Y.Z` tag, skip the bump (a previous run already did it) but remember the version so STEP 5b still tags.
3. Tag-collision check: halt if `vX.Y.Z` already exists locally or on origin.
4. `npm version <level> --no-git-tag-version`. (We disable npm's own commit + tag because we want our own subject shape and we tag on `main` post-squash, not on the feature branch.)
5. `git add package.json` (+ `package-lock.json` if present) — only the bump files, never `-A`.
6. `git commit -m "chore(release): bump version to X.Y.Z"` with a body that records `from → to` + the inference reason + the standard co-author trailer.
7. Informational only: if no `NEXT_PUBLIC_APP_VERSION` / `import.meta.env.*VERSION*` / `VERSION` file read is detected anywhere in the repo, print a one-line pointer to the surface-the-version recipe. **Never auto-scaffolds** — visual surfaces belong to the project's design system.

Halt conditions specific to this step:

- `package.json` exists but has no `version` field → halt.
- `npm` not on PATH (and no `--version-file`) → halt.
- Target `vX.Y.Z` already exists (local or remote) → halt.

Skip conditions (silent, with a one-line note):

- No `package.json` and no `--version-file`.
- Inferred level is `none` and the user didn't override.
- `--no-bump` / `--bump none`.
- Re-run case (pkg already ahead of the latest tag) — bump skipped, tag still happens.

### Push & PR

1. `git push -u origin <branch>`. If the remote rejects (non-fast-forward, protected branch, auth failure), halt.
2. `gh pr create --title "<subject>" --body "$(cat <<'EOF' ... EOF)"`. The body must follow this template:
   ```markdown
   ## Summary
   <1-3 bullet points covering the why>

   ## Test plan
   - [ ] <what was checked>
   - [ ] <build / lint / smoketest results>
   ```
3. Capture the PR number from the `gh` output for the merge step.

### Build validation #1 (feature worktree)

- Run `npm run build` (or the project's documented build command) **from the feature worktree**.
- On failure: **STOP**. Report the failing output verbatim. Do not merge. Do not retry. Do not proceed to cleanup.
- On success: continue.

### Squash-merge

1. `gh pr merge <num> --squash --delete-branch`.
2. If `--delete-branch` fails because the branch is checked out in another worktree (this is the common case — the feature worktree still has it), fall back to:
   ```bash
   gh api -X DELETE repos/:owner/:repo/git/refs/heads/<branch>
   ```
   This deletes the remote ref directly, bypassing the local-checkout safety check.
3. If the merge itself fails (conflicts, required reviews, failing checks), halt and report.

### Refresh main worktree

- `cd <main-worktree-path> && git pull --ff-only origin main`.
- If `--ff-only` fails (the main worktree has diverging local commits), halt — the user needs to resolve.

### Tag and push (after Refresh main)

Only runs when the bump step actually bumped (skipped otherwise — no version change → no tag).

1. `cd <main-worktree-path> && git tag vX.Y.Z` — points the tag at the post-squash SHA on `main`. Critical: tagging on the feature branch before the merge would orphan the tag (squash creates a new SHA), so we always tag on `main` after the fast-forward.
2. `git push origin vX.Y.Z` — pushes the tag.

Halt conditions specific to this step:

- `git tag` fails (most often: tag already exists locally — a previous run pushed it). Halt with a pointer to `--no-tag` for the rerun case.
- `git push origin vX.Y.Z` fails (network / auth). Halt with the explicit retry command.

Skipped silently when `--no-tag` is passed (the bump still happens; only the tag step is suppressed).

### Build validation #2 (main worktree)

- From the main worktree path, run the project's build command again.
- **Critical halt rule.** If this build fails on something that is clearly **unrelated** to the merged PR (e.g. a TypeScript error in a file the PR didn't touch, a test that was already broken, a missing dependency unrelated to the change), **STOP**. Do **not** proceed to worktree cleanup. Report the failure to the user verbatim and let them decide. The feature worktree must remain intact in case rollback is needed.
- If the build passes, continue to cleanup.

### Worktree cleanup

1. From the main worktree (never from inside the feature worktree), run:
   ```bash
   git worktree remove <feature-worktree-path>
   ```
2. If the remove fails because of build artifacts or untracked files inside the feature worktree, retry with `--force`:
   ```bash
   git worktree remove --force <feature-worktree-path>
   ```
   `--force` is safe here only because the work has already been merged to `origin/main` and the local main worktree is up to date — both invariants were verified in the steps above.
3. Detach & delete the local feature branch (it may still exist locally even after `--delete-branch` on the PR):
   ```bash
   git branch -D <branch>
   ```
   Use `-D` (force) because the branch was squash-merged — `-d` would refuse it as "not merged" since squash creates a new commit hash.

## Approval pattern

The skill expects to be invoked in one of two ways:

**Single chained approval (preferred).** The user says something like:
> "Commit these changes, bump version, push the branch, open a PR titled 'fix: timer offset', squash-merge it, refresh main, tag and push, and clean up the worktree."

That single sentence enumerates every step and counts as approval for the whole chain (per governance rule #3). The skill executes top to bottom and only halts on failure. The version-bump and tag-and-push steps are part of the chain by default; pass `--no-bump` to suppress both, or `--no-tag` to keep the bump but skip pushing the tag.

**Step-by-step.** The user invokes `/stx-pr-merge --interactive` (or omits a chained instruction). The skill prompts for approval at each commit/push/merge/cleanup boundary.

## Halt conditions (non-exhaustive)

The skill stops and surfaces — never silently continues — when any of the following occur:

- Pre-flight: dirty unrelated files, already on main, no remote, missing main worktree.
- Commit: empty message, staged-files list doesn't match what the user described.
- Version bump: `package.json` exists but has no `version` field; `npm` not on PATH; target `vX.Y.Z` already exists locally or on origin.
- Push: rejected by remote, branch protection violation, auth failure.
- PR: `gh` not installed or not authenticated, body template incomplete.
- Build #1: any non-zero exit from the build command.
- Merge: conflicts, required reviews not met, required checks failing.
- Refresh: non-fast-forward `git pull` on main worktree.
- Tag and push: `git tag vX.Y.Z` fails (tag already exists locally); `git push origin vX.Y.Z` fails (network / auth).
- Build #2: any non-zero exit, regardless of whether the cause appears related to the PR.
- Cleanup: `git worktree remove` failing for a reason other than build artifacts.

In every halt case the skill prints what happened, what state the repo is in, and what the user can do next. It does not roll back automatically.

## Usage

```bash
/stx-pr-merge                                  # Run with chained approval (read from prior message)
/stx-pr-merge --interactive                    # Prompt at each gate
/stx-pr-merge --dry-run                        # Print every command without executing
/stx-pr-merge --pr-title "fix: timer offset"   # Pre-supply the PR title
/stx-pr-merge --bump minor                     # Force minor bump (auto otherwise; see below)
/stx-pr-merge --no-bump                        # Skip version bump entirely (also skips tag)
/stx-pr-merge --no-tag                         # Bump version but don't push tag
/stx-pr-merge --version-file VERSION           # Use a plain VERSION file (non-Node repo)
/stx-pr-merge --skip-build-1                   # Skip pre-merge build (NOT RECOMMENDED)
/stx-pr-merge --skip-build-2                   # Skip post-merge build (NOT RECOMMENDED)
/stx-pr-merge --log-usage                      # Only record this wave's token+time usage, then exit
/stx-pr-merge --help
```

## Options

| Option | Description |
|---|---|
| `--interactive` | Prompt for approval at each gate (commit, push, PR, merge, cleanup). Default if no chained approval is detected. |
| `--dry-run` | Print every command that would run without executing. No git/gh state changes. |
| `--pr-title <s>` | Pre-supply the PR title. Otherwise derived from the commit subject. |
| `--pr-body <s>` | Pre-supply the PR body (must already follow the Summary / Test plan template). |
| `--build-cmd <s>` | Override the build command. Default: `npm run build`. |
| `--skip-build-1` | Skip pre-merge build validation. **Not recommended** — it's the cheaper of the two halt gates. |
| `--skip-build-2` | Skip post-merge build validation. **Not recommended** — this is the gate that catches a broken main. |
| `--bump <level>` | `patch` / `minor` / `major` / `none` / `auto` (default `auto`). Auto = `feat:`/`fix:`/`perf:` → patch; `feat!:` / `BREAKING CHANGE:` → major; else none. `minor`/`major` are never inferred — pass explicitly. |
| `--no-bump` | Shortcut for `--bump none`. Skips both STEP 1b (bump) and STEP 5b (tag). |
| `--no-tag` | Bump version but don't push the `vX.Y.Z` tag in STEP 5b. |
| `--version-file <path>` | Use a plain `VERSION` file instead of `package.json` (non-Node repos). |
| `-f`, `--force` | Skip non-destructive confirmations (does **not** bypass governance gates). |
| `--log-usage` | Only record `/stx-feature` wave token+time usage into its `wave-state.json`, then exit 0. Runs automatically (best-effort) during the full chain after pre-flight; this flag is for invoking it standalone. |
| `--worktree-path <s>` | (with `--log-usage`) Feature worktree to attribute usage to. Default: current worktree root. |
| `--branch <s>` | (with `--log-usage`) Branch to match a wave by. Default: current branch. |
| `--wave-state <s>` | (with `--log-usage`) Explicit `wave-state.json` path; skips auto-discovery under `docs/waves/`. |
| `-h`, `--help` | Show help. |

## Requirements

- Git 2.30+ (for modern `git worktree` semantics)
- GitHub CLI (`gh`) installed and authenticated
- A configured `origin` remote on GitHub
- Node.js 18+ (for the build command, if `npm run build` is used)
- The project must have a buildable command for the two validation gates

## See also

- [`/stx-checkin`](../stx-checkin/SKILL.md) — partial flow: commit and push only, no merge or cleanup
- [`/stx-version-bump`](../stx-version-bump/SKILL.md) — the bump step extracted as a standalone skill. Same shared policy, used for forgot-to-bump / override / release-PR-aggregation cases.
- [README.md](./README.md) — design notes and rationale
