# stx-worktree-report — design notes

Captures the prompt and HTML scaffold used to produce a polished single-file report from a finished (or near-finished) worktree.

## Why this exists

A finished worktree has three audiences:

1. **Human reviewers** who need the *why*, not just the diff.
2. **Future Claude sessions** that may need to revisit a decision.
3. **Stakeholders** who don't want to read source.

`git log` covers the diff. This skill covers the rest: trade-offs considered, surfaces touched, runtime flow, test evidence, and caveats deferred. The output is one self-contained `.html` file you can open locally or attach to a PR.

## Why an embedded HTML template (not Markdown)

- **Diagrams render in place.** Mermaid via CDN means flowcharts and sequence diagrams display without a static-site build step.
- **Inline diff styling.** Markdown's code fences look like every other code block; the template's `.diff` blocks distinguish hunks visually with gutters and add/remove colours.
- **Self-contained.** A reviewer opens the file with `open <path.html>` — no npm, no preview server, no IDE plugin.
- **Consistent shape.** Every report has the same seven sections in the same order, so reviewers know where to look.

## What the CLI helper does

`stx-worktree-report` (the bin) is a thin context-collector. When run from a terminal in a worktree:

```bash
stx-worktree-report                  # JSON to stdout
stx-worktree-report --base develop   # diff against a non-default base
stx-worktree-report --pretty         # human-readable summary
stx-worktree-report --help
```

It emits worktree path, branch, base branch, diff stat, name-status list, recent commits, and a flag indicating whether changes are uncommitted. Claude consumes this when invoked as `/stx-worktree-report` to skip the gather-context step. Standalone, it's a useful sanity-check before opening a PR.

The CLI never writes the HTML file — Claude does. Splitting context-gathering from report-writing keeps the CLI tiny and the report tunable per-project.

## Structure of a good report

The skill enforces seven sections, in order:

1. **Executive summary** — 2–4 sentences. Stats panel. Status pills.
2. **Why this approach** — trade-off table with rejected reasons. The single most valuable section.
3. **Architecture** — one or two Mermaid diagrams (surfaces; runtime flow; or multi-agent execution).
4. **File-by-file changes** — summary table + per-file rationale + the *one* hunk that tells the story.
5. **Test results** — actual runner output, lightly trimmed.
6. **Caveats / deferred polish** — what was noticed but not fixed, and why.
7. **Out of scope** — what a reader might assume changed but didn't.

If a section has nothing to say, leave its placeholder filled with a one-line "Not applicable" note rather than emitting an empty section. The visual rhythm matters.

## Customising the template

The template is intentionally one file. To customise:

- **Change colours** → edit the `:root` CSS variables.
- **Add a section** → append a new `<section>` and a corresponding `{{TOKEN}}` to fill in. Update `SKILL.md`'s token table.
- **Replace Mermaid** → swap the CDN script for another diagram lib. Update the `.mermaid` rule.
- **Per-project branding** → fork this skill in the consuming project's local `.claude/skills/` (the skill installer doesn't overwrite project-local skills with the same name).

## Anti-patterns

- ❌ Auto-generating from `git log` only. The agent reports, decisions, and rejected paths are the value.
- ❌ Pasting full diffs. Pick the hunk that tells the story; cite line ranges for the rest.
- ❌ Inventing alternatives. If only one path was sensible, say so in one sentence and skip the table.
- ❌ Committing the report from inside the skill. Per global CLAUDE.md, every commit needs explicit user approval.

## See also

- [SKILL.md](./SKILL.md) — the prompt that runs when `/stx-worktree-report` is invoked.
- [template.html](./template.html) — the HTML scaffold with `{{TOKEN}}` placeholders.
