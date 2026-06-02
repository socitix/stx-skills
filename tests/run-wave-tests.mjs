#!/usr/bin/env node
/**
 * ============================================================================
 *  run-wave-tests.mjs — failing-test runner for wave-fix-report-in-waves-acac
 * ============================================================================
 *
 *  Wave: wave-fix-report-in-waves-acac
 *  Purpose: encode the acceptance criteria of every task in the wave as a
 *  failing assertion right now (the feature isn't built yet). The QA persona
 *  reruns this after every Dev hand-back; the same script is the green-gate.
 *
 *  This script is the property of the QA agent. Dev personas are FORBIDDEN
 *  from editing this file (or anything under tests/) — touching it is a
 *  halt-the-loop offense per .claude/agents/stx-qa.md and .claude/agents/
 *  stx-coder.md / stx-dev-base.md.
 *
 *  Why a single hand-rolled script:
 *  - The repo has no Vitest / Playwright / Jest configured.
 *  - All 15 tasks are content / template / build-pipeline changes whose
 *    "passes" can be verified by reading files + grepping for required
 *    markers, with the exception of F3-T4 / F3-T5 which simply shell out
 *    to `npm run build` and `npm run check-docs`.
 *  - One file, one switch on task ID, zero new dev deps — matches the
 *    repo's existing "minimal tooling" style (only @types/node + typescript
 *    in devDependencies).
 *
 *  Usage:
 *    node tests/run-wave-tests.mjs                 # run all tasks
 *    node tests/run-wave-tests.mjs F1-T1           # run one task
 *    node tests/run-wave-tests.mjs F1-T1 F2-T3     # run two tasks
 *
 *  Each per-task function is documented with @task <ID>. Functions assert
 *  the acceptance hint from wave-state.json[tasks[i].acceptance_test_hint].
 *  Functions return { ok: boolean, messages: string[] }. The outer runner
 *  prints PASS / FAIL per task and exits 1 if any fail.
 * ============================================================================
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const p = (rel) => join(REPO, rel);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readIfExists(absPath) {
  if (!existsSync(absPath)) return null;
  return readFileSync(absPath, "utf8");
}

function fileExists(absPath) {
  return existsSync(absPath) && statSync(absPath).isFile();
}

function parseFrontmatter(md) {
  // Naive but sufficient for our SKILL.md / persona file shape.
  if (!md || !md.startsWith("---")) return null;
  const end = md.indexOf("\n---", 4);
  if (end === -1) return null;
  const body = md.slice(4, end);
  const fm = {};
  for (const line of body.split("\n")) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

function asserts(label, conditions) {
  const failures = [];
  for (const { name, ok, detail } of conditions) {
    if (!ok) failures.push(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
  return failures.length === 0
    ? { ok: true, messages: [`✓ ${label}`] }
    : { ok: false, messages: [`✗ ${label}`, ...failures] };
}

// ---------------------------------------------------------------------------
// Per-task assertions
// ---------------------------------------------------------------------------

/**
 * @task F1-T1
 * Assert: .claude/skills/stx-fix/templates/fix-state.schema.json exists and
 * describes the canonical fix-state.json shape per F1 AC#4. Must mirror
 * wave-state.schema.json's dialect/conventions.
 */
