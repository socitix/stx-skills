# stx-pr-merge Skill — Design Notes

Design rationale and edge-case discussion for the `/stx-pr-merge` skill. End-user docs live in [SKILL.md](./SKILL.md).

## Problem statement

`/stx-checkin` already covers commit + push + PR creation, but a feature branch's life doesn't end there. After the PR opens, a developer still has to:

1. Watch the build and review checks
2. Squash-merge the PR
3. Pull the new main locally
4. Verify the merged main still builds (catches regressions caused by interactions with other recently merged PRs)
5. Tear down the worktree
6. Delete the local branch (which `git branch -d` refuses for squash-merged branches because the commit hash differs)

Each of those steps has a known failure mode, and skipping any of them leaves the repo in a half-cleaned state. `/stx-pr-merge` codifies the entire chain so the developer (or Claude) executes them in order and halts on any failure.

## Why two build-validation gates

**Build #1 (pre-merge, in the feature worktree).** Catches "I forgot to run the build before pushing" — the cheapest possible failure. If this fails, nothing has been merged yet, so recovery is just "fix the build, recommit, repush."

**Build #2 (post-merge, in the main worktree).** Catches the harder case: the PR builds in isolation but breaks main when combined with another recently-merged change. This is the gate that protects `main` from going red. If it fails, the feature worktree must remain intact so the user can investigate without losing their working state.

The two gates exist because they catch different bugs. Removing either one defeats the purpose; both `--skip-build-1` and `--skip-build-2` are explicitly labelled "not recommended" in the skill body.

## Why squash-merge is the only supported mode

- Linear history is the project default for the org.
- `--squash` produces one commit on main per PR — easy to revert, easy to bisect.
- `--merge` (true merges) and `--rebase` (rebase-merges) produce different cleanup semantics and would each need their own halt logic. Out of scope for v1.

If a PR truly needs a non-squash merge, the user should drop out of the chain at the merge step and run the merge by hand.

## The local-branch-checked-out-elsewhere problem

`gh pr merge --delete-branch` runs the equivalent of `git push origin --delete <branch>`. GitHub itself is fine deleting the remote ref. But on the local side, if the branch is checked out in another worktree (which is exactly the case here — the feature worktree still has it), `gh` falls back to a safety check that refuses the delete.

The documented workaround is the direct API call:

```bash
gh api -X DELETE repos/:owner/:repo/git/refs/heads/<branch>
```

This deletes the remote ref without touching local state, which is what we want — the local branch is cleaned up later in the cleanup step using `git branch -D` after the worktree is removed.

## Why `git branch -D` (not `-d`)

After a squash-merge, the local feature branch's commit hash is **not** an ancestor of `main` — main has the squashed commit, with a different hash. `git branch -d <branch>` correctly refuses to delete because, by its safety check, the branch is "not merged."

`-D` (force-delete) is safe here because:

1. Build #2 has already verified that main builds correctly with the merged change.
2. The remote ref was deleted in the merge step.
3. The work survives in `main` as the squashed commit.

So the only thing being thrown away is the local pre-squash commit graph, which has no value at this point.

## Why `--force` on `git worktree remove`

Plain `git worktree remove` fails if the worktree contains untracked files or modifications. After a build, the feature worktree always has untracked build artifacts (`dist/`, `.next/`, `node_modules/.cache`, etc.). `--force` ignores those.

This is safe **only** because we've already verified:

