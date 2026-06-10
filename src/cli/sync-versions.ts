#!/usr/bin/env node
/**
 * sync-versions.ts — unified-version stamper for the STX Skills package.
 *
 * Policy (v1.11+): every shipped skill and persona carries the SAME version —
 * the package.json version. There is no per-skill or per-persona SemVer
 * cadence anymore. A release bumps package.json once; this script stamps that
 * version into every version-bearing file so the npx install/update flow
 * always ships a self-consistent set.
 *
 * Stamped surfaces:
 *   - .claude/skills/<name>/SKILL.md     (frontmatter `version:` line)
 *   - .claude/skills/<name>/catalog.json (top-level `"version"` field)
 *   - .claude/agents/<name>.md           (frontmatter `version:` line)
 *   - README.md                          (the `Current release: **vX.Y.Z**` line)
 *
 * Modes:
 *   sync-versions              — write all stamps in place
 *   sync-versions --check      — verify everything already matches package.json
 *                                (exit 1 if a stamp would change anything);
 *                                wired into `npm run check-docs`
 *
 * Runs BEFORE generate-help in `npm run build` so the rendered help docs pick
 * up the synced catalog versions. Zero dependencies — node:fs / node:path only.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../.."); // dist/cli → repo root
const SKILLS_DIR = path.join(REPO_ROOT, ".claude/skills");
const AGENTS_DIR = path.join(REPO_ROOT, ".claude/agents");
const README = path.join(REPO_ROOT, "README.md");

interface DiffEntry {
  file: string;
  changed: boolean;
}

/**
 * Replace the `version:` line inside the leading YAML frontmatter block.
 * Files without a frontmatter version line are returned unchanged — not every
 * markdown file under the scanned directories is version-bearing.
 */
function stampFrontmatterVersion(src: string, version: string): string {
  const fm = src.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return src;
  const stamped = fm[1].replace(/^version:\s*.*$/m, `version: ${version}`);
  if (stamped === fm[1]) return src;
  return src.replace(fm[0], `---\n${stamped}\n---`);
}

/**
 * Replace the top-level `"version"` field in a catalog.json via targeted
 * regex (first occurrence) — a parse/re-stringify round-trip would reformat
 * the hand-maintained file.
 */
function stampCatalogVersion(src: string, version: string): string {
  return src.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
}

/** Replace the `Current release: **vX.Y.Z**` line in README.md. */
function stampReadmeVersion(src: string, version: string): string {
  return src.replace(/(Current release: \*\*v)[\d.]+(\*\*)/, `$1${version}$2`);
}

function syncFile(file: string, next: string, check: boolean): DiffEntry {
  const prev = fs.readFileSync(file, "utf8");
  if (prev === next) return { file, changed: false };
  if (!check) fs.writeFileSync(file, next, "utf8");
  return { file, changed: true };
}

function main() {
  const check = process.argv.includes("--check");

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    version: string;
  };

  const entries: DiffEntry[] = [];

  // ─ Skills: SKILL.md frontmatter + catalog.json ────────────────────────────
  for (const dir of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const skillMd = path.join(SKILLS_DIR, dir.name, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      const src = fs.readFileSync(skillMd, "utf8");
      entries.push(syncFile(skillMd, stampFrontmatterVersion(src, pkg.version), check));
    }
    const catalog = path.join(SKILLS_DIR, dir.name, "catalog.json");
    if (fs.existsSync(catalog)) {
      const src = fs.readFileSync(catalog, "utf8");
      entries.push(syncFile(catalog, stampCatalogVersion(src, pkg.version), check));
    }
  }

  // ─ Personas ───────────────────────────────────────────────────────────────
  for (const f of fs.readdirSync(AGENTS_DIR)) {
    if (!f.endsWith(".md")) continue;
    const persona = path.join(AGENTS_DIR, f);
    const src = fs.readFileSync(persona, "utf8");
    entries.push(syncFile(persona, stampFrontmatterVersion(src, pkg.version), check));
  }

  // ─ README "Current release" line ──────────────────────────────────────────
  if (fs.existsSync(README)) {
    const src = fs.readFileSync(README, "utf8");
    entries.push(syncFile(README, stampReadmeVersion(src, pkg.version), check));
  }

  const dirty = entries.filter((e) => e.changed);

  if (check) {
    if (dirty.length === 0) {
      console.log(`sync-versions --check: clean (all at v${pkg.version}).`);
      return;
    }
    console.error(`sync-versions --check: FAIL — files not at v${pkg.version}:`);
    for (const e of dirty) console.error(`  - ${path.relative(REPO_ROOT, e.file)}`);
    console.error("\nRun `npm run build` (or `node dist/cli/sync-versions.js`) and commit the result.");
    process.exit(1);
  }

  console.log(`sync-versions: stamped v${pkg.version} into ${dirty.length}/${entries.length} files.`);
  for (const e of dirty) console.log(`  ✓ ${path.relative(REPO_ROOT, e.file)}`);
}

main();