function testF1T1() {
  const path = p(".claude/skills/stx-fix/templates/fix-state.schema.json");
  if (!fileExists(path)) {
    return { ok: false, messages: [`✗ F1-T1: ${path} does not exist (file not created yet)`] };
  }
  let schema;
  try {
    schema = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, messages: [`✗ F1-T1: schema is not valid JSON — ${e.message}`] };
  }
  const props = schema.properties || {};
  const required = new Set(schema.required || []);
  const requiredTemplateFields = [
    "fix_id", "fix_slug", "status", "started_at", "finished_at",
    "title", "issues", "repro", "expected", "scope_hints", "out_of_scope",
    "test_kind", "iteration_cap", "commit_policy",
    "iterations_used", "tests_written", "files_touched",
  ];
  const statusEnum = props.status?.enum || [];
  const expectedStatusEnum = ["done", "halted-at-cap", "blocked", "cancelled"];
  return asserts("F1-T1 fix-state.schema.json shape", [
    { name: "uses JSON Schema 2020-12 dialect", ok: schema.$schema?.includes("2020-12") },
    { name: "has properties block", ok: typeof props === "object" && Object.keys(props).length > 0 },
    { name: "has required[] block", ok: Array.isArray(schema.required) && schema.required.length > 0 },
    ...requiredTemplateFields.map((f) => ({
      name: `properties.${f} declared`,
      ok: f in props,
    })),
    {
      name: "fix_id pattern enforces fix-<slug> shape",
      ok: typeof props.fix_id?.pattern === "string" && props.fix_id.pattern.startsWith("^fix-"),
      detail: props.fix_id?.pattern ? `pattern=${props.fix_id.pattern}` : "no pattern set",
    },
    {
      name: `status enum is exhaustive (${expectedStatusEnum.join("|")})`,
      ok: expectedStatusEnum.every((s) => statusEnum.includes(s)) && statusEnum.length === expectedStatusEnum.length,
      detail: `got [${statusEnum.join(",")}]`,
    },
    {
      name: "tests_written is array of strings (mirrors test_path shape)",
      ok: props.tests_written?.type === "array" && props.tests_written?.items?.type === "string",
    },
    {
      name: "files_touched items have {path, add, del}",
      ok: props.files_touched?.type === "array"
        && props.files_touched?.items?.properties?.path
        && props.files_touched?.items?.properties?.add
        && props.files_touched?.items?.properties?.del,
    },
    {
      name: "started_at uses date-time format",
      ok: props.started_at?.format === "date-time",
    },
    {
      name: "core ids/status fields are in required[]",
      ok: ["fix_id", "fix_slug", "status", "started_at"].every((f) => required.has(f)),
    },
  ]);
}

/**
 * @task F1-T2
 * Assert: .claude/skills/stx-fix/templates/fix-report.html exists and is
 * structured like result.html — top-of-file comment block documenting every
 * placeholder, INLINE_STYLES placeholder, h1 "Fix Report", §1 Issues table,
 * §2 tests_written, §3 files_touched, status-pill classes for the four
 * statuses.
 */
