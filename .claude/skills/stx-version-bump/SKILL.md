---
name: stx-version-bump
description: Standalone SemVer bump for the current repo — reads package.json (or a --version-file), infers a conservative level from the Conventional-Commits subject (feat:/fix:/perf: → patch; feat!:/BREAKING → major; everything else → none), writes the bump, creates a separate "chore(release): bump version to X.Y.Z" commit, and tags it locally. Does NOT push. Use when you forgot to bump in the last shipped PR, want to override the auto-inference, or are aggregating several feature PRs into a single release commit.
version: 1.10.4
author: STX
zone: any
---

# /stx-version-bump

A thin, standalone counterpart to the version-bump step inside [`/stx-pr-merge`](../stx-pr-merge/SKILL.md). Same shared bump policy under the hood. Use when you're outside the `/stx-pr-merge` happy path — e.g. you've already shipped a PR without bumping, you want to create a separate release PR that aggregates several feature PRs, or you want to override the conservative inference one-off.

## When to use it

- The last shipped PR forgot to bump the version. Bump now, commit, push, done.
- You batch features (`findependence`-style release PRs): `chore(release): bump version to X.Y.Z` collected from several feature PRs.
- The auto-inference picked `patch` for a `feat:` commit but this feature is meaningful enough to warrant a `minor`. Override with `stx-version-bump minor`.
- You're using `/stx-checkin` (no `/stx-pr-merge`) and want the same bump-and-tag artifact locally before pushing.

## When NOT to use it

- You're already running `/stx-pr-merge` — its STEP 1b does this for you with the right defaults. Don't double-bump.
- You haven't committed your changes yet. The release commit must contain ONLY the version bump; the working tree must be clean. Use `/stx-checkin` first.
- You want to push the bump to origin. This skill is local-only; push when you ship (`git push --follow-tags`, or run `/stx-pr-merge`).

## Zone

`zone: any` — operates on the current repo's `package.json` (or `--version-file`). Safe on `main` or in a worktree. Edits `package.json` (and `package-lock.json` if present) and creates exactly one commit. Local tag only — no push.

## Governance

Editing `package.json` is non-destructive and falls under the chained skill approvals you've already given. The tag-push step is intentionally NOT in this skill — pushing the tag is "shipping", and lives in `/stx-pr-merge` (or a hand-run `git push origin vX.Y.Z`) so the deploy moment stays under the single-chain approval rule.

## What this skill does

1. **Locate version source.** `package.json` with a `version` field — or `--version-file <path>` for non-Node repos.
2. **Read the current version**, the HEAD commit subject (or `--from-commit <ref>`), and the commit body.
3. **Pick the level.** Positional arg / `--bump` wins; otherwise the inference runs:
   - `feat:` / `fix:` / `perf:` → `patch`
   - `feat!:` / `fix!:` / `BREAKING CHANGE:` in body → `major`
   - everything else (`chore:`, `docs:`, `refactor:`, `style:`, `test:`, `ci:`, `build:`, anything that doesn't match Conventional Commits) → `none`
   - `minor` and `major` are explicit-only.
4. **Sanity-check.** Working tree must be clean (else halt). `vX.Y.Z` must not already exist locally or on origin (else halt).
5. **Bump.** `npm version <level> --no-git-tag-version` (or rewrite the `VERSION` file).
6. **Commit.** Separate `chore(release): bump version to X.Y.Z` commit on the current branch — only `package.json` (+ `package-lock.json` if present, or the `--version-file` path) staged.
7. **Tag locally** as `vX.Y.Z`, unless `--no-tag`. The tag is NOT pushed. Push when you ship.
8. **Informational surface check.** If nothing in the repo surfaces the version visibly (no `NEXT_PUBLIC_APP_VERSION` / `import.meta.env.*VERSION*` / `VERSION` file reads), print a one-line note pointing at the [findependence pattern](#showing-the-version-in-a-running-app). No auto-scaffolding — visual surfaces belong to the project's design system.

## What this skill does NOT do

- Open a PR. Use [`/stx-checkin`](../stx-checkin/SKILL.md) or [`/stx-pr-merge`](../stx-pr-merge/SKILL.md).
- Push the commit or the tag. Intentional — `git push --follow-tags` or `/stx-pr-merge`'s STEP 5b owns "shipping".
- Touch any file other than `package.json` (+ `package-lock.json` if present, or the `--version-file` path).
- Bump per-skill `SKILL.md`/`catalog.json` versions inside this repo. Those are independent SemVers (see [CLAUDE.md](../../../CLAUDE.md) "Versioning") and must be bumped by hand when their semantics change.

## Halt conditions

- Working tree has uncommitted changes. Commit (or stash) first.
- `package.json` exists but has no `version` field — add one (or `--version-file`).
- `npm` is not on PATH.
- `vX.Y.Z` (the target) already exists locally or on origin.
- `git tag` fails (most often: tag already exists locally).

## Usage

```bash
/stx-version-bump                          # auto-infer from HEAD commit subject
/stx-version-bump patch                    # explicit (positional)
/stx-version-bump minor                    # explicit minor — release-PR style
/stx-version-bump major --no-tag           # bump but defer tagging
/stx-version-bump --from-commit HEAD~3     # infer from a different commit
/stx-version-bump --version-file VERSION   # non-Node repo
/stx-version-bump --dry-run                # preview only
/stx-version-bump --help
```

## Options

| Option | Description |
|---|---|
| `<level>` (positional) | `patch` / `minor` / `major` / `none` / `auto`. Same effect as `--bump <level>`. Default: `auto`. |
| `--bump <level>` | Explicit level. Overrides inference. |
| `--from-commit <ref>` | Infer from this commit's subject (default `HEAD`). Useful for release-PR style where the bump commit isn't on top of the feature commit. |
| `--no-tag` | Make the release commit but don't create the `vX.Y.Z` local tag. |
| `--version-file <path>` | Use a plain `VERSION` file instead of `package.json` (non-Node repos). |
| `--dry-run` | Print every command without executing. No git/file changes. |
| `-h`, `--help` | Show help. |

## Showing the version in a running app

If you also want the bumped version to surface in the app (the `findependence` pattern), the minimum wiring is:

**Next.js** — read `package.json` in `next.config.js`, expose as a public env var, render in a footer/badge:

```js
// next.config.js
const { version: appVersion } = require('./package.json');
module.exports = {
  env: { NEXT_PUBLIC_APP_VERSION: appVersion },
  // ...
};
```

```tsx
// somewhere visible (footer / badge)
<span className="text-xs opacity-50">v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
```

**Vite** — `define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) }` in `vite.config.ts`, then `import.meta.env.VITE_APP_VERSION`.

**Plain Node CLIs** — `process.env.npm_package_version` is auto-set by `npm`.

The skill prints a one-line pointer to this section when it doesn't detect any version surface. It will **not** auto-scaffold the wiring — that's a design-system decision the project owner should make explicitly.

## See also

- [`/stx-pr-merge`](../stx-pr-merge/SKILL.md) — the full chain; bumps inline at STEP 1b, tags + pushes at STEP 5b
- [`/stx-checkin`](../stx-checkin/SKILL.md) — commit + push without merge or version bump
- [CLAUDE.md](../../../CLAUDE.md) — project policy: catalog.json + SKILL.md must stay in sync; skill versions are independent of the package version
