---
name: stx-help
description: Print a terse in-terminal usage summary for the STX Skills package — every shipped skill with a one-line purpose, grouped by where you run it (main / worktree / any). Ends with a one-line pointer to /stx-help-html for the visual walkthrough with diagrams. Use when the user wants a quick reference without opening a browser.
version: 1.0.0
author: STX
zone: any
---

# /stx-help

A terse text-mode help skill. Lists every shipped STX skill grouped by
when you run it, with one-liner purposes. Ends with a pointer to
`/stx-help-html` for the visual walkthrough.

This is the sibling of `/stx-help-html`. Same content, opposite medium.

## When to use it

- The user wants a quick reference without opening a browser.
- They asked "what skills are available?" / "what can I do?" / `--help`.
- They want to see the names and groupings, not the long-form details.

## When NOT to use it

- The user wants the walkthrough with diagrams → use `/stx-help-html`.
- They asked for a specific skill's details → read its `SKILL.md`.

## Zone

`zone: any` — prints text. No state mutation. Safe anywhere.

## Implementation — what the assistant should print

When this skill fires, print exactly this block (no extra commentary
before or after):

```
STX Skills · v1.10.0

MAIN-BOUND       run on main, before any worktree exists
  /stx-feature        Multi-agent wave (Analyst → Architect → QA → Dev ↔ Reviewer)
                      Add --autonomous to auto-approve gates (never commits)
  /stx-fix            Two-agent QA → Coder loop for a known bug
                      Add --autonomous to skip the acceptance gate (never commits)
  /stx-skill-settings View/edit project settings (planned)

WORKTREE-BOUND   run inside a feature worktree
  /stx-pr-merge          Commit → PR → build → squash-merge → cleanup chain
  /stx-worktree-report   Generate HTML report of worktree changes

ANY-BOUND        runs anywhere — main or any worktree
  /stx-checkin           Secure commit + push with security scan
  /stx-image             Audit and optionally resize project images
  /stx-magazine-report   Magazine-style HTML report from any source (4 palettes)
  /stx-help              This text help
  /stx-help-html         Full walkthrough doc with diagrams (recommended)

PERSONAS         versioned agent contracts under .claude/agents/ (10 total)
  stx-analyst, stx-architect, stx-qa, stx-reviewer (NEW), stx-coder,
  stx-dev-base, stx-dev-tier-{db,service,api,ui}        See AGENTS.md

For the walkthrough with diagrams, examples, and the settings reference:
  /stx-help-html
```

Notes for the assistant:

- Keep the block exactly as above. Don't paraphrase. Developers scan,
  they don't read.
- If a skill's status changes (e.g., `/stx-skill-settings` ships), update
  this block accordingly when editing this SKILL.md.
- The trailing pointer to `/stx-help-html` is mandatory. It's the
  whole reason this skill exists in addition to that one.

## Usage

```
/stx-help
```

No options. No arguments. No flags.

## See also

- [`/stx-help-html`](../stx-help-html/SKILL.md) — visual walkthrough