function testF1T2() {
  const path = p(".claude/skills/stx-fix/templates/fix-report.html");
  if (!fileExists(path)) {
    return { ok: false, messages: [`✗ F1-T2: ${path} does not exist (file not created yet)`] };
  }
  const html = readFileSync(path, "utf8");
  return asserts("F1-T2 fix-report.html structure", [
    { name: "has top-of-file <!-- comment --> documenting placeholders", ok: /^<!doctype html>\s*<!--[\s\S]+PLACEHOLDERS[\s\S]+-->/i.test(html) },
    { name: "contains {{INLINE_STYLES}} placeholder", ok: html.includes("{{INLINE_STYLES}}") },
    { name: "header H1 reads 'Fix Report'", ok: /<h1[^>]*>\s*Fix Report\s*<\/h1>/i.test(html) },
    { name: "contains {{FIX_ID}} or {{fix_id}} placeholder", ok: /\{\{FIX_ID\}\}|\{\{fix_id\}\}/.test(html) },
    { name: "contains {{FIX_SLUG}} or {{fix_slug}} placeholder", ok: /\{\{FIX_SLUG\}\}|\{\{fix_slug\}\}/.test(html) },
    { name: "contains {{STATUS}} or {{status}} placeholder", ok: /\{\{STATUS\}\}|\{\{status\}\}/.test(html) },
    { name: "status-done pill class referenced", ok: /status-done/.test(html) },
    { name: "status-halted-at-cap pill class referenced", ok: /status-halted-at-cap/.test(html) },
    { name: "status-blocked pill class referenced", ok: /status-blocked/.test(html) },
    { name: "status-cancelled pill class referenced", ok: /status-cancelled/.test(html) },
    { name: "§1 Issues table block (with #each issues)", ok: /\{\{#each issues\}\}[\s\S]+\{\{\/each\}\}/.test(html) },
    { name: "§2 tests_written list (with #each tests_written)", ok: /\{\{#each tests_written\}\}[\s\S]+\{\{\/each\}\}/.test(html) },
    { name: "§3 files_touched list (with #each files_touched)", ok: /\{\{#each files_touched\}\}[\s\S]+\{\{\/each\}\}/.test(html) },
    { name: "has <html lang=\"en\"> and <body>", ok: /<html[^>]+lang=/.test(html) && html.includes("<body>") },
  ]);
}

/**
 * @task F1-T3
 * Assert: .claude/agents/stx-qa.md frontmatter version bumped 1.0.0 → 1.1.0
 * and a new "Hand-back format (stx-fix)" subsection names the structured
 * fields (tests_written, test_paths_per_issue) without removing any existing
 * rule.
 */
function testF1T3() {
  const path = p(".claude/agents/stx-qa.md");
  const md = readIfExists(path);
  if (md === null) return { ok: false, messages: [`✗ F1-T3: ${path} missing`] };
  const fm = parseFrontmatter(md);
  const versionOk = fm?.version === "1.1.0";
  const handBackSection = /Hand-back format \(stx-fix\)/i.test(md);
  const namesTestsWritten = /tests_written/.test(md);
  const namesTestPathsPerIssue = /test_paths_per_issue/.test(md);
  // Existing-rules regression check: every Authoring-contract numbered step (1–5) under stx-fix must still be present.
  const stxFixSteps = [
    "Read the rendered prompt's §1",
    "Choose test kind",
    "Write ONE failing test per issue",
    "Run the test. Paste output as evidence",
    "Hand the failing test path",
  ];
  return asserts("F1-T3 stx-qa.md hand-back addendum", [
    { name: "frontmatter version === 1.1.0", ok: versionOk, detail: `got ${fm?.version}` },
    { name: "new 'Hand-back format (stx-fix)' subsection present", ok: handBackSection },
    { name: "subsection names tests_written field", ok: namesTestsWritten },
    { name: "subsection names test_paths_per_issue field", ok: namesTestPathsPerIssue },
    ...stxFixSteps.map((needle) => ({
      name: `existing stx-fix step preserved: '${needle.slice(0, 30)}…'`,
      ok: md.includes(needle),
    })),
    { name: "Gate 3 rule still present", ok: /Gate 3 — Dry-run boundary/.test(md) },
  ]);
}

/**
 * @task F1-T4
 * Assert: .claude/agents/stx-coder.md frontmatter version bumped 1.0.0 →
 * 1.1.0 and "When you finish" now requires a structured files_touched[]
 * block (path + add + del). Hard-rules section unchanged.
 */
function testF1T4() {
  const path = p(".claude/agents/stx-coder.md");
  const md = readIfExists(path);
  if (md === null) return { ok: false, messages: [`✗ F1-T4: ${path} missing`] };
  const fm = parseFrontmatter(md);
  const hasFilesTouched = /files_touched/.test(md);
  const hasAddDel =
    /\b(lines[-_ ]?added|add)\b/i.test(md) && /\b(lines[-_ ]?removed|del)\b/i.test(md);
  const hardRulesPresent = [
    "You MUST NOT edit any test file",
    "You MUST NOT weaken or skip assertions",
    "You MUST NOT touch files outside the suspected scope",
    "You MUST NOT loosen typing",
  ];
  return asserts("F1-T4 stx-coder.md hand-back addendum", [
    { name: "frontmatter version === 1.1.0", ok: fm?.version === "1.1.0", detail: `got ${fm?.version}` },
    { name: "'When you finish' references files_touched", ok: hasFilesTouched && /When you finish/i.test(md) },
    { name: "structured block documents add + del (or equivalent)", ok: hasAddDel },
    ...hardRulesPresent.map((needle) => ({
      name: `hard rule unchanged: '${needle.slice(0, 30)}…'`,
      ok: md.includes(needle),
    })),
  ]);
}

/**
 * @task F1-T5
 * Assert: .claude/skills/stx-fix/SKILL.md Step 6/7 carry the artifact-write
 * subsection, collision-handling description, and template-path references.
 *
 * NOTE on the version assertion: F1-T5's own change MUST NOT bump the version
 * (that's F3-T1's job). After F3-T1 runs, the version is legitimately at
 * 1.3.0. To avoid temporal staleness, we assert SemVer shape and a >=1.2.0
 * lower bound — F3-T1 / F3-T2 pin the exact target value (1.3.0). F1-T5's
 * own observable deliverable (artifact-write subsection, collision handling,
 * template/schema references) is verified by the other assertions below.
 */
function testF1T5() {
  const path = p(".claude/skills/stx-fix/SKILL.md");
  const md = readIfExists(path);
  if (md === null) return { ok: false, messages: [`✗ F1-T5: ${path} missing`] };
  const fm = parseFrontmatter(md);
  const versionStr = fm?.version || "";
  const semverShapeOk = /^\d+\.\d+\.\d+$/.test(versionStr);
  let semverGteMinOk = false;
  if (semverShapeOk) {
    const [maj, min, pat] = versionStr.split(".").map((n) => parseInt(n, 10));
    const [rMaj, rMin, rPat] = [1, 2, 0];
    semverGteMinOk =
      maj > rMaj ||
      (maj === rMaj && min > rMin) ||
      (maj === rMaj && min === rMin && pat >= rPat);
  }
  const referencesTestsWritten = /tests_written/.test(md);
  const referencesFilesTouched = /files_touched/.test(md);
  const docsArtifactWrite = /docs\/waves\/fix-\{slug\}\//.test(md);
  const collisionThreeOptions =
    /overwrite/i.test(md) && /numeric suffix|append.*suffix|suffix.*-2/i.test(md) && /cancel/i.test(md);
  const defaultCancel = /default[:\s]*cancel|cancel.*default/i.test(md);
  const referencesFixReportTpl = /fix-report\.html/.test(md);
  const referencesFixStateSchema = /fix-state\.schema\.json/.test(md);
  return asserts("F1-T5 stx-fix/SKILL.md artifact-write subsection", [
    { name: "frontmatter version is valid SemVer (X.Y.Z)", ok: semverShapeOk, detail: `got ${versionStr}` },
    { name: "frontmatter version >= 1.2.0 (F1-T5 must not have downgraded it; F3-T1 may bump it further)", ok: semverGteMinOk, detail: `got ${versionStr}` },
    { name: "Step 6 references tests_written (QA hand-back)", ok: referencesTestsWritten },
    { name: "Step 6 references files_touched (Coder hand-back)", ok: referencesFilesTouched },
    { name: "Step 7 describes docs/waves/fix-{slug}/ folder write", ok: docsArtifactWrite },
    { name: "Step 7 names two artifacts fix-report.html + fix-state.json", ok: /fix-report\.html/.test(md) && /fix-state\.json/.test(md) },
    { name: "collision-handling: overwrite + numeric suffix + cancel options", ok: collisionThreeOptions },
    { name: "collision-handling default is cancel", ok: defaultCancel },
    { name: "references new template fix-report.html", ok: referencesFixReportTpl },
    { name: "references new schema fix-state.schema.json", ok: referencesFixStateSchema },
    { name: "no BEGIN AUTO / END AUTO regions exist in this file", ok: !/BEGIN AUTO/.test(md) && !/END AUTO/.test(md) },
  ]);
}

/**
 * @task F1-T6
 * Assert: .claude/skills/stx-fix/template.md §9 has a new bullet describing
 * the docs/waves/fix-{slug}/ write that happens BEFORE the terminal summary,
 * documents the new last-line literal "Report written to <abs-path>", and
 * preserves the existing five-bullet structure and FORM_FIELDS block.
 */
function testF1T6() {
  const path = p(".claude/skills/stx-fix/template.md");
  const md = readIfExists(path);
  if (md === null) return { ok: false, messages: [`✗ F1-T6: ${path} missing`] };
  const reportingHeader = /## 9\. Reporting back to the user/;
  const artifactBefore = /docs\/waves\/fix-\{slug\}\//.test(md) && /before/i.test(md.slice(md.search(reportingHeader)));
  const lastLineLiteral = /Report written to[^\n]*fix-report\.html/.test(md);
  const fiveBullets = [
    "**Status:**",
    "**Per-issue table:**",
    "**Iterations used:**",
    "**Notable:**",
    "**Next action awaiting user:**",
  ];
  const formFieldsUnchanged = /FORM_FIELDS:/.test(md) && /- name: title\s+type: text/.test(md);
  return asserts("F1-T6 stx-fix/template.md §9 artifact-write", [
    { name: "§9 heading still present", ok: reportingHeader.test(md) },
    { name: "§9 references docs/waves/fix-{slug}/ artifact write", ok: artifactBefore },
    { name: "new last-line literal documented (Report written to ...fix-report.html)", ok: lastLineLiteral },
    ...fiveBullets.map((needle) => ({
      name: `existing §9 bullet preserved: '${needle}'`,
      ok: md.includes(needle),
    })),
    { name: "FORM_FIELDS YAML block unchanged at top of file", ok: formFieldsUnchanged },
  ]);
}

/**
 * @task F2-T1
 * Assert: .claude/skills/stx-fix/templates/fix-wiki.html exists, mirrors
 * wave-wiki.html structurally, has differentiated eyebrow/H1/lede, and
 * documents the scan glob docs/waves/fix-<slug>/fix-state.json.
 */
function testF2T1() {
  const path = p(".claude/skills/stx-fix/templates/fix-wiki.html");
  if (!fileExists(path)) {
    return { ok: false, messages: [`✗ F2-T1: ${path} does not exist (file not created yet)`] };
  }
  const html = readFileSync(path, "utf8");
  return asserts("F2-T1 fix-wiki.html template", [
    { name: "contains {{INLINE_STYLES}} placeholder", ok: html.includes("{{INLINE_STYLES}}") },
    { name: "eyebrow text mentions 'Cross-fix index'", ok: /Cross-fix index/.test(html) },
    { name: "eyebrow text mentions 'rebuilt on every fix close-out'", ok: /rebuilt on every fix close-out/.test(html) },
    { name: "H1 reads 'Fix Wiki'", ok: /<h1[^>]*>\s*Fix Wiki\s*<\/h1>/i.test(html) },
    { name: "lede paragraph references /stx-fix (not /stx-feature)", ok: /\/stx-fix/.test(html) },
    { name: "single-table layout with {{#each fixes}}", ok: /\{\{#each fixes\}\}[\s\S]+\{\{\/each\}\}/.test(html) },
    { name: "links to ./fix-{slug}/fix-report.html (or ./fix-{slug}/)", ok: /\.\/fix-[^"']+(fix-report\.html|\{slug\}\/)/.test(html) || /\{\{link\}\}|\{\{LINK\}\}/.test(html) },
    { name: "status-done pill class referenced", ok: /status-done/.test(html) },
    { name: "status-halted-at-cap pill class referenced", ok: /status-halted-at-cap/.test(html) },
    { name: "status-blocked pill class referenced", ok: /status-blocked/.test(html) },
    { name: "status-cancelled pill class referenced", ok: /status-cancelled/.test(html) },
    { name: "top-of-file comment documents scan glob docs/waves/fix-*/fix-state.json", ok: /docs\/waves\/fix-\*\/fix-state\.json/.test(html) },
    { name: "sort order documented as started_at DESC", ok: /started_at.*DESC|DESC.*started_at/i.test(html) },
  ]);
}

/**
 * @task F2-T2
 * Assert: stx-feature/templates/wave-wiki.html comment block tightens the
 * documented scan glob to the wave-prefixed form (not the unprefixed star
 * form) and adds a paragraph excluding fix-prefixed folders with a pointer
 * to fix-wiki.html. The rendered HTML body must be unchanged.
 */
function testF2T2() {
  const path = p(".claude/skills/stx-feature/templates/wave-wiki.html");
  const html = readIfExists(path);
  if (html === null) return { ok: false, messages: [`✗ F2-T2: ${path} missing`] };
  const commentEnd = html.indexOf("-->");
  const comment = commentEnd === -1 ? "" : html.slice(0, commentEnd);
  const body = commentEnd === -1 ? html : html.slice(commentEnd + 3);
  // Body must still contain the original anchors (head + .wrap + table).
  const bodyAnchorsOk = body.includes("<title>Wave Wiki —")
    && body.includes("{{INLINE_STYLES}}")
    && body.includes("{{#each waves}}");
  return asserts("F2-T2 wave-wiki.html comment-block tightening", [
    { name: "comment block documents glob as docs/waves/wave-*/wave-state.json", ok: /docs\/waves\/wave-\*\/wave-state\.json/.test(comment) },
    { name: "comment block NO LONGER references stale docs/waves/*/wave-state.json", ok: !/docs\/waves\/\*\/wave-state\.json/.test(comment) },
    { name: "comment block explicitly excludes fix-*/ folders", ok: /fix-\*/.test(comment) && /exclud/i.test(comment) },
    { name: "comment block points to fix-wiki.html", ok: /fix-wiki\.html/.test(comment) },
    { name: "HTML body anchors still present (head + table)", ok: bodyAnchorsOk },
  ]);
}

/**
 * @task F2-T3
 * Assert: .claude/skills/stx-fix/SKILL.md Step 7 documents the fix-wiki.html
 * rebuild (with the exact scan glob), declares it idempotent, declares it
 * sorted by started_at DESC, and includes a wave-wiki separation note.
 */
function testF2T3() {
  const path = p(".claude/skills/stx-fix/SKILL.md");
  const md = readIfExists(path);
  if (md === null) return { ok: false, messages: [`✗ F2-T3: ${path} missing`] };
  const referencesGlob = /docs\/waves\/fix-\*\/fix-state\.json/.test(md);
  const referencesIdempotence = /idempoten/i.test(md);
  const referencesSort = /started_at[\s\S]{0,40}DESC|DESC[\s\S]{0,40}started_at/i.test(md);
  const waveWikiSeparation = /wave-wiki\.html/.test(md) && /(NOT|not)\s+touch|forbidden|only\s+fix-wiki/i.test(md);
  const referencesFixWikiTpl = /\.claude\/skills\/stx-fix\/templates\/fix-wiki\.html/.test(md);
  return asserts("F2-T3 stx-fix/SKILL.md fix-wiki rebuild instructions", [
    { name: "Step 7 references fix-wiki.html rebuild", ok: /fix-wiki\.html/.test(md) },
    { name: "Step 7 spells out scan glob docs/waves/fix-*/fix-state.json", ok: referencesGlob },
    { name: "Step 7 declares the rebuild idempotent", ok: referencesIdempotence },
    { name: "Step 7 declares sort order started_at DESC", ok: referencesSort },
    { name: "Step 7 forbids /stx-fix from touching wave-wiki.html", ok: waveWikiSeparation },
    { name: "references new template .claude/skills/stx-fix/templates/fix-wiki.html", ok: referencesFixWikiTpl },
  ]);
}

/**
 * @task F2-T4
 * Assert: stx-feature SKILL.md and template.md tighten their wave-wiki glob
 * from the unprefixed star form to the wave-prefixed form and add a
 * one-sentence note that fix folders are aggregated separately in
 * fix-wiki.html.
 */
function testF2T4() {
  const skillPath = p(".claude/skills/stx-feature/SKILL.md");
  const tplPath = p(".claude/skills/stx-feature/template.md");
  const skill = readIfExists(skillPath);
  const tpl = readIfExists(tplPath);
  if (skill === null) return { ok: false, messages: [`✗ F2-T4: ${skillPath} missing`] };
  if (tpl === null) return { ok: false, messages: [`✗ F2-T4: ${tplPath} missing`] };
  return asserts("F2-T4 stx-feature SKILL.md + template.md glob tightening", [
    { name: "SKILL.md uses glob docs/waves/wave-*/wave-state.json", ok: /docs\/waves\/wave-\*\/wave-state\.json/.test(skill) },
    { name: "SKILL.md NO LONGER uses stale glob docs/waves/*/wave-state.json", ok: !/docs\/waves\/\*\/wave-state\.json/.test(skill) },
    { name: "SKILL.md notes fix-*/ folders excluded → fix-wiki.html", ok: /fix-\*/.test(skill) && /fix-wiki\.html/.test(skill) },
    { name: "template.md uses glob docs/waves/wave-*/wave-state.json", ok: /docs\/waves\/wave-\*\/wave-state\.json/.test(tpl) },
    { name: "template.md NO LONGER uses stale glob docs/waves/*/wave-state.json", ok: !/docs\/waves\/\*\/wave-state\.json/.test(tpl) },
    { name: "template.md notes fix-*/ folders excluded → fix-wiki.html", ok: /fix-\*/.test(tpl) && /fix-wiki\.html/.test(tpl) },
  ]);
}

/**
 * @task F3-T1
 * Assert: stx-fix/SKILL.md frontmatter version bumped 1.2.0 → 1.3.0 and
 * description mentions writes a per-fix folder under docs/waves/fix-{slug}/.
 */
function testF3T1() {
  const path = p(".claude/skills/stx-fix/SKILL.md");
  const md = readIfExists(path);
  if (md === null) return { ok: false, messages: [`✗ F3-T1: ${path} missing`] };
  const fm = parseFrontmatter(md);
  const desc = fm?.description || "";
  return asserts("F3-T1 stx-fix SKILL.md version + description bump", [
    { name: "frontmatter version === 1.3.0", ok: fm?.version === "1.3.0", detail: `got ${fm?.version}` },
    { name: "frontmatter name unchanged (stx-fix)", ok: fm?.name === "stx-fix" },
    { name: "frontmatter author unchanged (STX)", ok: fm?.author === "STX" },
    {
      name: "description mentions 'per-fix folder under docs/waves/fix-{slug}/' (or equivalent)",
      ok: /per-fix folder/i.test(desc) || /docs\/waves\/fix-\{slug\}\//.test(desc),
      detail: `description=${desc.slice(0, 80)}…`,
    },
  ]);
}

/**
 * @task F3-T2
 * Assert: stx-fix/catalog.json version === 1.3.0; card.summary mentions
 * per-fix folder; card.paragraph mentions both fix-report.html and
 * fix-state.json; card.extras includes a new entry naming three artifact
 * filenames; and `npm run check-docs` exits 0.
 */
function testF3T2() {
  const path = p(".claude/skills/stx-fix/catalog.json");
  const raw = readIfExists(path);
  if (raw === null) return { ok: false, messages: [`✗ F3-T2: ${path} missing`] };
  let cat;
  try {
    cat = JSON.parse(raw);
  } catch (e) {
    return { ok: false, messages: [`✗ F3-T2: catalog.json is not valid JSON — ${e.message}`] };
  }
  const card = cat.card || {};
  const extrasText = JSON.stringify(card.extras || []);
  const summaryOk = /per-fix folder|fix-\{slug\}\//.test(card.summary || "");
  const paragraphOk = /fix-report\.html/.test(card.paragraph || "")
    && /fix-state\.json/.test(card.paragraph || "");
  const extrasNamesAllThree =
    /fix-report\.html/.test(extrasText)
    && /fix-state\.json/.test(extrasText)
    && /fix-wiki\.html/.test(extrasText);
  // Check check-docs separately at the end; this is a "would it pass?" companion.
  let checkDocsOk = false;
  let checkDocsErr = "";
  try {
    execSync("npm run check-docs", { cwd: REPO, stdio: "pipe" });
    checkDocsOk = true;
  } catch (e) {
    checkDocsErr = (e.stderr?.toString() || e.stdout?.toString() || e.message).slice(0, 240);
  }
  return asserts("F3-T2 stx-fix catalog.json + check-docs", [
    { name: "catalog.json version === 1.3.0", ok: cat.version === "1.3.0", detail: `got ${cat.version}` },
    { name: "card.summary mentions per-fix folder / fix-{slug}/", ok: summaryOk },
    { name: "card.paragraph mentions fix-report.html and fix-state.json", ok: paragraphOk },
    { name: "card.extras (any entry) names all three filenames fix-report.html + fix-state.json + fix-wiki.html", ok: extrasNamesAllThree },
    { name: "card.invocations unchanged (still includes /stx-fix interactive)", ok: Array.isArray(card.invocations) && card.invocations.some((i) => i.cmd === "/stx-fix") },
    { name: "npm run check-docs exits 0", ok: checkDocsOk, detail: checkDocsOk ? "" : `stderr: ${checkDocsErr}` },
  ]);
}

/**
 * @task F3-T3
 * Assert: .claude/skills/stx-fix/README.md mentions the new artifacts
 * (docs/waves/fix-{slug}/fix-report.html AND docs/waves/fix-wiki.html) and
 * preserves the existing design-notes sections.
 */
function testF3T3() {
  const path = p(".claude/skills/stx-fix/README.md");
  const md = readIfExists(path);
  if (md === null) return { ok: false, messages: [`✗ F3-T3: ${path} missing`] };
  const existingSections = [
    "## Goals",
    "## Why two agents, not three",
    "## Why an explicit acceptance gate",
    "## Worktree-first",
    "## How this composes with other skills",
  ];
  return asserts("F3-T3 stx-fix/README.md polish", [
    { name: "README mentions docs/waves/fix-{slug}/fix-report.html", ok: /docs\/waves\/fix-\{slug\}\/fix-report\.html/.test(md) },
    { name: "README mentions docs/waves/fix-wiki.html", ok: /docs\/waves\/fix-wiki\.html/.test(md) },
    ...existingSections.map((needle) => ({
      name: `existing section preserved: '${needle}'`,
      ok: md.includes(needle),
    })),
  ]);
}

/**
 * @task F3-T4
 * Assert: running `npm run build` regenerates stx-help/SKILL.md +
 * stx-help-html/help.html + repo-root index.html. After build, the
 * generated outputs must reflect the new stx-fix version (v1.3.x) and the
 * new card.summary text.
 *
 * NOTE on where to look for per-skill version strings: the terminal-listing
 * generator (src/cli/generate-help.ts:renderTerminalListing) emits only the
 * package version on its banner (e.g. "STX Skills · v1.10.1") — per-skill
 * version badges are HTML-card-only (renderCard -> badgeVersion(c.version)).
 * So for the terminal output (stx-help/SKILL.md) we verify the /stx-fix
 * entry is listed at all; the v1.3 propagation is verified against the
 * HTML outputs (help.html + index.html) where the version badge is rendered.
 */
function testF3T4() {
  let buildOk = false;
  let buildErr = "";
  try {
    execSync("npm run build", { cwd: REPO, stdio: "pipe" });
    buildOk = true;
  } catch (e) {
    buildErr = (e.stderr?.toString() || e.stdout?.toString() || e.message).slice(0, 240);
  }
  const stxHelpSkill = readIfExists(p(".claude/skills/stx-help/SKILL.md")) || "";
  const stxHelpHtml = readIfExists(p(".claude/skills/stx-help-html/help.html")) || "";
  const indexHtml = readIfExists(p("index.html")) || "";
  const stxFixListedInTerminal = /\/stx-fix\b/.test(stxHelpSkill);
  const v13InHelpHtml = /1\.3\.\d+|v1\.3/.test(stxHelpHtml);
  const v13InIndex = /1\.3\.\d+|v1\.3/.test(indexHtml);
  const summaryEcho = /per-fix folder|fix-\{slug\}\//.test(stxHelpHtml);
  return asserts("F3-T4 npm run build regenerates help docs", [
    { name: "npm run build exits 0", ok: buildOk, detail: buildOk ? "" : `stderr: ${buildErr}` },
    { name: "stx-help/SKILL.md exists post-build", ok: !!stxHelpSkill },
    { name: "stx-help/SKILL.md terminal listing includes /stx-fix", ok: stxFixListedInTerminal },
    { name: "stx-help-html/help.html exists post-build", ok: !!stxHelpHtml },
    { name: "stx-help-html/help.html shows /stx-fix at v1.3.x", ok: v13InHelpHtml },
    { name: "stx-help-html/help.html surfaces new card.summary text", ok: summaryEcho },
    { name: "repo-root index.html exists post-build", ok: !!indexHtml },
    { name: "repo-root index.html shows /stx-fix at v1.3.x", ok: v13InIndex },
  ]);
}

/**
 * @task F3-T5
 * Assert: `npm run check-docs` exits 0 against the post-build tree.
 */
function testF3T5() {
  let ok = false;
  let err = "";
  try {
    execSync("npm run check-docs", { cwd: REPO, stdio: "pipe" });
    ok = true;
  } catch (e) {
    err = (e.stderr?.toString() || e.stdout?.toString() || e.message).slice(0, 600);
  }
  return asserts("F3-T5 npm run check-docs exits 0", [
    { name: "npm run check-docs exits 0", ok, detail: ok ? "" : `output: ${err}` },
  ]);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TESTS = {
  "F1-T1": testF1T1,
  "F1-T2": testF1T2,
  "F1-T3": testF1T3,
  "F1-T4": testF1T4,
  "F1-T5": testF1T5,
  "F1-T6": testF1T6,
  "F2-T1": testF2T1,
  "F2-T2": testF2T2,
  "F2-T3": testF2T3,
  "F2-T4": testF2T4,
  "F3-T1": testF3T1,
  "F3-T2": testF3T2,
  "F3-T3": testF3T3,
  "F3-T4": testF3T4,
  "F3-T5": testF3T5,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const ids = args.length > 0 ? args : Object.keys(TESTS);
  const unknown = ids.filter((id) => !TESTS[id]);
  if (unknown.length > 0) {
    console.error(`Unknown task id(s): ${unknown.join(", ")}`);
    console.error(`Known: ${Object.keys(TESTS).join(", ")}`);
    process.exit(2);
  }
  let failed = 0;
  for (const id of ids) {
    console.log(`\n--- ${id} -----------------------------------------------`);
    try {
      const result = TESTS[id]();
      for (const m of result.messages) console.log(m);
      if (!result.ok) failed += 1;
    } catch (e) {
      console.log(`✗ ${id}: harness error — ${e.message}`);
      failed += 1;
    }
  }
  console.log("\n=========================================================");
  console.log(failed === 0 ? `All ${ids.length} task(s) PASSED` : `${failed}/${ids.length} task(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
