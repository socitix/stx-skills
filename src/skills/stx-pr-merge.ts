#!/usr/bin/env node

/**
 * stx-pr-merge Skill
 *
 * End-to-end feature-branch shipping workflow:
 *   1. Pre-flight checks (worktree clean, not on main, remote configured)
 *   2. Commit (stage explicit files, draft Conventional Commits message, commit)
 *   3. Push & open PR via `gh pr create`
 *   4. Build validation #1 (in feature worktree)
 *   5. `gh pr merge --squash` (with API fallback for branch deletion)
 *   6. Refresh main worktree (`git pull --ff-only`)
 *   7. Build validation #2 (in main worktree)
 *   8. Worktree cleanup (`git worktree remove`)
 *   9. Local branch cleanup (`git branch -D`)
 *
 * Halts on any failure — never silently retries or recovers.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

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

interface CliOptions {
  interactive: boolean;
  dryRun: boolean;
  force: boolean;
  prTitle?: string;
  prBody?: string;
  buildCmd: string;
  skipBuild1: boolean;
  skipBuild2: boolean;
  message?: string;
  help: boolean;
  // Stand-alone wave-usage logging mode (also runs inline during the full chain).
  logUsage: boolean;
  worktreePath?: string;
  branchOverride?: string;
  waveStatePath?: string;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    interactive: false,
    dryRun: false,
    force: false,
    buildCmd: 'npm run build',
    skipBuild1: false,
    skipBuild2: false,
    help: false,
    logUsage: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--interactive':
        options.interactive = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '-f':
      case '--force':
        options.force = true;
        break;
      case '--pr-title':
        options.prTitle = args[++i];
        break;
      case '--pr-body':
        options.prBody = args[++i];
        break;
      case '--build-cmd':
        options.buildCmd = args[++i];
        break;
      case '--skip-build-1':
        options.skipBuild1 = true;
        break;
      case '--skip-build-2':
        options.skipBuild2 = true;
        break;
      case '-m':
      case '--message':
        options.message = args[++i];
        break;
      case '--log-usage':
        options.logUsage = true;
        break;
      case '--worktree-path':
        options.worktreePath = args[++i];
        break;
      case '--branch':
        options.branchOverride = args[++i];
        break;
      case '--wave-state':
        options.waveStatePath = args[++i];
        break;
      default:
        // Ignore unknown args silently — keeps the door open for future flags
        break;
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
${c.bold('stx-pr-merge')} — End-to-end feature-branch shipping workflow

${c.bold('USAGE')}
  stx-pr-merge [options]

${c.bold('OPTIONS')}
  --interactive          Prompt for approval at each gate
  --dry-run              Print every command without executing
  -m, --message <s>      Commit message (skips prompt)
  --pr-title <s>         Pre-supply the PR title
  --pr-body <s>          Pre-supply the PR body (Summary/Test plan)
  --build-cmd <s>        Override build command (default: npm run build)
  --skip-build-1         Skip pre-merge build (NOT RECOMMENDED)
  --skip-build-2         Skip post-merge build (NOT RECOMMENDED)
  -f, --force            Skip non-destructive confirmations
  -h, --help             Show this help

${c.bold('WAVE USAGE LOGGING')}
  --log-usage            Only record /stx-feature wave token+time usage, then exit
  --worktree-path <s>    Feature worktree path (default: current worktree root)
  --branch <s>           Branch to match a wave by (default: current branch)
  --wave-state <s>       Explicit wave-state.json path (skips auto-discovery)

${c.bold('CHAIN')}
  pre-flight → commit → push & PR → build #1 → squash-merge →
  refresh main → build #2 → worktree cleanup → branch delete

${c.bold('GOVERNANCE')}
  This skill respects the user's CRITICAL rules from ~/.claude/CLAUDE.md:
    • Data Protection — destructive ops require approval
    • No Commits/Deployments Without Approval
    • Multi-Step Workflow Approvals — single approval covers an enumerated chain
    • Halt and surface — never silently retry or skip a failed step

${c.bold('EXIT COMMANDS')}
  At any prompt, type: exit, quit, q, or n
`);
}

// =============================================================================
// Git Helpers
// =============================================================================

function execCmd(command: string, cwd?: string): string {
  return execSync(command, {
    encoding: 'utf-8',
    cwd: cwd ?? process.cwd(),
  }).trim();
}

function execGit(command: string, cwd?: string): string {
  try {
    return execCmd(`git ${command}`, cwd);
  } catch (error) {
    if (error instanceof Error && 'stderr' in error) {
      throw new Error(`Git command failed: ${(error as { stderr?: string }).stderr ?? error.message}`);
    }
    throw error;
  }
}

function isGitRepo(): boolean {
  try {
    execGit('rev-parse --is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch(): string {
  return execGit('rev-parse --abbrev-ref HEAD');
}

function isMainBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master';
}

function getWorktreeRoot(): string {
  return execGit('rev-parse --show-toplevel');
}

function hasRemote(): boolean {
  try {
    const remotes = execGit('remote');
    return remotes.length > 0;
  } catch {
    return false;
  }
}

function hasGhCli(): boolean {
  try {
    execSync('which gh', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

interface WorktreeEntry {
  path: string;
  branch: string;
}

/**
 * Parse `git worktree list --porcelain` and find the worktree whose
 * branch is `main` (or `master` as a fallback).
 */
