#!/usr/bin/env node

/**
 * stx-version-bump Skill
 *
 * Standalone counterpart to the bump step inside /stx-pr-merge. Same shared
 * module under the hood — different surface area: this one is for the
 * "already-shipped" case (forgot to bump in the last PR; building a
 * separate release PR aggregating several feature PRs; overriding the
 * conservative inference one-off).
 *
 * Behaviour:
 *   1. Locate package.json (or --version-file).
 *   2. Read the current version + the HEAD (or --from-commit) subject + body.
 *   3. Pick a bump level: positional arg > --bump > auto-inferred.
 *   4. Run `npm version <level> --no-git-tag-version`.
 *   5. Create a separate `chore(release): bump version to X.Y.Z` commit on
 *      the current branch.
 *   6. Unless --no-tag: tag the new commit as vX.Y.Z (does NOT push — push
 *      is left to /stx-pr-merge or `git push --follow-tags` so the user
 *      stays in control of when remote state changes).
 *
 * What it does NOT do:
 *   - Open a PR (use /stx-checkin or /stx-pr-merge).
 *   - Push the commit or tag (intentional; this skill is about the local
 *     bump artifact, not deployment).
 *   - Edit any other file. Strictly package.json (or --version-file) and
 *     package-lock.json if present.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  BumpLevel,
  BumpPlan,
  VersionBumpError,
  findVersionSource,
  hasUncommittedBumpAhead,
  hasVersionSurface,
  planBump,
  readCommitBody,
  readCommitSubject,
  readVersion,
  runBump,
  versionAlreadyTagged,
} from '../lib/version-bump';

// =============================================================================
// ANSI Colors (kept inline so the skill has no cross-file UI dep)
// =============================================================================

const Colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const c = {
  error: (s: string) => `${Colors.red}${s}${Colors.reset}`,
  success: (s: string) => `${Colors.green}${s}${Colors.reset}`,
  warn: (s: string) => `${Colors.yellow}${s}${Colors.reset}`,
  info: (s: string) => `${Colors.cyan}${s}${Colors.reset}`,
  bold: (s: string) => `${Colors.bold}${s}${Colors.reset}`,
  dim: (s: string) => `${Colors.dim}${s}${Colors.reset}`,
};

// =============================================================================
// CLI options
// =============================================================================

interface CliOptions {
  /** Positional or --bump arg. 'auto' uses inference. Default: 'auto'. */
  bump: BumpLevel | 'auto';
  /** Skip the local `git tag vX.Y.Z` step. The commit still happens. */
  noTag: boolean;
  /** Use a plain VERSION file instead of package.json. */
  versionFile?: string;
  /** Infer level from a non-HEAD commit (e.g. HEAD~3). Default: HEAD. */
  fromCommit: string;
  /** Print every command without executing. */
  dryRun: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    bump: 'auto',
    noTag: false,
    fromCommit: 'HEAD',
    dryRun: false,
    help: false,
  };

  // Allow positional first arg: patch / minor / major / none / auto
  let positionalConsumed = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--bump': {
        const v = (args[++i] ?? '').toLowerCase();
        assertBumpValue(v);
        options.bump = v as BumpLevel | 'auto';
        break;
      }
      case '--no-tag':
        options.noTag = true;
        break;
      case '--version-file':
        options.versionFile = args[++i];
        break;
      case '--from-commit':
        options.fromCommit = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default: {
        const v = arg.toLowerCase();
        if (!positionalConsumed && ['patch', 'minor', 'major', 'none', 'auto'].includes(v)) {
          options.bump = v as BumpLevel | 'auto';
          positionalConsumed = true;
          break;
        }
        // Unknown — silent ignore so we can add flags later without breaking
        break;
      }
    }
  }
  return options;
}

function assertBumpValue(v: string): void {
  if (!['patch', 'minor', 'major', 'none', 'auto'].includes(v)) {
    console.error(c.error(`--bump must be one of: patch, minor, major, none, auto (got "${v}")`));
    process.exit(2);
  }
}

