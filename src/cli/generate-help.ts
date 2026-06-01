#!/usr/bin/env node
/**
 * generate-help.ts — single source of truth renderer for STX help docs.
 *
 * Reads every `.claude/skills/<name>/catalog.json`, then rewrites the
 * AUTO regions inside:
 *   - .claude/skills/stx-help/SKILL.md   (the terminal listing for /stx-help)
 *   - .claude/skills/stx-help-html/help.html  (the catalog cards for /stx-help-html)
 *
 * After rewriting help.html, also publishes a copy to:
 *   - index.html       (repo root — GitHub Pages serves this)
 *
 * The repo-root index.html is treated as a derived artifact; the source
 * of truth is help.html, which is itself partially generated from
 * catalog.json files.
 *
 * Modes:
 *   generate-help                  — write all outputs in place
 *   generate-help --check          — verify outputs are up to date (exit 1 if regen would change anything)
 *                                    used by `npm run check-docs` to catch missed regens before commit
 *
 * The script intentionally has zero dependencies — only node:fs / node:path.
 * The AUTO regions are delimited by literal HTML / markdown comments so the
 * surrounding hand-maintained content stays untouched.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../.."); // dist/cli → repo root
const SKILLS_DIR = path.join(REPO_ROOT, ".claude/skills");

const HELP_MD = path.join(SKILLS_DIR, "stx-help/SKILL.md");
const HELP_HTML = path.join(SKILLS_DIR, "stx-help-html/help.html");
const ROOT_INDEX = path.join(REPO_ROOT, "index.html");

const MD_BEGIN = "<!-- BEGIN AUTO: stx-help listing — generated from .claude/skills/*/catalog.json by `npm run build` -->";
const MD_END = "<!-- END AUTO -->";
const HTML_BEGIN = "<!-- BEGIN AUTO: skill cards — generated from .claude/skills/*/catalog.json by `npm run build` -->";
const HTML_END = "<!-- END AUTO -->";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

type Zone = "main" | "worktree" | "any" | "planned";

interface Catalog {
  $schema?: string;
  name: string;
  slash: string;
  version: string;
  zone: Zone;
  icon: string;
  terminal: {
    group: "MAIN-BOUND" | "WORKTREE-BOUND" | "ANY-BOUND";
    lines: string[];
  };
  card: {
    summary: string;
    paragraph: string;
    use_when?: string[];
    dontuse_when?: string[];
    invocations?: { comment?: string; cmd: string }[];
    extras?: Extra[];
  };
}

type Extra =
  | { kind: "bullets"; title: string; items: string[] }
  | { kind: "ordered"; title: string; items: string[] }
  | { kind: "table"; title: string; headers: string[]; rows: string[][] }
  | { kind: "callout"; tone?: "default" | "teal" | "gold"; html: string }
  | { kind: "paragraph"; title: string; html: string };

// ────────────────────────────────────────────────────────────────────────────
// Step 1: load and validate catalogs
// ────────────────────────────────────────────────────────────────────────────

/**
 * Load every catalog.json under .claude/skills/. Returns them in a stable
 * order keyed on zone (main → worktree → any → planned) and then by the
 * order each entry appears today in the legacy help.html — which is the
 * "natural" reading order. That order is captured in CARD_ORDER below;
 * skills not listed there fall back to alphabetical at the end.
 */
