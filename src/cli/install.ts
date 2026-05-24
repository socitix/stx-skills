#!/usr/bin/env node

/**
 * stx-skills installer
 *
 *     npx ../stx-skills                # Claude Code → .claude/
 *     npx ../stx-skills --cursor       # Cursor IDE → .cursor/ (transformed)
 *     npx ../stx-skills --both         # both targets
 *     npx ../stx-skills --link         # symlink (Claude skills only; see help)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  addCursorSkillFrontmatter,
  shouldTransformForCursor,
  transformForCursor,
} from './cursor-transform';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

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

type Platform = 'claude' | 'cursor';

interface Options {
  target: string;
  link: boolean;
  list: boolean;
  help: boolean;
  skills: string[];
  platforms: Platform[];
}

const SUBCOMMAND_NOOPS = new Set(['install', 'refresh', 'update', 'sync']);
const STX_AGENT_PREFIX = 'stx-';

function parseArgs(args: string[]): Options {
  const options: Options = {
    target: process.cwd(),
    link: false,
    list: false,
    help: false,
    skills: [],
    platforms: ['claude'],
  };

  let targetSet = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--link':
        options.link = true;
        break;
      case '--list':
        options.list = true;
        break;
      case '--cursor':
        options.platforms = ['cursor'];
        break;
      case '--both':
        options.platforms = ['claude', 'cursor'];
        break;
      case '--skill':
        if (args[i + 1]) options.skills.push(args[++i]);
        break;
      default:
        if (a.startsWith('-')) break;
        if (i === 0 && SUBCOMMAND_NOOPS.has(a.toLowerCase())) break;
        if (!targetSet) {
          options.target = path.resolve(a);
          targetSet = true;
        }
    }
  }

  return options;
}

function platformLabel(p: Platform): string {
  return p === 'claude' ? '.claude/' : '.cursor/';
}

function skillsDest(target: string, platform: Platform): string {
  return path.join(target, platform === 'claude' ? '.claude' : '.cursor', 'skills');
}

function agentsDest(target: string, platform: Platform): string {
  return path.join(target, platform === 'claude' ? '.claude' : '.cursor', 'agents');
}

function showHelp(): void {
  console.log(`
${c.bold('stx-skills')} — installer for organization-wide Claude Code & Cursor skills

${c.bold('USAGE')}
  npx <path-to-stx-skills> [options] [target-dir]

${c.bold('OPTIONS')}
  --cursor            Install to .cursor/skills/ + .cursor/agents/ (Cursor transforms)
  --both              Install to both .claude/ and .cursor/
  --link              Symlink Claude skills (dev mode; Cursor always copies)
  --skill <name>      Install/refresh only the named skill (repeatable)
  --list              List available skills and exit
  -h, --help          Show this help

${c.bold('EXAMPLES')}
  npx ../stx-skills                         # Claude Code (default)
  npx ../stx-skills --cursor                # Cursor IDE only
  npx ../stx-skills --both                  # both IDEs, one command
  npx ../stx-skills --both ~/projects/app   # explicit target
  npx ../stx-skills --cursor --skill stx-feature
  npx ../stx-skills --list

${c.bold('HOW IT WORKS')}
  Source of truth: <package>/.claude/skills/ and .claude/agents/ (Claude-native).

  Default install copies to <target>/.claude/ unchanged.
  --cursor applies install-time transforms (paths, Task tool, AskQuestion,
  named subagent types) and writes to <target>/.cursor/.
  --both runs both passes.

  Personas: only stx-*.md files are managed — other agent files in the
  target are preserved on refresh.
`);
}

function listAvailableSkills(): string[] {
  const skillsDir = path.join(PACKAGE_ROOT, '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

function ensureBuilt(): void {
  const distDir = path.join(PACKAGE_ROOT, 'dist', 'skills');
  if (fs.existsSync(distDir) && fs.readdirSync(distDir).some(f => f.endsWith('.js'))) {
    return;
  }
  console.log(c.warn('Build artifacts missing — running `npm install && npm run build`…'));
  execSync('npm install --silent', { cwd: PACKAGE_ROOT, stdio: 'inherit' });
  execSync('npm run build', { cwd: PACKAGE_ROOT, stdio: 'inherit' });
}

function copyFileSyncSafe(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function writeTextFile(dest: string, content: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
}

function processFileContent(
  content: string,
  filename: string,
  platform: Platform,
  isSkillMd: boolean,
): string {
  if (platform !== 'cursor' || !shouldTransformForCursor(filename)) {
    return content;
  }
  let out = transformForCursor(content);
  if (isSkillMd && filename === 'SKILL.md') {
    out = addCursorSkillFrontmatter(out);
  }
  return out;
}

function copyDirRecursive(
  src: string,
  dest: string,
  platform: Platform,
  skillRoot = false,
): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d, platform, false);
    } else if (entry.isFile()) {
      if (platform === 'cursor' && shouldTransformForCursor(entry.name)) {
        const raw = fs.readFileSync(s, 'utf8');
        writeTextFile(d, processFileContent(raw, entry.name, platform, skillRoot));
      } else {
        fs.copyFileSync(s, d);
      }
    }
  }
}

function installAgents(
  target: string,
  options: Options,
  platform: Platform,
): { count: number; action: 'added' | 'updated' | 'linked' | 'skipped' } {
  const srcDir = path.join(PACKAGE_ROOT, '.claude', 'agents');
  const destDir = agentsDest(target, platform);

  if (!fs.existsSync(srcDir)) return { count: 0, action: 'skipped' };

  const personaFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.md') && f.startsWith(STX_AGENT_PREFIX));
  if (personaFiles.length === 0) return { count: 0, action: 'skipped' };

  if (options.link && platform === 'claude') {
    if (fs.existsSync(destDir)) {
      const existing = fs.readdirSync(destDir).filter(f => f.endsWith('.md') && !f.startsWith(STX_AGENT_PREFIX));
      if (existing.length > 0) {
        console.log(c.warn(`  ⚠ ${platformLabel(platform)}agents/: --link skipped (non-stx agents present); copying stx-*.md instead`));
      } else {
        try { fs.rmSync(destDir, { recursive: true, force: true }); } catch { /* ignore */ }
        fs.mkdirSync(path.dirname(destDir), { recursive: true });
        fs.symlinkSync(srcDir, destDir, 'dir');
        return { count: personaFiles.length, action: 'linked' };
      }
    } else {
      fs.mkdirSync(path.dirname(destDir), { recursive: true });
      fs.symlinkSync(srcDir, destDir, 'dir');
      return { count: personaFiles.length, action: 'linked' };
    }
  }

  if (options.link && platform === 'cursor') {
    console.log(c.warn(`  ⚠ .cursor/agents/: --link not supported (transform required); copying stx-*.md`));
  }

  fs.mkdirSync(destDir, { recursive: true });

  let anyExisted = false;
  for (const file of personaFiles) {
    const destPath = path.join(destDir, file);
    if (fs.existsSync(destPath)) anyExisted = true;
    const raw = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const content = platform === 'cursor' ? transformForCursor(raw) : raw;
    writeTextFile(destPath, content);
  }

  return { count: personaFiles.length, action: anyExisted ? 'updated' : 'added' };
}

