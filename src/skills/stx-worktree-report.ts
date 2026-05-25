#!/usr/bin/env node

/**
 * stx-worktree-report Skill — CLI helper
 *
 * Standalone, this command prints worktree context (branch, base, diff
 * stat, name-status, recent commits) so a human or another tool can sanity
 * check what's in a feature branch before reviewing or opening a PR.
 *
 * When `/stx-worktree-report` is invoked from Claude Code, the slash
 * command's prompt (see SKILL.md) reads the gathered context and fills
 * the HTML template. Claude is the one that writes the .html file — this
 * CLI never produces HTML.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// ANSI Colors
// =============================================================================

const Colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const c = {
  error: (s: string) => `${Colors.red}${s}${Colors.reset}`,
  success: (s: string) => `${Colors.green}${s}${Colors.reset}`,
  warn: (s: string) => `${Colors.yellow}${s}${Colors.reset}`,
  info: (s: string) => `${Colors.cyan}${s}${Colors.reset}`,
  bold: (s: string) => `${Colors.bold}${s}${Colors.reset}`,
  dim: (s: string) => `${Colors.dim}${s}${Colors.reset}`,
  file: (s: string) => `${Colors.magenta}${s}${Colors.reset}`,
};

// =============================================================================
// CLI Options
// =============================================================================

interface Options {
  worktree: string;
  base?: string;
  pretty: boolean;
  help: boolean;
}

function parseArgs(args: string[]): Options {
  const opts: Options = {
    worktree: process.cwd(),
    pretty: false,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--worktree':
        opts.worktree = path.resolve(args[++i] ?? process.cwd());
        break;
      case '--base':
        opts.base = args[++i];
        break;
      case '--pretty':
        opts.pretty = true;
        break;
      default:
        // First positional → worktree path
        if (!a.startsWith('-') && opts.worktree === process.cwd()) {
          opts.worktree = path.resolve(a);
        }
    }
  }
  return opts;
}

function showHelp(): void {
  console.log('');
  console.log(c.bold('stx-worktree-report') + ' — gather worktree context for a report');
  console.log('');
  console.log(c.bold('USAGE'));
  console.log('  stx-worktree-report [options]');
  console.log('  stx-worktree-report [options] <worktree-path>');
  console.log('');
  console.log(c.bold('OPTIONS'));
  console.log('  --worktree <path>    Worktree to analyse (default: cwd)');
  console.log('  --base <branch>      Diff base (default: main, falls back to master)');
  console.log('  --pretty             Human-readable summary (default: JSON)');
  console.log('  -h, --help           Show this help');
  console.log('');
  console.log(c.bold('EXAMPLES'));
  console.log('  stx-worktree-report                            # JSON for the current worktree');
  console.log('  stx-worktree-report --pretty                   # human summary');
  console.log('  stx-worktree-report --base develop             # diff against develop');
  console.log('  stx-worktree-report ../findependence-feature   # explicit worktree path');
  console.log('');
  console.log(c.dim('When invoked as the /stx-worktree-report slash command in Claude Code,'));
  console.log(c.dim("see the skill's SKILL.md for the full report-writing procedure."));
  console.log('');
}

// =============================================================================
// Git helpers
// =============================================================================

function gitCapture(worktree: string, args: string[]): string {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd: worktree,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim();
  } catch {
    return '';
  }
}

function isGitRepo(worktree: string): boolean {
  try {
    execSync('git rev-parse --show-toplevel', { cwd: worktree, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resolveBase(worktree: string, requested?: string): string | null {
  const candidates = requested
    ? [requested]
    : ['main', 'master'];
  for (const branch of candidates) {
    const sha = gitCapture(worktree, ['rev-parse', '--verify', '--quiet', branch]);
    if (sha) return branch;
  }
  return null;
}

// =============================================================================
// Context model
// =============================================================================

interface FileChange {
  status: string;
  path: string;
  additions?: number;
  deletions?: number;
}

interface WorktreeContext {
  worktree: string;
  isGitRepo: boolean;
  branch: string;
  base: string | null;
  baseRequested: boolean;
  hasUpstream: boolean;
  hasUncommittedChanges: boolean;
  diffMode: 'committed-vs-base' | 'working-tree' | 'none';
  commits: { sha: string; subject: string }[];
  files: FileChange[];
  diffStat: string;
  totals: { additions: number; deletions: number; files: number };
  status: string;
}

function gatherContext(opts: Options): WorktreeContext {
  const worktree = opts.worktree;
  const ctx: WorktreeContext = {
    worktree,
    isGitRepo: isGitRepo(worktree),
    branch: '',
    base: null,
    baseRequested: !!opts.base,
    hasUpstream: false,
    hasUncommittedChanges: false,
    diffMode: 'none',
    commits: [],
    files: [],
    diffStat: '',
    totals: { additions: 0, deletions: 0, files: 0 },
    status: '',
  };

  if (!ctx.isGitRepo) return ctx;

  ctx.branch = gitCapture(worktree, ['branch', '--show-current']) || '(detached)';
  ctx.base = resolveBase(worktree, opts.base);
  ctx.status = gitCapture(worktree, ['status', '--short']);
  ctx.hasUncommittedChanges = ctx.status.length > 0;
  ctx.hasUpstream = !!gitCapture(worktree, ['rev-parse', '--abbrev-ref', '@{u}']);

  // Decide what to diff against. A worktree report always wants "what's
  // different from base" — so we always diff the working tree against base
  // when one exists, which captures both committed and uncommitted work.
  // The diffMode label is informational only.
  let diffTarget: string | null = null;
  if (ctx.base && ctx.branch !== ctx.base) {
    diffTarget = ctx.base;
    ctx.diffMode = 'committed-vs-base';
  } else if (ctx.hasUncommittedChanges) {
    diffTarget = 'HEAD';
    ctx.diffMode = 'working-tree';
  }

  // Commits (only meaningful when on a branch with a real base)
  if (ctx.base && ctx.branch !== ctx.base) {
    const log = gitCapture(worktree, ['log', '--pretty=format:%h\t%s', `${ctx.base}..HEAD`]);
    if (log) {
      ctx.commits = log.split('\n').map(line => {
        const [sha, ...rest] = line.split('\t');
        return { sha, subject: rest.join('\t') };
      });
    }
  }

  if (!diffTarget) {
    return ctx;
  }

  // Diff stat + name-status — working tree vs target, so uncommitted edits
  // surface alongside committed ones.
  const diffStatArgs = ['diff', '--stat', diffTarget];
  const nameStatusArgs = ['diff', '--name-status', diffTarget];
  const numstatArgs = ['diff', '--numstat', diffTarget];

  ctx.diffStat = gitCapture(worktree, diffStatArgs);

  const nameStatus = gitCapture(worktree, nameStatusArgs);
  const numstat = gitCapture(worktree, numstatArgs);

  // Map numstat (additions/deletions per file)
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [add, del, ...rest] = line.split('\t');
    const filePath = rest.join('\t');
    if (!filePath) continue;
    const additions = add === '-' ? 0 : parseInt(add, 10) || 0;
    const deletions = del === '-' ? 0 : parseInt(del, 10) || 0;
    counts.set(filePath, { additions, deletions });
  }

  // Build file list from name-status
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const [status, ...rest] = line.split('\t');
    const filePath = rest.join('\t');
    if (!filePath) continue;
    const stats = counts.get(filePath) ?? { additions: 0, deletions: 0 };
    ctx.files.push({
      status,
      path: filePath,
      additions: stats.additions,
      deletions: stats.deletions,
    });
    ctx.totals.additions += stats.additions;
    ctx.totals.deletions += stats.deletions;
  }
  ctx.totals.files = ctx.files.length;

  // Untracked files are invisible to `git diff` regardless of mode, so always
  // append them when present.
  if (ctx.hasUncommittedChanges) {
    const untracked = gitCapture(worktree, ['ls-files', '--others', '--exclude-standard']);
    for (const filePath of untracked.split('\n').filter(Boolean)) {
      if (!ctx.files.some(f => f.path === filePath)) {
        let lineCount = 0;
        try {
          const abs = path.join(worktree, filePath);
          if (fs.statSync(abs).isFile()) {
            lineCount = fs.readFileSync(abs, 'utf-8').split('\n').length;
          }
        } catch { /* skip unreadable */ }
        ctx.files.push({ status: '?', path: filePath, additions: lineCount, deletions: 0 });
        ctx.totals.additions += lineCount;
        ctx.totals.files += 1;
      }
    }
  }

  return ctx;
}