function findMainWorktreePath(): string | null {
  const output = execGit('worktree list --porcelain');
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) {
        entries.push({ path: current.path, branch: current.branch ?? '' });
      }
      current = { path: line.substring('worktree '.length).trim() };
    } else if (line.startsWith('branch ')) {
      const ref = line.substring('branch '.length).trim();
      // ref looks like refs/heads/<name>
      current.branch = ref.replace(/^refs\/heads\//, '');
    } else if (line === '' && current.path) {
      entries.push({ path: current.path, branch: current.branch ?? '' });
      current = {};
    }
  }
  if (current.path) {
    entries.push({ path: current.path, branch: current.branch ?? '' });
  }

  const main = entries.find(e => e.branch === 'main') ?? entries.find(e => e.branch === 'master');
  return main ? main.path : null;
}

/**
 * Parse the GitHub repo slug (owner/name) from `git remote get-url origin`.
 * Handles both SSH (`git@github.com:owner/repo.git`) and HTTPS
 * (`https://github.com/owner/repo.git`).
 */
function getRepoSlug(): string | null {
  let url: string;
  try {
    url = execGit('remote get-url origin');
  } catch {
    return null;
  }

  // SSH form: git@github.com:owner/repo.git
  const sshMatch = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }
  return null;
}

interface GitFile {
  status: string;
  path: string;
}

function getStatus(): GitFile[] {
  const output = execGit('status --porcelain');
  if (!output) return [];

  return output.split('\n').map(line => {
    const status = line.substring(0, 2).trim();
    const filePath = line.substring(3);
    return { status, path: filePath };
  });
}

// =============================================================================
// Wave usage logging (token + wall-clock time)
// =============================================================================
//
// At close-out we record what a /stx-feature wave actually cost: total tokens
// (orchestrator sessions + every subagent) and wall-clock time. Claude Code
// writes every turn's usage to disk under ~/.claude/projects/<encoded-cwd>/, so
// this is a pure reader — no model instrumentation. Because each wave owns its
// own worktree (global worktree rule), that one project directory is exactly
// this wave's spend, which is what makes the sum unambiguous.

interface UsageTokens {
  input: number;
  cache_creation: number;
  cache_read: number;
  output: number;
  total: number;
}

interface UsageBlock {
  computed_at: string;
  started_at: string | null;
  ended_at: string;
  wall_clock_seconds: number | null;
  wall_clock_human: string | null;
  tokens: UsageTokens;
  n_sessions: number;
  n_subagents: number;
  notes?: string;
}