function showHelp(): void {
  console.log(`
${c.bold('stx-version-bump')} — Standalone SemVer bump + release commit + local tag

${c.bold('USAGE')}
  stx-version-bump [<level>] [options]
  level: patch | minor | major | none | auto       (default: auto)

${c.bold('OPTIONS')}
  --bump <level>         Same as positional. patch/minor/major/none/auto.
                         auto = feat:/fix:/perf: → patch · feat!:/BREAKING → major
                                everything else → no bump.
                         minor/major are explicit-only (never inferred).
  --from-commit <ref>    Infer level from this commit's subject (default: HEAD)
  --no-tag               Create the release commit but skip the local vX.Y.Z tag
  --version-file <path>  Use a plain VERSION file instead of package.json
  --dry-run              Print every command without executing
  -h, --help             Show this help

${c.bold('BEHAVIOUR')}
  1. Reads current version from package.json (or --version-file).
  2. Picks the level (positional/--bump > auto-inferred from commit subject).
  3. Runs ${c.dim('npm version <level> --no-git-tag-version')} (or rewrites VERSION file).
  4. Creates a separate ${c.dim('chore(release): bump version to X.Y.Z')} commit.
  5. Unless --no-tag: tags the new commit as ${c.dim('vX.Y.Z')} locally.

${c.bold('WHAT THIS SKILL DOES NOT DO')}
  • Open a PR.            Use /stx-checkin or /stx-pr-merge.
  • Push commit or tag.   Push when you ship — \`git push --follow-tags\`.
  • Touch any other file. Strictly package.json (+ package-lock.json if present).

${c.bold('GOVERNANCE')}
  Editing package.json is non-destructive; chained skill approvals cover it.
  Pushing the tag is left to /stx-pr-merge so deployment stays under the
  same single-chain approval.

${c.bold('EXAMPLES')}
  stx-version-bump                       # auto-infer from HEAD commit subject
  stx-version-bump minor                 # explicit minor (e.g. release PR)
  stx-version-bump major --no-tag        # bump but defer tagging
  stx-version-bump --from-commit HEAD~3  # infer from a different commit
  stx-version-bump --dry-run             # preview only
`);
}

// =============================================================================
// Git helpers
// =============================================================================

function execGit(args: string, cwd: string): string {
  return execSync(`git ${args}`, { encoding: 'utf-8', cwd }).trim();
}

function isGitRepo(cwd: string): boolean {
  try {
    execGit('rev-parse --is-inside-work-tree', cwd);
    return true;
  } catch {
    return false;
  }
}

function getRepoRoot(cwd: string): string {
  return execGit('rev-parse --show-toplevel', cwd);
}

function workingTreeDirty(cwd: string): boolean {
  const out = execSync('git status --porcelain', { encoding: 'utf-8', cwd }).trim();
  return out.length > 0;
}