- The work is in `origin/main` (squash-merge succeeded)
- The local main worktree is up to date with `origin/main` (post-merge pull succeeded)
- The post-merge build passes (build #2 succeeded)

If any of those preconditions fail, the chain halts before reaching cleanup, and the feature worktree is preserved for inspection.

## Halt-don't-recover philosophy

Every conditional step has a halt clause but no auto-recovery. Rationale:

- Auto-recovery in a destructive workflow is how you turn a fixable problem into an unrecoverable one.
- The user almost always has more context about *why* a step failed than the skill does.
- Halting and surfacing matches the global "treat the unexpected as an anomaly" rule from `~/.claude/CLAUDE.md`.

The skill prints state ("you are still on `<branch>`, the PR is open at `<url>`, build #1 failed with: `<output>`") and stops. The user picks the next move.

## Approval semantics

The "Multi-Step Workflow Approvals" exception is real but narrow: the user must enumerate the chain. A vague "go ahead" does **not** cover the chain — the skill should fall back to per-step prompts in that case.

In practice, an enumerating instruction looks like:
> "Commit these changes, push the branch, open a PR titled X, merge it, refresh main, and clean up the worktree."

A non-enumerating instruction looks like:
> "Ship this." or "Go ahead." or "Yes, proceed."

The first counts as chain approval. The second does not, and the skill should run in interactive mode.

## Implementation architecture

```
stx-pr-merge.ts
├── ANSI Colors (matches stx-checkin / stx-image)
├── CLI Options
│   ├── parseArgs()
│   └── showHelp()
├── Git Helpers
│   ├── execGit()                    # shared with the stx-checkin shape
│   ├── getCurrentBranch()
│   ├── isMainBranch()
│   ├── findMainWorktreePath()       # parses `git worktree list --porcelain`
│   └── getRepoSlug()                # owner/repo from origin URL
├── Workflow Steps
│   ├── step0_preflight()
│   ├── step1_commit()
│   ├── step2_pushAndPr()
│   ├── step3_buildValidate()        # used for both build #1 and build #2
│   ├── step4_squashMerge()
│   ├── step5_refreshMain()
│   ├── step6_cleanupWorktree()
│   └── step7_deleteLocalBranch()
├── Wave usage logging              # token + wall-clock time per /stx-feature wave
│   ├── encodeProjectDir()          # cwd → ~/.claude/projects dir name
│   ├── sumProjectDir()             # sessions + */subagents/*.jsonl, dedup by uuid
│   ├── findWaveStatePath()         # match docs/waves/*/wave-state.json to branch
│   └── logWaveUsage()              # best-effort; writes the `usage` block
└── Halt helpers
    ├── halt(reason, context)        # prints state + exits non-zero
    └── confirmStep(label)           # interactive-mode gate
```

## Why wave usage logging lives here (not in `/stx-feature`)

A `/stx-feature` wave finishes — and renders its `result.html` — *before* the branch is merged. The merge is what truly closes the episode, and `/stx-pr-merge` is the one step that runs at that boundary with the worktree path, branch, and PR number already in hand. So this is where the wave's final token + time tally is taken.

The record is written **before the commit step** so the updated `wave-state.json` is staged into the PR and merged — no post-merge write to a clean `main`, no separate database. Each wave owns its worktree, and Claude Code writes every turn's usage (orchestrator *and* every subagent) under `~/.claude/projects/<encoded-worktree>/`, so summing that one directory — deduped by line `uuid` — is exactly this wave's spend. The whole thing is a pure reader of on-disk transcripts; nothing instruments the model.

**Best-effort by contract.** `logWaveUsage()` never throws and the step always exits 0. A merge must never fail because usage couldn't be tallied. Branches with no matching wave (a manual branch, or a `/stx-fix`) are skipped silently.

**Deliberately out of scope (v1):** estimated USD cost, `/stx-fix` episodes (no wave JSON), surfacing the numbers in `result.html` / `wave-wiki.html` (the data lands in `wave-state.json`; rendering it is a follow-up), and the kickoff turns before Step 0.5 creates the worktree (no subagents run there).

## Future enhancements

- **Multi-PR chains.** Sometimes a feature spans 2-3 PRs that need to merge in order. v2 could accept a list.
- **Auto-rollback offer.** If build #2 fails, the skill could offer to revert the squash commit on main. v1 explicitly does **not** do this — the user decides.
- **Linear / Jira integration.** Write the merged PR's URL back to the linked issue.
- **Custom merge strategy.** Support `--merge-method merge|squash|rebase` instead of squash-only.

## References

- [GitHub CLI: `gh pr merge`](https://cli.github.com/manual/gh_pr_merge)
- [Git: `git worktree`](https://git-scm.com/docs/git-worktree)
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [`/stx-checkin` SKILL.md](../stx-checkin/SKILL.md) — companion skill for partial flows