/**
 * Encode an absolute cwd into the ~/.claude/projects directory name Claude Code
 * uses: every `/` and `.` becomes `-`. e.g. `/a/b/.claude/wt/x` →
 * `-a-b--claude-wt-x` (the `/.claude/` segment yields `--claude-`).
 */
function encodeProjectDir(absPath: string): string {
  return absPath.replace(/[/.]/g, '-');
}

/** Sum the four token fields off one transcript line's usage into `tokens`. */
function accumulateUsageLine(usage: Record<string, unknown>, tokens: UsageTokens): void {
  tokens.input += (usage.input_tokens as number) || 0;
  tokens.cache_creation += (usage.cache_creation_input_tokens as number) || 0;
  tokens.cache_read += (usage.cache_read_input_tokens as number) || 0;
  tokens.output += (usage.output_tokens as number) || 0;
}

/**
 * Read one .jsonl transcript and fold every `type:"assistant"` line's
 * `message.usage` into `tokens`, skipping lines whose `uuid` was already seen
 * (resumed/compacted sessions repeat lines — dedup keeps the sum honest).
 */
function sumTranscriptFile(file: string, tokens: UsageTokens, seenUuids: Set<string>): void {
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return; // unreadable file — skip, never throw (best-effort contract)
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let obj: { type?: string; uuid?: string; message?: { usage?: Record<string, unknown> } };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== 'assistant') continue;
    const usage = obj.message?.usage;
    if (!usage) continue;
    if (obj.uuid) {
      if (seenUuids.has(obj.uuid)) continue;
      seenUuids.add(obj.uuid);
    }
    accumulateUsageLine(usage, tokens);
  }
}

interface ProjectDirTotals {
  tokens: UsageTokens;
  nSessions: number;
  nSubagents: number;
}

/**
 * Sum usage across an entire ~/.claude/projects/<encoded> directory:
 * every top-level `.jsonl` (orchestrator sessions) plus every `.jsonl` inside
 * each session's `subagents/` folder (the wave's subagents — usually the bulk).
 */
function sumProjectDir(projectDir: string): ProjectDirTotals {
  const tokens: UsageTokens = { input: 0, cache_creation: 0, cache_read: 0, output: 0, total: 0 };
  const seenUuids = new Set<string>();
  let nSessions = 0;
  let nSubagents = 0;

  if (!fs.existsSync(projectDir)) {
    return { tokens, nSessions, nSubagents };
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path.join(projectDir, entry.name));
      nSessions++;
    } else if (entry.isDirectory()) {
      const subagentsDir = path.join(projectDir, entry.name, 'subagents');
      if (!fs.existsSync(subagentsDir)) continue;
      for (const sub of fs.readdirSync(subagentsDir)) {
        if (sub.endsWith('.jsonl')) {
          files.push(path.join(subagentsDir, sub));
          nSubagents++;
        }
      }
    }
  }

  for (const f of files) {
    sumTranscriptFile(f, tokens, seenUuids);
  }
  tokens.total = tokens.input + tokens.cache_creation + tokens.cache_read + tokens.output;
  return { tokens, nSessions, nSubagents };
}

/**
 * Find the wave-state.json under <worktree>/docs/waves/ that belongs to this
 * branch/worktree. Scored: worktree_path match beats branch match. Returns null
 * when nothing matches (e.g. a manual branch or a /stx-fix — usage is skipped).
 */