function halt(reason: string, context?: Record<string, string>): never {
  console.log(c.error(`\n❌ HALT — ${reason}`));
  if (context) {
    for (const [k, v] of Object.entries(context)) {
      console.log(`  ${c.dim(k + ':')} ${v}`);
    }
  }
  process.exit(1);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    return;
  }

  console.log(c.bold('\n📌 stx-version-bump — SemVer bump + release commit + local tag\n'));
  if (options.dryRun) console.log(c.warn('🔍 DRY RUN MODE — no changes will be made\n'));

  // Pre-flight
  const cwd = process.cwd();
  if (!isGitRepo(cwd)) halt('Not inside a git repository.');
  const repoRoot = getRepoRoot(cwd);

  // Locate version source
  let source;
  try {
    source = findVersionSource(repoRoot, options.versionFile);
  } catch (err) {
    if (err instanceof VersionBumpError) halt(err.message, { code: err.code });
    throw err;
  }
  if (!source) {
    halt(
      'No package.json with a version field found, and no --version-file provided.',
      { hint: 'Add a "version" field to package.json, or pass --version-file <path>.' },
    );
  }

  // Re-run safety — warn but don't halt; the user invoked this explicitly
  if (hasUncommittedBumpAhead(repoRoot, source)) {
    console.log(
      c.warn(
        '⚠️  The version in package.json is already ahead of the latest vX.Y.Z tag.\n' +
          '    Bumping again will jump further. Continuing because you asked explicitly.\n',
      ),
    );
  }

  // Working tree must be clean — we don't want to entangle other edits with
  // the release commit. Halt with a clear message.
  if (workingTreeDirty(repoRoot)) {
    halt('Working tree has uncommitted changes.', {
      hint:
        'Commit (or stash) other changes first — the release commit must contain ONLY the version bump.',
    });
  }

  // Build the plan
  const subject = readCommitSubject(repoRoot, options.fromCommit);
  const body = readCommitBody(repoRoot, options.fromCommit);
  let plan: BumpPlan;
  try {
    plan = planBump(source, subject, body, options.bump);
  } catch (err) {
    if (err instanceof VersionBumpError) halt(err.message, { code: err.code });
    throw err;
  }

  console.log(`  ${c.dim('source:')}        ${path.relative(repoRoot, source.filePath) || source.filePath}`);
  console.log(`  ${c.dim('current:')}       ${plan.fromVersion}`);
  console.log(`  ${c.dim('from commit:')}   ${options.fromCommit}${options.fromCommit === 'HEAD' ? '' : ' (override)'}`);
  console.log(`  ${c.dim('subject:')}       ${subject || '(empty)'}`);
  console.log(`  ${c.dim('level:')}         ${c.info(plan.level)}`);
  console.log(`  ${c.dim('reason:')}        ${plan.reason}`);

  if (plan.level === 'none') {
    console.log(c.dim('\nNo bump applied.'));
    console.log(c.dim('Pass a level positionally (e.g. `stx-version-bump patch`) to force one.'));
    return;
  }

  console.log(`  ${c.dim('target:')}        ${c.bold(plan.toVersion)}`);

  // Tag collision check
  if (versionAlreadyTagged(repoRoot, plan.toVersion)) {
    halt(`Tag v${plan.toVersion} already exists (locally or on origin).`, {
      hint: 'Pull tags, choose a different level, or pass a higher version manually.',
    });
  }

  if (options.dryRun) {
    console.log(c.dim(`\n[DRY RUN] npm version ${plan.level} --no-git-tag-version`));
    console.log(c.dim(`[DRY RUN] git commit -m "chore(release): bump version to ${plan.toVersion}"`));
    if (!options.noTag) {
      console.log(c.dim(`[DRY RUN] git tag v${plan.toVersion}`));
    }
    return;
  }

  // Run the bump
  let newVersion: string;
  try {
    newVersion = runBump(repoRoot, source, plan.level);
  } catch (err) {
    if (err instanceof VersionBumpError) halt(err.message, { code: err.code });
    throw err;
  }

  // Stage only the bumped files
  const toStage: string[] = [];
  if (source.kind === 'package.json') {
    toStage.push('package.json');
    if (fs.existsSync(path.join(repoRoot, 'package-lock.json'))) {
      toStage.push('package-lock.json');
    }
  } else {
    toStage.push(path.relative(repoRoot, source.filePath));
  }
  execGit(`add ${toStage.map(f => JSON.stringify(f)).join(' ')}`, repoRoot);

  // Release commit
  const subjectLine = `chore(release): bump version to ${newVersion}`;
  const bodyLines = `Bumped from ${plan.fromVersion} → ${newVersion} (${plan.level}).
Reason: ${plan.reason}`;
  const full = `${subjectLine}\n\n${bodyLines}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
  execSync(`git commit -m "$(cat <<'EOF'\n${full}\nEOF\n)"`, {
    encoding: 'utf-8',
    shell: '/bin/bash',
    cwd: repoRoot,
  });
  console.log(c.success(`\n✅ Committed release: ${subjectLine}`));

  // Local tag (no push — that's intentional)
  if (options.noTag) {
    console.log(c.dim('\n--no-tag: skipping local tag.'));
  } else {
    const tag = `v${newVersion}`;
    try {
      execGit(`tag ${tag}`, repoRoot);
      console.log(c.success(`✅ Tagged ${tag} locally (not pushed).`));
      console.log(c.dim(`   Push with: git push origin ${tag}   (or use /stx-pr-merge to ship)`));
    } catch (err) {
      halt(`git tag ${tag} failed.`, {
        cwd: repoRoot,
        error: err instanceof Error ? err.message : String(err),
        hint: 'Tag may already exist locally; check with `git tag --list`.',
      });
    }
  }

  // Informational surface check — same as the integrated step
  if (!hasVersionSurface(repoRoot)) {
    console.log(
      c.dim(
        '\nℹ Note: nothing in this repo appears to surface the package.json version\n' +
          '  in the running app. findependence pattern (Next.js + footer badge):\n' +
          '    next.config.js:  env: { NEXT_PUBLIC_APP_VERSION: require("./package.json").version }\n' +
          '    component:       v{process.env.NEXT_PUBLIC_APP_VERSION}\n' +
          '  Skipping auto-scaffold — visual surfaces belong to the project design system.',
      ),
    );
  }
}

main().catch(err => {
  console.error(c.error(`\n❌ Unexpected error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
