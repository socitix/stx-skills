---
name: stx-help-html
description: Open the STX Skills walkthrough documentation in your default browser. Single-file HTML covering the 5-minute tour, the three-zone (main / worktree / any) model, the worktree lifecycle, an expandable skill catalog, the settings reference, and the pending-features backlog. Use when the user asks for help, an overview, or a walkthrough of the skills, or when explaining the workflow to a teammate.
version: 1.11.0
author: STX
zone: any
---

# /stx-help-html

A thin shell-out skill. It opens the bundled `help.html` walkthrough in the
user's default browser. The HTML is the canonical documentation for the
STX Skills package — covering installation, the three-zone model, the
worktree lifecycle, every shipped skill, the settings reference, and the
pending-features backlog.

## When to use it

- The user asks "how do I use these skills?", "what skills are available?",
  "show me the docs", or any variant of help-seeking.
- The user wants the walkthrough with diagrams and examples, not just
  terse in-terminal text.
- Explaining the workflow to a teammate — the HTML is shareable and
  self-contained.

## When NOT to use it

- The user wants terse in-terminal output. Use `/stx-help` (planned text
  version) instead.
- The user is asking about a specific skill in detail — read that skill's
  `SKILL.md` directly and answer from there.

## Zone

`zone: any` — branch-agnostic. Opens a static HTML file, doesn't touch
project state. Safe to run on `main` or inside any worktree.

## How it works

The skill runs a single shell command via Bash:

```bash
open .claude/skills/stx-help-html/help.html
```

That's all. The HTML is self-contained (web fonts via CDN, but the page
is fully usable offline if fonts fail to load). No flags, no arguments,
no state.

## Where the HTML lives

```
<project>/.claude/skills/stx-help-html/
├── SKILL.md       # this file
└── help.html      # the walkthrough doc (shipped with the skill)
```

The HTML is part of the skill package itself. Re-running the installer
(`npx <stx-skills-path>`) refreshes the HTML to the latest version
shipped with the package.

## Usage

```
/stx-help-html
```

That's the entire surface. No options.

## Implementation notes for the assistant

When the slash command fires, do the following in order:

1. Confirm the file exists at `.claude/skills/stx-help-html/help.html`
   (relative to the project root). If not, surface an error and
   recommend re-running the installer.
2. Run `open .claude/skills/stx-help-html/help.html` via Bash.
3. Output a single confirming line: "Opened the STX Skills walkthrough
   in your default browser." No further commentary.

If the user is on Linux (where `open` is `xdg-open`) or the platform
isn't macOS, fall back to printing the absolute path and recommending
they open it manually. Do not try to detect a browser — the user can
copy-paste the path.

## See also

- `help.html` — the bundled documentation
- [`/stx-skill-settings`](../stx-skill-settings/SKILL.md) — view/edit
  the project's settings file (planned, PR-B)