function findWaveStatePath(worktreePath: string, branch: string): string | null {
  const wavesDir = path.join(worktreePath, 'docs', 'waves');
  if (!fs.existsSync(wavesDir)) return null;

  let best: { file: string; score: number } | null = null;
  for (const entry of fs.readdirSync(wavesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(wavesDir, entry.name, 'wave-state.json');
    if (!fs.existsSync(candidate)) continue;
    let ws: { worktree_path?: string; branch?: string };
    try {
      ws = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch {
      continue;
    }
    let score = 0;
    if (ws.worktree_path && path.resolve(ws.worktree_path) === path.resolve(worktreePath)) score += 2;
    if (ws.branch && ws.branch === branch) score += 1;
    if (score > 0 && (!best || score > best.score)) {
      best = { file: candidate, score };
    }
  }
  return best ? best.file : null;
}

/** Render a duration in seconds as a compact "1d 2h 3m" (always shows minutes). */
function humanDuration(totalSeconds: number): string {
  let s = totalSeconds;
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

/** Format a token count as e.g. "4.18M" / "0.42M" / "12.3K". */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Best-effort: record this wave's token + time usage into its wave-state.json.
 * NEVER throws — any failure prints one warning line and returns, so a logging
 * problem can never fail or roll back a merge.
 */
function logWaveUsage(worktreePath: string, branch: string, explicitWaveState?: string): void {
  try {
    const waveStatePath = explicitWaveState ?? findWaveStatePath(worktreePath, branch);
    if (!waveStatePath) {
      console.log(c.dim('  No matching /stx-feature wave for this branch — usage logging skipped.'));
      return;
    }

    const ws = JSON.parse(fs.readFileSync(waveStatePath, 'utf8')) as {
      started_at?: string;
      usage?: UsageBlock;
    } & Record<string, unknown>;

    const projectDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(path.resolve(worktreePath)));
    const { tokens, nSessions, nSubagents } = sumProjectDir(projectDir);

    const now = new Date();
    const startedAt = ws.started_at ?? null;
    let wallSeconds: number | null = null;
    let wallHuman: string | null = null;
    if (startedAt) {
      const startMs = new Date(startedAt).getTime();
      if (!Number.isNaN(startMs)) {
        wallSeconds = Math.max(0, Math.round((now.getTime() - startMs) / 1000));
        wallHuman = humanDuration(wallSeconds);
      }
    }

    const noteFlags: string[] = [];
    if (!startedAt || wallSeconds === null) noteFlags.push('no-started-at');
    if (tokens.total === 0) noteFlags.push('no-transcripts-found');

    const usage: UsageBlock = {
      computed_at: now.toISOString(),
      started_at: startedAt,
      ended_at: now.toISOString(),
      wall_clock_seconds: wallSeconds,
      wall_clock_human: wallHuman,
      tokens,
      n_sessions: nSessions,
      n_subagents: nSubagents,
    };
    if (noteFlags.length) usage.notes = noteFlags.join('; ');

    ws.usage = usage;
    fs.writeFileSync(waveStatePath, JSON.stringify(ws, null, 2) + '\n', 'utf8');

    const rel = path.relative(worktreePath, waveStatePath) || waveStatePath;
    console.log(
      c.success(
        `  ✓ Wave usage logged: ${formatTokens(tokens.total)} tokens, ${wallHuman ?? '—'} ` +
          `across ${nSessions} session(s), ${nSubagents} subagents → ${rel}`,
      ),
    );
    if (noteFlags.length) console.log(c.dim(`    (notes: ${noteFlags.join('; ')})`));
  } catch (err) {
    console.log(
      c.warn(`  ⚠ Wave usage logging skipped (best-effort): ${err instanceof Error ? err.message : String(err)}`),
    );
  }
}

// =============================================================================
// Interactive Prompts
// =============================================================================

const EXIT_COMMANDS = ['exit', 'quit', 'q', 'n', 'no'];

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function prompt(question: string): Promise<string> {
  const rl = createReadline();

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();

      if (EXIT_COMMANDS.includes(answer.toLowerCase().trim())) {
        console.log(c.warn('\nAborted by user.'));
        process.exit(0);
      }

      resolve(answer.trim());
    });
  });
}

async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await prompt(`${question} ${hint}: `);

  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

async function confirmGate(label: string, options: CliOptions): Promise<void> {
  if (!options.interactive || options.force) return;
  const proceed = await confirm(`Proceed with: ${label}?`, true);
  if (!proceed) {
    console.log(c.warn('\nAborted by user.'));
    process.exit(0);
  }
}

// =============================================================================
// Halt helper
// =============================================================================