function installSkill(
  name: string,
  target: string,
  options: Options,
  platform: Platform,
): { action: 'added' | 'updated' | 'linked' | 'error' } {
  const srcDir = path.join(PACKAGE_ROOT, '.claude', 'skills', name);
  const destDir = path.join(skillsDest(target, platform), name);

  if (!fs.existsSync(srcDir)) {
    console.log(c.error(`  ✗ ${name}: source directory not found`));
    return { action: 'error' };
  }

  const existed = fs.existsSync(destDir);
  const prefix = platform === 'cursor' ? '.cursor' : '.claude';

  if (options.link && platform === 'claude') {
    if (existed) {
      try { fs.rmSync(destDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    fs.symlinkSync(srcDir, destDir, 'dir');
    console.log(c.success(`  ✓ ${prefix}/skills/${name}  ${c.dim('(symlinked)')}`));
    return { action: 'linked' };
  }

  if (options.link && platform === 'cursor') {
    console.log(c.warn(`  ⚠ .cursor/skills/${name}: --link not supported (transform required); copying`));
  }

  if (existed) {
    try { fs.rmSync(destDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  copyDirRecursive(srcDir, destDir, platform, true);

  const jsSrc = path.join(PACKAGE_ROOT, 'dist', 'skills', `${name}.js`);
  if (fs.existsSync(jsSrc)) {
    copyFileSyncSafe(jsSrc, path.join(destDir, `${name}.js`));
    fs.chmodSync(path.join(destDir, `${name}.js`), 0o755);
  }
  const mapSrc = path.join(PACKAGE_ROOT, 'dist', 'skills', `${name}.js.map`);
  if (fs.existsSync(mapSrc)) {
    copyFileSyncSafe(mapSrc, path.join(destDir, `${name}.js.map`));
  }

  const action = existed ? 'updated' : 'added';
  const label = existed ? c.dim('(updated)') : c.dim('(new)');
  console.log(c.success(`  ✓ ${prefix}/skills/${name}  ${label}`));
  return { action };
}

function runInstallPass(
  options: Options,
  platform: Platform,
  toInstall: string[],
): { added: number; updated: number; linked: number } {
  console.log(c.bold(`\n  ── ${platform === 'claude' ? 'Claude Code' : 'Cursor IDE'} → ${platformLabel(platform)} ──\n`));

  let added = 0;
  let updated = 0;
  let linked = 0;
  for (const name of toInstall) {
    const { action } = installSkill(name, options.target, options, platform);
    if (action === 'added') added++;
    else if (action === 'updated') updated++;
    else if (action === 'linked') linked++;
  }

  if (options.skills.length === 0) {
    const agentsResult = installAgents(options.target, options, platform);
    if (agentsResult.count > 0) {
      const prefix = platform === 'cursor' ? '.cursor' : '.claude';
      const label = agentsResult.action === 'linked' ? '(symlinked)' :
                    agentsResult.action === 'added' ? '(new)' : '(updated)';
      console.log(c.success(`  ✓ ${prefix}/agents/ (${agentsResult.count} stx personas)  ${c.dim(label)}`));
    }
  }

  console.log(c.dim(`\n  ${added} added · ${updated} updated${linked ? ` · ${linked} linked` : ''}`));
  return { added, updated, linked };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    showHelp();
    return;
  }

  const available = listAvailableSkills();

  if (options.list) {
    console.log(c.bold('\nAvailable skills:'));
    for (const name of available) console.log(`  /${name}`);
    console.log('');
    return;
  }

  if (!fs.existsSync(options.target)) {
    console.log(c.error(`Target directory does not exist: ${options.target}`));
    process.exit(1);
  }
  if (!fs.statSync(options.target).isDirectory()) {
    console.log(c.error(`Target is not a directory: ${options.target}`));
    process.exit(1);
  }

  const toInstall = options.skills.length > 0
    ? options.skills.filter(s => {
        if (!available.includes(s)) {
          console.log(c.error(`Unknown skill: ${s}`));
          return false;
        }
        return true;
      })
    : available;

  if (toInstall.length === 0) {
    console.log(c.warn('No skills to install.'));
    return;
  }

  if (!options.link) ensureBuilt();

  const platformDesc = options.platforms.map(p => platformLabel(p)).join(' + ');
  console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(c.bold('  stx-skills installer'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════'));
  console.log(`  Source : ${c.info(PACKAGE_ROOT)}`);
  console.log(`  Target : ${c.info(options.target)}`);
  console.log(`  Dest   : ${c.info(platformDesc)}`);
  console.log(`  Mode   : ${c.info(options.link ? 'symlink (Claude only) + copy (Cursor)' : 'refresh (overwrite stx-*)')}\n`);

  for (const platform of options.platforms) {
    runInstallPass(options, platform, toInstall);
  }

  console.log(c.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(c.success('  ✅ Done. Available slash commands in the target project:'));
  console.log(c.bold('═══════════════════════════════════════════════════════════════\n'));
  for (const name of toInstall) console.log(`  /${name}`);
  if (options.platforms.includes('cursor')) {
    console.log(c.dim('\n  Cursor: invoke via / menu or @-mention the skill name.'));
    console.log(c.dim('  Multi-agent waves use the Task tool with .cursor/agents/ personas.'));
  }
  console.log('');
}

try {
  main();
} catch (err) {
  console.error(c.error(`\nError: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
}
