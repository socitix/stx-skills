---
name: stx-worktree-report
description: Generate a polished single-file HTML report explaining the changes made in a git worktree (or branch). Renders an executive summary, approach trade-off table, architecture diagrams (Mermaid), per-file diffs, test results, and deferred caveats — using the embedded template in this skill so every report has a consistent shape.
version: 1.11.0
author: STX
---

# /stx-worktree-report

Produces a self-contained `*.html` file under `docs/` that documents the work done in a git worktree (or feature branch). The output is the same shape every time: executive summary with stats, approach trade-off table, architecture diagrams via Mermaid, file-by-file change summary with inline diffs, test results, and a "deferred caveats" section.

## When to use it

- A worktree is finished (or near-finished) and you want a human-readable artifact for review or sharing.
- You want to capture *why* an approach was chosen, not just *what* changed (commits already cover that).
- A teammate or stakeholder needs the change explained without reading source.

Skip it for trivial single-line fixes — `git log` is enough.

## Usage

User invokes via `/stx-worktree-report`, optionally with arguments:

```
/stx-worktree-report                                # use cwd, infer everything
/stx-worktree-report --worktree <path>              # explicit worktree path
/stx-worktree-report --base <branch>                # diff base (default: main)
/stx-worktree-report --output <path.html>           # explicit output file
/stx-worktree-report --title "<one-line title>"     # override report title
```

The CLI helper `stx-worktree-report` (when run from a terminal) prints worktree context as JSON. When invoked as a slash command, follow the procedure below.

## Procedure (when invoked as `/stx-worktree-report`)

### Step 1 — Resolve scope

Determine the worktree to document:

1. If `--worktree <path>` is passed, use it. Otherwise use the current working directory.
2. Confirm it's a git repo: `git -C <path> rev-parse --show-toplevel`. If not, stop and ask the user.
3. Branch name: `git -C <path> branch --show-current`.
4. Base branch: `--base <branch>` if passed, otherwise default to `main`. (Fall back to `master` if `main` doesn't exist.)
5. Compute output path:
   - If `--output` is passed, use it.
   - Otherwise default to `<worktree>/docs/<branch-name>-report.html`. (If the user has a project rule like "all docs under /docs/", honour it — the default already does.)
   - If a file already exists at that path, **ask before overwriting**.

### Step 2 — Gather context

Run these in parallel (single Bash batch where possible):

```bash
# Branch + diff overview
git -C <worktree> branch --show-current
git -C <worktree> log --oneline <base>..HEAD
git -C <worktree> diff --stat <base>...HEAD
git -C <worktree> diff --name-status <base>...HEAD
git -C <worktree> status --short

# Per-file diffs (read on demand for the files you'll cite — don't dump everything)
git -C <worktree> diff <base>...HEAD -- <file>
```

Also capture, if visible in conversation history:
- Test runner output (playwright, vitest, jest)
- Build / lint output
- Any agent reports from earlier in this session (designer / QA / coder hand-offs)

If the worktree is uncommitted (working-tree changes only), use `git diff` and `git diff --cached` instead of `<base>...HEAD`.

### Step 3 — Read the template

Read `template.html` from this skill's directory. It's a complete HTML page with `{{PLACEHOLDER}}` tokens for the sections Claude fills in. **Do not rewrite the CSS or the chrome** — the template owns the visual style. Only replace the placeholders.

Tokens in the template (replace each one as a literal string substitution):

| Token | Content type |
|---|---|
| `{{TITLE}}` | One-line headline. If user passed `--title`, use it. Otherwise infer from the work — verb-led, ≤80 chars (e.g., "Replacing the PNG download with a single-page PDF"). |
| `{{EYEBROW}}` | Short context tag (e.g., "Worktree Report · branch `quick_start_output`"). |
| `{{BRANCH}}`, `{{WORKTREE_PATH}}`, `{{GENERATED_DATE}}` | Literal values. |
| `{{EXEC_SUMMARY_HTML}}` | 2–4 sentences describing what changed and why. Plain `<p>` tags. |
| `{{STATS_HTML}}` | Stat cards. Use the existing `.stat` markup from the template. Typical stats: files changed, net lines (`+X −Y`), new deps, test status. |
| `{{STATUS_PILLS_HTML}}` | `.pill` spans summarising state: build/lint/tests/commit-status. |
| `{{APPROACH_HTML}}` | Trade-off table (`<table>`) of options considered, why one was chosen. Always include a "rejected" reason for the others — the *why* is the value. Use `.pill.green` for the chosen row, `.pill.gray` for rejected. |
| `{{KEY_INSIGHT_HTML}}` | Optional `.callout` with the single sentence that captures *why* this design works. Omit if there isn't one. |
| `{{DIAGRAM1_MERMAID}}` | First Mermaid diagram body (no fences). Typically a `flowchart` showing surfaces touched / data flow. Always include unless the change is genuinely 1-dimensional. |
| `{{DIAGRAM2_MERMAID}}` | Second Mermaid diagram. Typically a `sequenceDiagram` for the runtime flow, OR a flowchart for multi-agent execution. Use only if it adds info the first diagram doesn't. Otherwise leave the wrapper empty (don't render an empty `.mermaid` block). |
| `{{FILES_TABLE_HTML}}` | Summary table of changed files with owner (if multi-agent), status pill, and ± counts. |
| `{{FILE_DETAILS_HTML}}` | One `<h3>` per non-trivial file, followed by a 2–3 sentence rationale and a `.diff` block showing the most informative hunk. **Don't paste the whole diff** — pick the hunk that best tells the story. |
| `{{TEST_RESULTS_HTML}}` | `<pre><code>` block containing the actual test runner output, lightly trimmed. |
| `{{CAVEATS_HTML}}` | `<ol>` of things noticed but deliberately not fixed in this worktree (with reasons). |
| `{{OUT_OF_SCOPE_HTML}}` | `<ul>` of explicit non-goals: things a reader might assume changed but didn't. |