// =============================================================================
// Output
// =============================================================================

function renderJson(ctx: WorktreeContext): void {
  process.stdout.write(JSON.stringify(ctx, null, 2) + '\n');
}

function renderPretty(ctx: WorktreeContext): void {
  if (!ctx.isGitRepo) {
    console.log(c.error(`Not a git repo: ${ctx.worktree}`));
    process.exit(1);
  }

  console.log('');
  console.log(c.bold('Worktree:  ') + c.file(ctx.worktree));
  console.log(c.bold('Branch:    ') + c.info(ctx.branch || '(none)'));
  console.log(
    c.bold('Base:      ') +
      (ctx.base ? c.info(ctx.base) : c.warn('not found (no main/master)'))
  );
  console.log(c.bold('Mode:      ') + c.dim(ctx.diffMode));
  console.log(
    c.bold('Status:    ') +
      (ctx.hasUncommittedChanges ? c.warn('uncommitted changes present') : c.success('clean'))
  );
  console.log('');

  if (ctx.commits.length > 0) {
    console.log(c.bold(`Commits (${ctx.commits.length}) since ${ctx.base}:`));
    for (const co of ctx.commits) {
      console.log(`  ${c.dim(co.sha)}  ${co.subject}`);
    }
    console.log('');
  }

  if (ctx.files.length > 0) {
    console.log(c.bold(`Files changed (${ctx.totals.files}):`));
    const widthStatus = 3;
    const widthCounts = 14;
    for (const f of ctx.files) {
      const counts =
        f.status === '?'
          ? c.dim(`(${f.additions} lines)`)
          : `+${(f.additions ?? 0).toString().padStart(4)} −${(f.deletions ?? 0).toString().padStart(4)}`;
      console.log(
        '  ' +
          c.warn(f.status.padEnd(widthStatus)) +
          ' ' +
          counts.padEnd(widthCounts) +
          '  ' +
          c.file(f.path)
      );
    }
    console.log('');
    console.log(
      c.bold('Totals:    ') +
        c.success(`+${ctx.totals.additions}`) +
        ' / ' +
        c.error(`−${ctx.totals.deletions}`) +
        ' across ' +
        c.info(String(ctx.totals.files)) +
        ' file(s)'
    );
  } else {
    console.log(c.dim('No file changes detected.'));
  }
  console.log('');
}

// =============================================================================
// Main
// =============================================================================

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    showHelp();
    process.exit(0);
  }
  const ctx = gatherContext(opts);
  if (opts.pretty) {
    renderPretty(ctx);
  } else {
    renderJson(ctx);
  }
}

main();
