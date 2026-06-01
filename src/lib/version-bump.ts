/**
 * version-bump — shared SemVer bump policy for /stx-pr-merge and /stx-version-bump.
 *
 * Single source of truth for:
 *   • Reading the current `package.json` version
 *   • Inferring a bump level from a Conventional Commits subject + body
 *   • Running `npm version --no-git-tag-version` (we own the commit + tag)
 *   • Sanity-checking that the target `vX.Y.Z` tag doesn't already exist
 *   • Detecting "re-run after partial failure" (pkg version is already ahead
 *     of the latest `vX.Y.Z` tag) so we never double-bump
 *   • Suggesting how to surface the version in the running app (informational)
 *
 * Conservative defaults (per user direction):
 *   feat:           → patch   (NOT minor — minor stays manual)
 *   fix: / perf:    → patch
 *   feat!: / fix!:  → major   (explicit breaking signal)
 *   BREAKING CHANGE: in body → major
 *   chore/docs/refactor/style/test/ci/build → none
 *
 * `minor` and `major` (without a `!` / `BREAKING CHANGE`) require an explicit
 * `--bump minor` / `--bump major` from the user.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

export type BumpLevel = 'patch' | 'minor' | 'major' | 'none';

export interface InferResult {
  level: BumpLevel;
  reason: string;
}

export interface BumpPlan {
  /** Current version read from package.json (or version-file). */
  fromVersion: string;
  /** New version after applying `level`. */
  toVersion: string;
  /** patch / minor / major / none. */
  level: BumpLevel;
  /** Human-readable explanation of WHY this level was chosen. */
  reason: string;
}

export interface VersionSource {
  /** Absolute path to the file we'll read/write. */
  filePath: string;
  /** 'package.json' (canonical) or 'version-file' (fallback for non-Node repos). */
  kind: 'package.json' | 'version-file';
}

// =============================================================================
// Errors
// =============================================================================

export class VersionBumpError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'VersionBumpError';
  }
}

// =============================================================================
// Version source detection
// =============================================================================

/**
 * Locate the version source for `repoRoot`. Prefers `package.json` (with a
 * `version` field). If absent, falls back to an optional `versionFile` path
 * the caller supplies (e.g. a plain-text VERSION file in the repo root).
 *
 * Returns `null` when nothing usable is present — callers treat this as
 * "non-Node repo, skip the bump step".
 */