function loadCatalogs(): Catalog[] {
  const dirs = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const catalogs: Catalog[] = [];
  for (const dir of dirs) {
    const file = path.join(SKILLS_DIR, dir, "catalog.json");
    if (!fs.existsSync(file)) continue; // skill without a catalog is skipped silently
    const raw = fs.readFileSync(file, "utf8");
    let parsed: Catalog;
    try {
      parsed = JSON.parse(raw) as Catalog;
    } catch (e) {
      throw new Error(`catalog.json parse error in ${dir}: ${(e as Error).message}`);
    }
    if (parsed.name !== dir) {
      throw new Error(`catalog.json name mismatch in ${dir}: catalog.name="${parsed.name}", folder="${dir}"`);
    }
    catalogs.push(parsed);
  }

  catalogs.sort((a, b) => {
    const ai = CARD_ORDER.indexOf(a.name);
    const bi = CARD_ORDER.indexOf(b.name);
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return catalogs;
}

// Order used in the rendered cards section — mirrors the legacy hand-maintained
// help.html. New skills not listed here append alphabetically at the end.
const CARD_ORDER = [
  "stx-feature",
  "stx-fix",
  "stx-checkin",
  "stx-pr-merge",
  "stx-worktree-report",
  "stx-image",
  "stx-magazine-report",
  "stx-help",
  "stx-help-html",
];

// ────────────────────────────────────────────────────────────────────────────
// Step 2: render the terminal listing for /stx-help
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds the multi-line text block that lives inside the fenced code block
 * in stx-help/SKILL.md. Mirrors the original hand-maintained shape: a
 * banner line, three zone groups (MAIN/WORKTREE/ANY), one personas line,
 * and the closing pointer to /stx-help-html.
 *
 * The "personas" footer is not catalog-derived — it lives here because
 * persona ownership is constant across catalog changes. If we add a new
 * persona, edit this constant; otherwise the catalogs drive everything.
 */
function renderTerminalListing(catalogs: Catalog[], pkgVersion: string): string {
  const groups: Record<Catalog["terminal"]["group"], Catalog[]> = {
    "MAIN-BOUND": [],
    "WORKTREE-BOUND": [],
    "ANY-BOUND": [],
  };
  for (const c of catalogs) {
    if (c.zone === "planned") continue; // planned skills don't appear in the terminal listing
    groups[c.terminal.group].push(c);
  }

  // Column width: longest slash + 2-space gutter, enforced across all groups
  // so the right column lines up vertically.
  const longestSlash = Math.max(
    ...catalogs.filter((c) => c.zone !== "planned").map((c) => c.slash.length),
  );
  const SLASH_COL = longestSlash + 2;

  function renderGroup(label: string, tagline: string, entries: Catalog[]): string {
    if (entries.length === 0) return "";
    const head = `${label.padEnd(17)}${tagline}`;
    const body = entries
      .map((c) => {
        const slashPadded = c.slash.padEnd(SLASH_COL);
        const indent = "  ";
        const continuationIndent = " ".repeat(2 + SLASH_COL);
        const [first, ...rest] = c.terminal.lines;
        const head = `${indent}${slashPadded}${first}`;
        const tail = rest.map((line) => `${continuationIndent}${line}`).join("\n");
        return tail ? `${head}\n${tail}` : head;
      })
      .join("\n");
    return `${head}\n${body}`;
  }

  const main = renderGroup("MAIN-BOUND", "run on main, before any worktree exists", groups["MAIN-BOUND"]);
  const wt = renderGroup("WORKTREE-BOUND", "run inside a feature worktree", groups["WORKTREE-BOUND"]);
  const any = renderGroup("ANY-BOUND", "runs anywhere — main or any worktree", groups["ANY-BOUND"]);

  const personas =
    "PERSONAS         versioned agent contracts under .claude/agents/ (10 total)\n" +
    "  stx-analyst, stx-architect, stx-qa, stx-reviewer, stx-coder,\n" +
    "  stx-dev-base, stx-dev-tier-{db,service,api,ui}        See AGENTS.md";

  return [
    `STX Skills · v${pkgVersion}`,
    "",
    main,
    "",
    wt,
    "",
    any,
    "",
    personas,
    "",
    "For the walkthrough with diagrams, examples, and the settings reference:",
    "  /stx-help-html",
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Step 3: render the HTML cards for /stx-help-html
// ────────────────────────────────────────────────────────────────────────────

/**
 * Re-wrap the `<o>...</o>` and `<s>...</s>` tokens that catalogs use inside
 * invocation `cmd` fields back into the help.html idiom (`<span class="o">`,
 * `<span class="s">`). The catalog format uses short tokens so they're
 * readable as JSON; the rendered HTML matches the existing styling.
 */
function rewrapCmd(cmd: string): string {
  return cmd
    .replace(/<o>([^<]*)<\/o>/g, '<span class="o">$1</span>')
    .replace(/<s>([^<]*)<\/s>/g, '<span class="s">$1</span>');
}

function zoneClass(zone: Zone): string {
  if (zone === "main") return "type-main";
  if (zone === "worktree") return "type-wt";
  if (zone === "any") return "type-any";
  return "type-planned";
}

function zoneLabel(zone: Zone): string {
  if (zone === "main") return "main-bound";
  if (zone === "worktree") return "worktree-bound";
  if (zone === "any") return "any-bound";
  return "planned";
}

/**
 * Build "v1.4" from "1.4.0" — the badge convention in help.html is two-part.
 * We strip the patch version because the badge is meant for at-a-glance
 * scanning, not exact version reporting. SKILL.md frontmatter still has the
 * full semver.
 */
function badgeVersion(version: string): string {
  const parts = version.split(".");
  return `v${parts[0]}.${parts[1]}`;
}

function renderCard(c: Catalog): string {
  const lines: string[] = [];
  lines.push(`      <details class="skill" id="sk-${c.name}">`);
  lines.push(`        <summary>`);
  lines.push(`          <span class="ico">${c.icon}</span>`);
  lines.push(`          <span class="nm">${c.slash}<span class="one">${c.card.summary}</span></span>`);
  lines.push(`          <span class="type ${zoneClass(c.zone)}">${zoneLabel(c.zone)}</span>`);
  lines.push(`          <span class="ver">${badgeVersion(c.version)}</span>`);
  lines.push(`          <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>`);
  lines.push(`        </summary>`);
  lines.push(`        <div class="body">`);
  lines.push(`          <p>${c.card.paragraph}</p>`);

  if (c.card.use_when?.length || c.card.dontuse_when?.length) {
    lines.push(``);
    lines.push(`          <div class="blocks">`);
    if (c.card.use_when?.length) {
      lines.push(`            <div class="block use"><div class="lbl">Use when</div><ul>`);
      for (const item of c.card.use_when) lines.push(`              <li>${item}</li>`);
      lines.push(`            </ul></div>`);
    }
    if (c.card.dontuse_when?.length) {
      lines.push(`            <div class="block dontuse"><div class="lbl">Don't use when</div><ul>`);
      for (const item of c.card.dontuse_when) lines.push(`              <li>${item}</li>`);
      lines.push(`            </ul></div>`);
    }
    lines.push(`          </div>`);
  }

  if (c.card.invocations?.length) {
    lines.push(``);
    lines.push(`          <h4>Invocations</h4>`);
    const blockParts: string[] = [];
    for (const inv of c.card.invocations) {
      const block: string[] = [];
      if (inv.comment) block.push(`<span class="c"># ${inv.comment}</span>`);
      block.push(rewrapCmd(inv.cmd));
      blockParts.push(block.join("\n"));
    }
    lines.push(`          <pre>${blockParts.join("\n\n")}</pre>`);
  }

  if (c.card.extras?.length) {
    for (const ex of c.card.extras) {
      lines.push(``);
      lines.push(renderExtra(ex));
    }
  }

  lines.push(`        </div>`);
  lines.push(`      </details>`);
  return lines.join("\n");
}

function renderExtra(ex: Extra): string {
  if (ex.kind === "bullets") {
    const items = ex.items.map((i) => `            <li>${i}</li>`).join("\n");
    return `          <h4>${ex.title}</h4>\n          <ul>\n${items}\n          </ul>`;
  }
  if (ex.kind === "ordered") {
    const items = ex.items.map((i) => `            <li>${i}</li>`).join("\n");
    return `          <h4>${ex.title}</h4>\n          <ol>\n${items}\n          </ol>`;
  }
  if (ex.kind === "table") {
    const head = ex.headers.map((h) => `<th>${h}</th>`).join("");
    const rows = ex.rows
      .map((r) => `              <tr>${r.map((c, i) => (i === 0 ? `<td class="k">${c}</td>` : `<td>${c}</td>`)).join("")}</tr>`)
      .join("\n");
    return (
      `          <h4>${ex.title}</h4>\n` +
      `          <table class="deftbl">\n` +
      `            <thead><tr>${head}</tr></thead>\n` +
      `            <tbody>\n${rows}\n            </tbody>\n` +
      `          </table>`
    );
  }
  if (ex.kind === "callout") {
    const cls = ex.tone && ex.tone !== "default" ? ` callout-${ex.tone}` : "";
    return `          <div class="callout${cls}">${ex.html}</div>`;
  }
  if (ex.kind === "paragraph") {
    return `          <h4>${ex.title}</h4>\n          <p>${ex.html}</p>`;
  }
  // Exhaustiveness check — unreachable if Extra union is complete.
  const _exhaustive: never = ex;
  return _exhaustive;
}

function renderCardsBlock(catalogs: Catalog[]): string {
  return catalogs.map(renderCard).join("\n\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Step 4: rewrite the AUTO regions and detect drift
// ────────────────────────────────────────────────────────────────────────────

/**
 * Replace the content between BEGIN/END markers. The markers themselves
 * are preserved verbatim. If markers are missing, throws — the file must
 * be marked up first (see the AUTO-markers task).
 */
function replaceAutoRegion(file: string, begin: string, end: string, replacement: string): string {
  const src = fs.readFileSync(file, "utf8");
  const bi = src.indexOf(begin);
  const ei = src.indexOf(end);
  if (bi === -1 || ei === -1 || ei <= bi) {
    throw new Error(`AUTO markers not found in ${file}. Expected:\n  ${begin}\n  …\n  ${end}`);
  }
  const before = src.slice(0, bi + begin.length);
  const after = src.slice(ei);
  return `${before}\n${replacement}\n${after}`;
}

interface DiffEntry {
  file: string;
  changed: boolean;
}

function writeIfChanged(file: string, next: string, check: boolean): DiffEntry {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (prev === next) return { file, changed: false };
  if (!check) fs.writeFileSync(file, next, "utf8");
  return { file, changed: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

function main() {
  const check = process.argv.includes("--check");

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    version: string;
  };
  const catalogs = loadCatalogs();
  if (catalogs.length === 0) {
    throw new Error(`No catalog.json files found under ${SKILLS_DIR}`);
  }

  // ─ Terminal listing ──────────────────────────────────────────────────────
  const terminal = renderTerminalListing(catalogs, pkg.version);
  const mdNext = replaceAutoRegion(HELP_MD, MD_BEGIN, MD_END, "```\n" + terminal + "\n```");
  const mdEntry = writeIfChanged(HELP_MD, mdNext, check);

  // ─ HTML cards (in help.html) ─────────────────────────────────────────────
  const cards = renderCardsBlock(catalogs);
  const htmlNext = replaceAutoRegion(HELP_HTML, HTML_BEGIN, HTML_END, cards);
  const htmlEntry = writeIfChanged(HELP_HTML, htmlNext, check);

  // ─ Repo-root index.html (mirror of help.html) ────────────────────────────
  // We read the just-computed htmlNext rather than re-reading help.html
  // because under --check we may not have written it yet.
  const rootEntry = writeIfChanged(ROOT_INDEX, htmlNext, check);

  const entries = [mdEntry, htmlEntry, rootEntry];
  const dirty = entries.filter((e) => e.changed);

  if (check) {
    if (dirty.length === 0) {
      console.log(`generate-help --check: clean (${catalogs.length} catalogs).`);
      return;
    }
    console.error("generate-help --check: FAIL — outputs are stale:");
    for (const e of dirty) console.error(`  - ${path.relative(REPO_ROOT, e.file)}`);
    console.error("\nRun `npm run build` (or `node dist/cli/generate-help.js`) and commit the result.");
    process.exit(1);
  }

  console.log(`generate-help: wrote ${dirty.length}/${entries.length} files (${catalogs.length} catalogs).`);
  for (const e of dirty) console.log(`  ✓ ${path.relative(REPO_ROOT, e.file)}`);
}

main();
