---
name: stx-image
description: Analyze project images for AI-context-safe sizing. Reports unused and oversized images with target sizes and reasons, then optionally resizes via sips or deletes unused.
version: 1.11.0
author: STX
---

# /stx-image

Scans a project for images, determines which are unused, which are oversized for AI-context consumption, and produces a structured report with a "why" for each target. Default mode makes **no changes** — resize and delete only run with explicit `--apply` / `--delete-unused` flags.

## When to use it

- Project images have grown bloated and are pushing Claude Code towards context limits.
- You want to know which assets are unreferenced before a cleanup.
- You want a defensible report ("here is what I would change and why") before touching files.

## Usage

```bash
/stx-image                                # analyze cwd, report only
/stx-image --folder public                # analyze only ./public
/stx-image --folder public/temp           # analyze a nested subfolder
/stx-image public/                        # positional form (same effect)
/stx-image --folder public --apply        # resize oversized images under ./public
/stx-image --apply --delete-unused        # also remove unreferenced images
/stx-image --json                         # machine-readable output
/stx-image --size-kb 300                  # tighten file-size threshold
/stx-image --max-dimension 1280           # tighten longest-edge threshold
```

## Options

| Option | Description |
|---|---|
| `--folder <path>` | Scan a subfolder relative to the current working directory. Absolute paths also accepted. Takes precedence over the positional form. |
| `--apply` | Perform in-place resizes with macOS `sips` |
| `--delete-unused` | Delete unreferenced images (requires `--apply`, prompts for confirmation) |
| `--size-kb <n>` | Raster file-size threshold in KB (default: 500) |
| `--max-dimension <n>` | Max longest-edge in px (default: 1568 — Claude Vision's internal cap) |
| `--json` | Emit JSON report instead of tables |
| `-f`, `--force` | Skip confirmation prompts |
| `-h`, `--help` | Show help |

## What it reports

Three sections:

1. **Unused — delete entirely.** Images whose basename never appears in any source file (`ts`, `tsx`, `js`, `jsx`, `html`, `css`, `scss`, `vue`, `svelte`, `astro`, `md`, `mdx`, `json`, `yml`, `py`, `rb`, `go`, `rs`, `java`, `kt`, `swift`, `php`). Columns: `File`, `Size`.
2. **Oversized — resize.** References exist, but file exceeds thresholds. Columns: `File`, `Current` (dimensions + bytes), `Target` (longest edge + estimated bytes), `Reason`.
3. **Fine as-is.** Referenced images within thresholds.

Each oversized row includes a `sips -Z <N> <file>` command that performs the resize. Every unused row includes an `rm <file>` command. A "Suggested commands" block at the bottom bundles them for copy-paste execution.

## Thresholds and reasoning

- **File-size threshold (default 500 KB).** Any raster above this is flagged. Claude Vision resizes large images before processing, so bytes beyond this are wasted bandwidth and context.
- **Longest-edge threshold (default 1568 px).** This matches Claude's internal pre-processing cap. Images larger than this gain no quality benefit when viewed by Claude.
- **Logo / icon hint.** Files whose path matches `/logo|icon|favicon|avatar/i` target `512 px` instead of `1568 px` — these are almost always rendered at small sizes.
- **SVG > 100 KB.** Flagged (not auto-resized). Usually indicates embedded rasters or inefficient paths; recommend SVGO or asset replacement.

## Reference detection

To decide "unused", the skill reads every source file under the root once (skipping `node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `coverage`, etc.), concatenates them in memory, and checks whether each image's basename appears in the combined text. This catches:

- `import logo from './logo.png'` (basename match)
- `<img src="/marketing/logo.png">` (basename match)
- `background: url(logo.png)` (basename match)

What it does **not** catch:

- Images referenced only via constructed strings (e.g., `` `${variant}.png` ``)
- Images referenced by a CMS or external system
- Images loaded only from a database

Always review the "unused" list before passing `--delete-unused`.

## Safety

- Default mode: **zero file changes**. You always see the report first.
- `--apply` performs `sips -Z` resizes in place. `sips` preserves aspect ratio and writes to the original file. Back up or commit first if you're unsure.
- `--delete-unused` requires `--apply` AND a `y` confirmation prompt (unless `--force` is passed). The prompt lists every file that will be removed.

## Requirements

- Node.js 18+
- macOS `sips` (pre-installed). On Linux, the analysis still works, but raster dimensions and `--apply` will not.

## See also

- [README.md](./README.md) — research notes and design decisions