export function findVersionSource(
  repoRoot: string,
  versionFile?: string,
): VersionSource | null {
  // 1) Try package.json first
  const pkgPath = path.join(repoRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const raw = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(raw);
      if (typeof pkg.version === 'string' && pkg.version.length > 0) {
        return { filePath: pkgPath, kind: 'package.json' };
      }
      // package.json exists but has no version — this is an explicit halt
      // condition for the caller, not a silent skip.
      throw new VersionBumpError(
        'PKG_NO_VERSION',
        `package.json exists at ${pkgPath} but has no "version" field. ` +
          `Add a "version": "0.1.0" field or pass --no-bump.`,
      );
    } catch (err) {
      if (err instanceof VersionBumpError) throw err;
      throw new VersionBumpError(
        'PKG_PARSE_ERROR',
        `Could not parse ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2) Fall back to explicit version file (only if caller asked for it)
  if (versionFile) {
    const filePath = path.isAbsolute(versionFile)
      ? versionFile
      : path.join(repoRoot, versionFile);
    if (fs.existsSync(filePath)) {
      return { filePath, kind: 'version-file' };
    }
    throw new VersionBumpError(
      'VERSION_FILE_MISSING',
      `--version-file ${versionFile} does not exist.`,
    );
  }

  // 3) Nothing — caller should skip the bump step entirely
  return null;
}

/** Read the current version string from a resolved VersionSource. */
export function readVersion(source: VersionSource): string {
  const raw = fs.readFileSync(source.filePath, 'utf8');
  if (source.kind === 'package.json') {
    const pkg = JSON.parse(raw);
    return String(pkg.version);
  }
  // Plain VERSION file — first non-empty trimmed line
  const line = raw.split('\n').map(l => l.trim()).find(l => l.length > 0);
  if (!line) {
    throw new VersionBumpError(
      'VERSION_FILE_EMPTY',
      `Version file ${source.filePath} is empty.`,
    );
  }
  return line.replace(/^v/, '');
}

// =============================================================================
// SemVer bump arithmetic (no external deps)
// =============================================================================

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/**
 * Apply `level` to `current` and return the new SemVer. Strict 3-part only —
 * we deliberately drop any pre-release / build-metadata tail so a release
 * commit never carries `-rc.1` etc. Callers wanting those should bump by hand.
 */
export function applyBump(current: string, level: BumpLevel): string {
  if (level === 'none') return current;
  const m = current.match(SEMVER_RE);
  if (!m) {
    throw new VersionBumpError(
      'BAD_SEMVER',
      `Current version "${current}" is not a 3-part SemVer (major.minor.patch).`,
    );
  }
  let [, major, minor, patch] = m;
  const M = Number(major);
  const Mi = Number(minor);
  const P = Number(patch);
  switch (level) {
    case 'major': return `${M + 1}.0.0`;
    case 'minor': return `${M}.${Mi + 1}.0`;
    case 'patch': return `${M}.${Mi}.${P + 1}`;
  }
}

/** Compare two SemVer strings — returns 1 / 0 / -1. Strict 3-part only. */
export function compareSemver(a: string, b: string): number {
  const ma = a.match(SEMVER_RE);
  const mb = b.match(SEMVER_RE);
  if (!ma || !mb) {
    // Unknown shapes — fall back to lexical so we never throw inside a
    // best-effort check.
    return a === b ? 0 : a < b ? -1 : 1;
  }
  for (let i = 1; i <= 3; i++) {
    const da = Number(ma[i]);
    const db = Number(mb[i]);
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

// =============================================================================
// Conventional Commits → BumpLevel inference
// =============================================================================

const CC_RE = /^([a-z]+)(?:\(([^)]+)\))?(!?):\s*(.*)$/;

/**
 * Infer a bump level from a commit subject (+ optional body). Conservative:
 *   feat: / fix: / perf:     → patch
 *   feat!: / fix!: / perf!:  → major
 *   BREAKING CHANGE: in body → major
 *   anything else            → none
 *
 * The caller may override the inferred level with an explicit --bump flag.
 */
export function inferBumpLevel(subject: string, body?: string): InferResult {
  const trimmed = (subject ?? '').trim();
  if (!trimmed) {
    return { level: 'none', reason: 'no commit subject available' };
  }

  // BREAKING CHANGE in body is the strongest signal — overrides everything
  if (body && /(^|\n)BREAKING[- ]CHANGE:/.test(body)) {
    return { level: 'major', reason: 'BREAKING CHANGE: marker in commit body' };
  }

  const m = trimmed.match(CC_RE);
  if (!m) {
    return {
      level: 'none',
      reason: `subject "${trimmed.slice(0, 60)}" does not match Conventional Commits — no bump`,
    };
  }
  const [, type, , bang] = m;
  const t = type.toLowerCase();

  if (bang === '!') {
    return { level: 'major', reason: `${t}!: marker signals breaking change` };
  }

  switch (t) {
    case 'feat':
      return { level: 'patch', reason: 'feat: → patch (minor reserved for explicit --bump minor)' };
    case 'fix':
      return { level: 'patch', reason: 'fix: → patch' };
    case 'perf':
      return { level: 'patch', reason: 'perf: → patch' };
    // Non-shipping changes — caller may still pass --bump explicitly
    case 'chore':
    case 'docs':
    case 'refactor':
    case 'style':
    case 'test':
    case 'ci':
    case 'build':
    case 'revert':
      return { level: 'none', reason: `${t}: does not change shipped behaviour — no bump` };
    default:
      return { level: 'none', reason: `unknown type "${t}" — no bump (pass --bump to override)` };
  }
}

// =============================================================================
// Git helpers (re-implemented here so the module has no cross-skill imports)
// =============================================================================

function execGit(args: string, cwd: string): string {
  return execSync(`git ${args}`, { encoding: 'utf8', cwd }).trim();
}

/**
 * Best-effort: does `vX.Y.Z` already exist as a tag (locally or on origin)?
 * Returns true if either has it. Never throws — callers want a clean boolean.
 */
export function versionAlreadyTagged(repoRoot: string, version: string): boolean {
  const tag = `v${version}`;
  // Local
  try {
    execGit(`rev-parse -q --verify refs/tags/${tag}`, repoRoot);
    return true;
  } catch {
    // not local — try remote
  }
  try {
    const out = execSync(`git ls-remote --tags origin ${tag}`, {
      encoding: 'utf8',
      cwd: repoRoot,
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

/**
 * Return the highest `vX.Y.Z` tag in the repo, or null if there are none.
 * Used to detect the re-run case: pkg version > latest tag → already bumped.
 */
export function latestVersionTag(repoRoot: string): string | null {
  let raw: string;
  try {
    raw = execSync('git tag --list "v[0-9]*"', { encoding: 'utf8', cwd: repoRoot }).trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  const versions = raw
    .split('\n')
    .map(t => t.trim().replace(/^v/, ''))
    .filter(v => SEMVER_RE.test(v));
  if (versions.length === 0) return null;
  versions.sort(compareSemver);
  return versions[versions.length - 1];
}

/**
 * True when the package.json version is strictly newer than every `vX.Y.Z`
 * tag in the repo. We treat that as "a bump already happened on this branch
 * (or someone hand-edited package.json forward) — don't bump again".
 */
export function hasUncommittedBumpAhead(
  repoRoot: string,
  source: VersionSource,
): boolean {
  const current = readVersion(source);
  const latestTag = latestVersionTag(repoRoot);
  if (!latestTag) return false;
  return compareSemver(current, latestTag) > 0;
}

/** Read the subject line of HEAD (or `ref`). Empty string if it can't read. */
export function readCommitSubject(repoRoot: string, ref = 'HEAD'): string {
  try {
    return execGit(`log -1 --pretty=%s ${ref}`, repoRoot);
  } catch {
    return '';
  }
}

/** Read the body of HEAD (or `ref`). Empty string if it can't read. */
export function readCommitBody(repoRoot: string, ref = 'HEAD'): string {
  try {
    return execGit(`log -1 --pretty=%b ${ref}`, repoRoot);
  } catch {
    return '';
  }
}

// =============================================================================
// Execution — npm version + write fallback
// =============================================================================

/**
 * Run `npm version <level> --no-git-tag-version` in `repoRoot`. We disable
 * npm's own commit + tag because we want one consistent "chore(release):"
 * commit shape and we tag on `main` post-squash (not on the feature branch).
 *
 * For non-package.json sources, we just rewrite the VERSION file.
 *
 * Returns the new SemVer string.
 */
export function runBump(
  repoRoot: string,
  source: VersionSource,
  level: BumpLevel,
): string {
  if (level === 'none') {
    return readVersion(source);
  }

  if (source.kind === 'package.json') {
    // Check npm is available — surfacing a clearer message than EACCES/ENOENT
    try {
      execSync('which npm', { encoding: 'utf8' });
    } catch {
      throw new VersionBumpError(
        'NO_NPM',
        'npm is not on PATH. Install Node.js (which ships npm), or pass --version-file <path> to bypass.',
      );
    }
    try {
      // npm prints "v1.11.0" to stdout; capture and strip leading 'v'
      const out = execSync(`npm version ${level} --no-git-tag-version`, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .trim()
        .replace(/^v/, '');
      if (!SEMVER_RE.test(out)) {
        // npm changed its output shape — fall back to re-reading the file
        return readVersion(source);
      }
      return out;
    } catch (err) {
      throw new VersionBumpError(
        'NPM_VERSION_FAILED',
        `npm version ${level} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // version-file path — read, bump, write
  const current = readVersion(source);
  const next = applyBump(current, level);
  fs.writeFileSync(source.filePath, next + '\n', 'utf8');
  return next;
}

// =============================================================================
// Plan builder (pure — no side effects)
// =============================================================================

/**
 * Build a BumpPlan from the source + commit + caller override.
 *
 *   override === undefined → inference path
 *   override === 'auto'    → inference path (explicit)
 *   override === 'none'    → no-op plan
 *   override === level     → forced level (ignore inference)
 */
export function planBump(
  source: VersionSource,
  commitSubject: string,
  commitBody: string | undefined,
  override: BumpLevel | 'auto' | undefined,
): BumpPlan {
  const fromVersion = readVersion(source);

  let level: BumpLevel;
  let reason: string;

  if (override === undefined || override === 'auto') {
    const inferred = inferBumpLevel(commitSubject, commitBody);
    level = inferred.level;
    reason = `auto: ${inferred.reason}`;
  } else {
    level = override;
    reason = `explicit --bump ${override}`;
  }

  const toVersion = applyBump(fromVersion, level);
  return { fromVersion, toVersion, level, reason };
}

// =============================================================================
// Surface detection (informational note when no version is shown anywhere)
// =============================================================================

/**
 * Best-effort scan: does the repo surface its version anywhere visible to a
 * running app? Looks for the common patterns.
 *
 * Used only to decide whether to print the "consider showing the version in
 * the app" note — NEVER to halt or scaffold. Always returns a boolean.
 */
export function hasVersionSurface(repoRoot: string): boolean {
  const candidates = [
    'next.config.js',
    'next.config.ts',
    'next.config.mjs',
    'vite.config.ts',
    'vite.config.js',
  ];
  const NEEDLES = [
    'NEXT_PUBLIC_APP_VERSION',
    'NEXT_PUBLIC_VERSION',
    'VITE_APP_VERSION',
    'VITE_VERSION',
    'process.env.npm_package_version',
    'import.meta.env.VITE_APP_VERSION',
  ];
  for (const file of candidates) {
    const p = path.join(repoRoot, file);
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      if (NEEDLES.some(n => raw.includes(n))) return true;
    } catch {
      // unreadable — skip
    }
  }
  return false;
}