### Step 4 — Fill the template

Use string substitution on the template's text — read the file, do `replace` on each token, write the result. Don't try to parse the HTML.

Diff blocks use this structure (already styled by the template's CSS):

```html
<div class="diff">
  <div class="hunk">@@ short label @@</div>
  <div class="line ctx"><span class="gutter"> </span><span class="body">unchanged line</span></div>
  <div class="line rem"><span class="gutter">−</span><span class="body">removed line</span></div>
  <div class="line add"><span class="gutter">+</span><span class="body">added line</span></div>
</div>
```

Mermaid diagrams render at runtime — just emit valid Mermaid source between the `<div class="mermaid">…</div>` tags (the template already initialises Mermaid).

### Step 5 — Write and verify

1. Write the filled-in HTML to the resolved output path. If `docs/` doesn't exist, create it first.
2. Tell the user the absolute path and one open command:
   ```
   open <abs-path>
   ```
3. **Do not commit.** Per global CLAUDE.md, every commit needs explicit approval — this skill never commits.

## Style guidance for the report content

- **Lead with the story, not the diff.** Why this change exists matters more than the line count.
- **Show alternatives.** A trade-off table with rejected options + reasons is the difference between a code-review artifact and a useful report.
- **Diagrams over paragraphs** for system/runtime context. Mermaid `flowchart` for surfaces and dependencies; `sequenceDiagram` for runtime flow; a small flowchart for multi-agent execution if relevant.
- **Cite line ranges, not whole files.** `app/foo.tsx:42-58` beats pasting the whole hunk.
- **Caveats are first-class.** A "deferred polish" section earns more trust than pretending everything is perfect.
- **Keep it self-contained.** No external CSS, no external JS except the Mermaid CDN already wired in the template.

## Anti-patterns

- ❌ Generating a report from `git log` alone — the agent reports / test output / decisions are the value.
- ❌ Dumping full diffs into `<pre>` blocks. Pick the hunk that tells the story.
- ❌ Inventing approach options that weren't actually considered. If only one path was sensible, say so in one line and skip the table.
- ❌ Committing the report. Leave it uncommitted.

## Reference layout

The skill ships with `template.html` next to this `SKILL.md`. The template is a single file: inline CSS, embedded Mermaid via CDN, no build step. It mirrors the visual language of the original report this skill was extracted from (`docs/quick-start-pdf-download-report.html`).

## See also

- [README.md](./README.md) — design notes, why the template is embedded, customisation tips.
- [template.html](./template.html) — the canonical scaffold.
