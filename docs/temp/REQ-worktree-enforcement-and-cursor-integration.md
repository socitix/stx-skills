# Requirement: Worktree enforcement hardening + Cursor integration

**Status:** Draft — operator conversation 2026-05-23  
**Author:** Sudipto (via Cursor analysis)  
**Implementation target:** `stx-skills` repo  
**Related:** `.claude/skills/stx-feature/SKILL.md`, `.claude/skills/stx-fix/SKILL.md`, `help.html` §pending, `~/.claude/CLAUDE.md` (global worktree rule)

---

## Problem

STX skills are **skill-driven**, not IDE-folder-driven (Claude Code model). Operators should not have to repeat “use a worktree” when invoking `/stx-feature` or `/stx-fix`.

Today:

1. **Step 0 creates a worktree** (`git worktree add .claude/worktrees/<name>`) but did **not** mandate switching the orchestrator session into it (`cd`).
2. Global `~/.claude/CLAUDE.md` says “switch the working session to it” — skills did not spell this out consistently.
3. **Gap:** orchestrator on `main` cwd can write `docs/waves/...` or production files to **main’s checkout** even after a worktree exists.
4. **Cursor** has a **separate native worktree system** (`/worktree`, Agents Window toggle, `.cursor/worktrees.json`) that does **not** integrate with STX’s `.claude/worktrees/` convention.

---

## Design principle (Claude Code)

| Layer | Role |
|---|---|
| `~/.claude/CLAUDE.md` | Global soft guard — every session |
| `/stx-feature`, `/stx-fix` Step 0 | Structured STOP + AskUser + create worktree |
| Step 0.5 | Mandatory `cd` + branch verify before any artifact write |
| `/stx-pr-merge` pre-flight | Refuses to run on `main` |
| Ad-hoc chat (no skill) | Global rule only — **weakest** |

Skills are the driving force. IDE folder is secondary for Claude Code; for Cursor it still affects default tool cwd unless the skill enforces otherwise.

---

## Strengthening the skill-driven model (implemented in v1.2.1 / v1.1.1)

### A. Mandatory post-create switch (Step 0.5) — `/stx-feature` and `/stx-fix`

After `git worktree add` succeeds, **before any file write or next step**:

```bash
WT=".claude/worktrees/<slug>"
cd "$WT"
git rev-parse --abbrev-ref HEAD    # must NOT be main/master
git rev-parse --show-toplevel      # must equal $WT (resolved)
```

- If branch is still `main`/`master` → **halt** with clear error.
- Print one-line confirmation: `Working in <branch> at <abs-path>`.
- All subsequent shell commands in this session use this cwd (or explicit `git -C "$WT"`).

### B. Persist worktree context in wave state — `/stx-feature`

Add to `wave-state.json`:

```json
{
  "worktree_path": "/abs/path/.claude/worktrees/wave-<slug>",
  "branch": "feat/wave-<slug>",
  "main_worktree_path": "/abs/path/to/main/checkout"
}
```

Write `wave-state.json` **inside the feature worktree** at `docs/waves/wave-<slug>-<id>/`.

### C. Pass worktree_path to every spawned agent

Orchestrator prepends to every Task/subagent prompt:

> **Worktree:** `<worktree_path>`. All reads, writes, and shell commands MUST run from this directory (or use `git -C` / absolute paths under it). Do not edit files in the main checkout.

### D. Resume convention — `/stx-feature --resume` (planned #7)

On resume:

1. Read `worktree_path` from `wave-state.json`.
2. Verify directory exists (`git worktree list`).
3. `cd` there + branch check (same as Step 0.5).
4. If worktree gone → halt with actionable message.

### E. Align `/stx-fix` template

`template.md` §0 Setup includes explicit `cd` + verify when `worktree_action == create-new`.

### F. Optional hard gate — project hook (consuming repos)

Consuming projects may add `.cursor/hooks.json` + script that **denies** Write/Delete when target file’s git branch is `main`. Note: `preToolUse` `"ask"` is not enforced today — use `"deny"`.

Hook must resolve branch **per file path** (`git -C $(dirname file) rev-parse --abbrev-ref HEAD`), not workspace cwd.

---

## Cursor integration (investigation — do not merge in v1)

STX skills **cannot** switch the Cursor IDE workspace programmatically. Cursor has **parallel** worktree features:

| Mechanism | What it does |
|---|---|
| **Agents Window → Worktree toggle** | Cursor creates an isolated checkout |
| **`/worktree <prompt>`** (Editor) | Rest of that chat in a separate checkout |
| **`.cursor/worktrees.json`** | Setup when **Cursor** creates a worktree |
| **STX `/stx-feature`** | `git worktree add .claude/worktrees/...` + Step 0.5 `cd` |

**Recommendation:** Keep STX `.claude/worktrees/` as canonical. Document that Cursor `/worktree` is a separate path. Rely on Step 0.5 + absolute paths + optional hooks in consuming repos.

See [Cursor Worktrees docs](https://cursor.com/docs/configuration/worktrees.md).

---

## Files updated

- [x] `docs/temp/REQ-worktree-enforcement-and-cursor-integration.md` (this file)
- [x] `.claude/skills/stx-feature/SKILL.md` — Step 0.5, subagent context, resume note
- [x] `.claude/skills/stx-fix/SKILL.md` — Step 1.5 post-create switch
- [x] `.claude/skills/stx-fix/template.md` — §0 Setup verification
- [x] `.claude/skills/stx-feature/templates/wave-state.schema.json` — worktree fields
- [x] `.claude/skills/stx-feature/README.md` — gap + fix documented
- [x] `.claude/skills/stx-help-html/help.html` — Cursor note + pending #9
- [x] `docs/index.html` — sync from help.html
- [x] `README.md` — skill-driven worktree subsection

---

## Acceptance criteria

1. Invoking `/stx-feature` from `main` creates worktree, **cds into it**, and first artifact (`wave-state.json`) is on the **feature branch**, not `main`.
2. `git status` on main checkout shows clean after Analyst gate (no wave artifacts on main).
3. Resuming a wave re-validates `worktree_path` before Dev wave (when `--resume` ships).
4. Help docs explain Claude vs Cursor worktree behavior.

---

## Open questions

1. Should STX unify with Cursor native `/worktree` in a future release?
2. Should `stx-feature` CLI preflight enforce Step 0.5 before LLM takes over?
3. Ship `stx-worktree enter <name>` helper that prints `cd` path for operators?