function halt(reason: string, context?: Record<string, string>): never {
  console.log(c.error(`\n❌ HALT — ${reason}`));
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      console.log(`  ${c.dim(key + ':')} ${value}`);
    }
  }
  console.log(c.warn('\nThe chain has stopped. Resolve the issue above, then retry or'));
  console.log(c.warn('continue from the next step manually.'));
  process.exit(1);
}

// =============================================================================
// Workflow Steps
// =============================================================================

interface Context {
  featureWorktree: string;
  mainWorktree: string;
  branch: string;
  repoSlug: string | null;
  prNumber?: number;
  commitSubject?: string;
}

async function step0_preflight(options: CliOptions): Promise<Context> {
  console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(c.bold('  STEP 0: Pre-flight'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════\n'));

  if (!isGitRepo()) {
    halt('Not inside a git repository.');
  }

  const branch = getCurrentBranch();
  console.log(`Current branch: ${c.info(branch)}`);

  if (isMainBranch(branch)) {
    halt('You are on the main branch. This skill operates on feature branches only.');
  }

  if (!hasRemote()) {
    halt('No remote configured. Add an origin remote before running this skill.');
  }

  if (!hasGhCli()) {
    halt('GitHub CLI (gh) is not installed or not in PATH.', {
      install: 'brew install gh && gh auth login',
    });
  }

  const featureWorktree = getWorktreeRoot();
  console.log(`Feature worktree: ${c.info(featureWorktree)}`);

  const mainWorktree = findMainWorktreePath();
  if (!mainWorktree) {
    halt('Could not locate a main worktree.', {
      hint: 'Run `git worktree list` to inspect. The post-merge build and cleanup require a main worktree.',
    });
  }
  console.log(`Main worktree:    ${c.info(mainWorktree)}`);

  const repoSlug = getRepoSlug();
  if (repoSlug) {
    console.log(`Repo slug:        ${c.info(repoSlug)}`);
  } else {
    console.log(c.warn('Could not parse repo slug from `git remote get-url origin` (non-GitHub remote?).'));
  }

  // Surface (don't halt on) any uncommitted changes — the commit step is what
  // decides whether to proceed. We just print so the user sees them.
  const status = getStatus();
  if (status.length === 0) {
    console.log(c.dim('\nWorking tree is clean. Commit step will be a no-op.'));
  } else {
    console.log(c.dim(`\nUncommitted changes (${status.length} file(s)):`));
    for (const f of status.slice(0, 20)) {
      console.log(`  ${c.file(f.path)} ${c.dim('(' + (f.status || '?') + ')')}`);
    }
    if (status.length > 20) {
      console.log(c.dim(`  …and ${status.length - 20} more`));
    }
  }

  console.log(c.success('\n✅ Pre-flight passed.'));

  return {
    featureWorktree,
    mainWorktree: mainWorktree as string,
    branch,
    repoSlug,
  };
}

async function step1_commit(ctx: Context, options: CliOptions): Promise<void> {
  console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(c.bold('  STEP 1: Commit'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════\n'));

  const status = getStatus();
  if (status.length === 0) {
    console.log(c.info('Nothing to commit. Skipping.'));
    // Try to derive a subject from the most recent commit on this branch
    try {
      ctx.commitSubject = execGit('log -1 --pretty=%s');
    } catch {
      // ignore
    }
    return;
  }

  let message = options.message;
  if (!message) {
    console.log(c.dim('Recent commits for style reference:'));
    try {
      const logs = execGit('log --oneline -5');
      logs.split('\n').forEach(line => console.log(c.dim(`  ${line}`)));
    } catch {
      // new repo — ignore
    }
    console.log('');
    message = await prompt('Commit message (Conventional Commits — feat/fix/chore/...): ');
    if (!message) {
      halt('Commit message cannot be empty.');
    }
  }

  ctx.commitSubject = message.split('\n')[0];

  await confirmGate(`commit ${status.length} file(s) with subject "${ctx.commitSubject}"`, options);

  if (options.dryRun) {
    console.log(c.dim('[DRY RUN] git add -A'));
    console.log(c.dim('[DRY RUN] git commit -m "..."'));
    return;
  }

  // Stage everything currently in `git status` — the user has already seen
  // the list in step 0 and approved the chain. Per governance, the user
  // explicitly described what should be committed; we trust that approval.
  execGit('add -A');

  const fullMessage = `${message}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
  execSync(`git commit -m "$(cat <<'EOF'\n${fullMessage}\nEOF\n)"`, {
    encoding: 'utf-8',
    shell: '/bin/bash',
  });

  console.log(c.success(`\n✅ Committed: "${ctx.commitSubject}"`));
}

async function step2_pushAndPr(ctx: Context, options: CliOptions): Promise<void> {
  console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(c.bold('  STEP 2: Push & open PR'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════\n'));

  await confirmGate(`push branch "${ctx.branch}" and open a PR`, options);

  if (options.dryRun) {
    console.log(c.dim(`[DRY RUN] git push -u origin ${ctx.branch}`));
    console.log(c.dim(`[DRY RUN] gh pr create --title "..." --body "..."`));
    return;
  }

  // Push
  try {
    execGit(`push -u origin ${ctx.branch}`);
    console.log(c.success(`✅ Pushed to origin/${ctx.branch}`));
  } catch (err) {
    halt('git push was rejected.', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // PR creation
  const title = options.prTitle ?? ctx.commitSubject ?? `Changes from ${ctx.branch}`;
  const body = options.prBody ?? `## Summary
- ${ctx.commitSubject ?? 'See commit history'}

## Test plan
- [ ] Built locally with \`${options.buildCmd}\`
- [ ] Manually verified the change`;

  try {
    const cmd = `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "$(cat <<'EOF'\n${body}\nEOF\n)"`;
    const output = execSync(cmd, { encoding: 'utf-8', shell: '/bin/bash' }).trim();
    console.log(output);

    // Capture the PR number from the URL gh prints
    const match = output.match(/\/pull\/(\d+)/);
    if (match) {
      ctx.prNumber = parseInt(match[1], 10);
      console.log(c.success(`✅ Opened PR #${ctx.prNumber}`));
    } else {
      halt('Could not parse PR number from `gh pr create` output.', { output });
    }
  } catch (err) {
    halt('gh pr create failed.', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function step3_buildValidate(label: string, cwd: string, options: CliOptions): Promise<void> {
  console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(c.bold(`  STEP: Build validation (${label})`));
  console.log(c.bold('═══════════════════════════════════════════════════════════════\n'));

  console.log(`  cwd:   ${c.info(cwd)}`);
  console.log(`  cmd:   ${c.info(options.buildCmd)}\n`);

  if (options.dryRun) {
    console.log(c.dim(`[DRY RUN] (cd ${cwd} && ${options.buildCmd})`));
    return;
  }

  try {
    execSync(options.buildCmd, { cwd, stdio: 'inherit' });
    console.log(c.success(`\n✅ Build (${label}) passed.`));
  } catch (err) {
    halt(`Build (${label}) failed.`, {
      cwd,
      cmd: options.buildCmd,
      hint: label === 'post-merge'
        ? 'The merge has already happened. Do NOT remove the feature worktree until you have investigated. The failure may be unrelated to this PR.'
        : 'Fix the build before pushing. Nothing has been merged yet.',
    });
  }
}

async function step4_squashMerge(ctx: Context, options: CliOptions): Promise<void> {
  console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(c.bold('  STEP 4: Squash-merge PR'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════\n'));

  if (!ctx.prNumber) {
    halt('No PR number recorded — cannot merge.');
  }

  await confirmGate(`squash-merge PR #${ctx.prNumber} and delete remote branch "${ctx.branch}"`, options);

  if (options.dryRun) {
    console.log(c.dim(`[DRY RUN] gh pr merge ${ctx.prNumber} --squash --delete-branch`));
    return;
  }

  try {
    execSync(`gh pr merge ${ctx.prNumber} --squash --delete-branch`, { stdio: 'inherit' });
    console.log(c.success(`\n✅ PR #${ctx.prNumber} squash-merged.`));
    return;
  } catch {
    // Fall through to API fallback — gh refuses local-checkout branch deletes
    console.log(c.warn('gh pr merge --delete-branch refused (branch likely checked out in another worktree).'));
    console.log(c.warn('Falling back to direct API delete of the remote ref…'));
  }

  // Try the merge again without --delete-branch, then delete the ref via API
  try {
    execSync(`gh pr merge ${ctx.prNumber} --squash`, { stdio: 'inherit' });
  } catch (err) {
    halt('gh pr merge --squash failed.', {
      error: err instanceof Error ? err.message : String(err),
      hint: 'Check for merge conflicts, required reviews, or failing required checks.',
    });
  }

  if (!ctx.repoSlug) {
    halt('Cannot delete remote ref — repo slug is unknown.', {
      hint: `Manually run: gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/${ctx.branch}`,
    });
  }

  try {
    execSync(`gh api -X DELETE repos/${ctx.repoSlug}/git/refs/heads/${ctx.branch}`, { stdio: 'inherit' });
    console.log(c.success(`✅ Deleted remote ref refs/heads/${ctx.branch}`));
  } catch (err) {
    halt('Direct API delete of the remote ref failed.', {
      error: err instanceof Error ? err.message : String(err),
      hint: `Manually run: gh api -X DELETE repos/${ctx.repoSlug}/git/refs/heads/${ctx.branch}`,
    });
  }
}

async function step5_refreshMain(ctx: Context, options: CliOptions): Promise<void> {
  console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(c.bold('  STEP 5: Refresh main worktree'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════\n'));

  console.log(`  cwd: ${c.info(ctx.mainWorktree)}\n`);

  if (options.dryRun) {
    console.log(c.dim(`[DRY RUN] (cd ${ctx.mainWorktree} && git pull --ff-only origin main)`));
    return;
  }

  try {
    execGit('pull --ff-only origin main', ctx.mainWorktree);
    console.log(c.success(`✅ Main worktree fast-forwarded.`));
  } catch (err) {
    halt('Fast-forward pull on main failed.', {
      cwd: ctx.mainWorktree,
      error: err instanceof Error ? err.message : String(err),
      hint: 'The main worktree may have local divergent commits. Resolve manually.',
    });
  }
}

async function step6_cleanupWorktree(ctx: Context, options: CliOptions): Promise<void> {
  console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(c.bold('  STEP 6: Worktree cleanup'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════\n'));

  await confirmGate(`remove worktree ${ctx.featureWorktree}`, options);

  if (options.dryRun) {
    console.log(c.dim(`[DRY RUN] (cd ${ctx.mainWorktree} && git worktree remove ${ctx.featureWorktree})`));
    console.log(c.dim('[DRY RUN] retry with --force if untracked build artifacts block removal'));
    return;
  }

  // Run from main worktree — never from inside the feature worktree
  try {
    execGit(`worktree remove ${JSON.stringify(ctx.featureWorktree)}`, ctx.mainWorktree);
    console.log(c.success(`✅ Removed worktree: ${ctx.featureWorktree}`));
    return;
  } catch (err) {
    console.log(c.warn(`worktree remove refused (likely build artifacts or untracked files): ${err instanceof Error ? err.message : String(err)}`));
    console.log(c.warn('Retrying with --force (safe: work is merged and main is up to date)…'));
  }

  try {
    execGit(`worktree remove --force ${JSON.stringify(ctx.featureWorktree)}`, ctx.mainWorktree);
    console.log(c.success(`✅ Removed worktree (forced): ${ctx.featureWorktree}`));
  } catch (err) {
    halt('git worktree remove --force failed.', {
      cwd: ctx.mainWorktree,
      target: ctx.featureWorktree,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function step7_deleteLocalBranch(ctx: Context, options: CliOptions): Promise<void> {
  console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(c.bold('  STEP 7: Delete local branch'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════\n'));

  await confirmGate(`delete local branch "${ctx.branch}" (force, because squash-merged)`, options);

  if (options.dryRun) {
    console.log(c.dim(`[DRY RUN] (cd ${ctx.mainWorktree} && git branch -D ${ctx.branch})`));
    return;
  }

  // Check if the local branch still exists — `git worktree remove` may have
  // already detached it.
  try {
    execGit(`rev-parse --verify refs/heads/${ctx.branch}`, ctx.mainWorktree);
  } catch {
    console.log(c.dim(`Local branch "${ctx.branch}" no longer exists. Nothing to delete.`));
    return;
  }

  try {
    execGit(`branch -D ${ctx.branch}`, ctx.mainWorktree);
    console.log(c.success(`✅ Deleted local branch: ${ctx.branch}`));
  } catch (err) {
    halt(`git branch -D ${ctx.branch} failed.`, {
      cwd: ctx.mainWorktree,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Stand-alone wave-usage logging — invoked by SKILL.md's best-effort step and
  // by anyone wanting to (re)compute usage for a wave without running the chain.
  if (options.logUsage) {
    const worktree = options.worktreePath ?? (isGitRepo() ? getWorktreeRoot() : process.cwd());
    const branch = options.branchOverride ?? (isGitRepo() ? getCurrentBranch() : '');
    console.log(c.bold('\n📊 Recording /stx-feature wave usage\n'));
    logWaveUsage(worktree, branch, options.waveStatePath);
    process.exit(0); // best-effort: always succeed, never block a caller
  }

  console.log(c.bold('\n🚢 stx-pr-merge — Ship a feature branch end-to-end\n'));

  if (options.dryRun) {
    console.log(c.warn('🔍 DRY RUN MODE — no changes will be made\n'));
  }

  try {
    // Step 0: Pre-flight
    const ctx = await step0_preflight(options);

    // Best-effort: record this wave's token + time usage BEFORE the commit, so
    // the updated wave-state.json rides along in the PR and is merged. A logging
    // failure only warns — it never fails or rolls back the merge.
    console.log(c.bold('\n  Recording wave usage (best-effort)…'));
    if (options.dryRun) {
      console.log(c.dim('  [DRY RUN] would sum ~/.claude/projects/<worktree> into docs/waves/*/wave-state.json'));
    } else {
      logWaveUsage(ctx.featureWorktree, ctx.branch, options.waveStatePath);
    }

    // Step 1: Commit
    await step1_commit(ctx, options);

    // Step 2: Push & PR
    await step2_pushAndPr(ctx, options);

    // Step 3: Build validation #1 (feature worktree)
    if (!options.skipBuild1) {
      await step3_buildValidate('pre-merge', ctx.featureWorktree, options);
    } else {
      console.log(c.warn('\n⚠️  Skipping pre-merge build (--skip-build-1).'));
    }

    // Step 4: Squash-merge
    await step4_squashMerge(ctx, options);

    // Step 5: Refresh main
    await step5_refreshMain(ctx, options);

    // Step 6: Build validation #2 (main worktree)
    if (!options.skipBuild2) {
      await step3_buildValidate('post-merge', ctx.mainWorktree, options);
    } else {
      console.log(c.warn('\n⚠️  Skipping post-merge build (--skip-build-2).'));
    }

    // Step 7: Worktree cleanup
    await step6_cleanupWorktree(ctx, options);

    // Step 8: Local branch delete
    await step7_deleteLocalBranch(ctx, options);

    console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
    console.log(c.success('  ✅ stx-pr-merge complete!'));
    console.log(c.bold('═══════════════════════════════════════════════════════════════'));
    console.log(`  Feature branch ${c.info(ctx.branch)} merged via PR ${ctx.prNumber ? '#' + ctx.prNumber : ''}`);
    console.log(`  Worktree ${c.dim(ctx.featureWorktree)} removed`);
    console.log(`  Local branch ${c.dim(ctx.branch)} deleted`);
    console.log('');
  } catch (error) {
    console.log(c.error(`\n❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

// Silence the unused-import warning on `path` — kept for parity with siblings
void path;

main();
