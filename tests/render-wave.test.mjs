#!/usr/bin/env node
/**
 * ============================================================================
 *  render-wave.test.mjs — deterministic wave-artifact rendering
 * ============================================================================
 *
 *  Covers the guarantee that /stx-feature now rests on: wave-state.json is the
 *  only thing an agent writes, and every HTML artifact is derived from it.
 *
 *  The load-bearing assertion is "no unresolved {{ token survives into a
 *  rendered artifact" — that is what makes it safe to take HTML authorship away
 *  from the agents, because a context/template drift fails loudly here instead
 *  of shipping a page with a blank where a field should be.
 *
 *  Usage:
 *    npm run build && node tests/render-wave.test.mjs
 *
 *  Requires dist/ to be built (the test drives the compiled CLI modules, the
 *  same artifacts the installer vendors into a consuming project).
 * ============================================================================
 */

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const TEMPLATES = join(REPO, '.claude', 'skills', 'stx-feature', 'templates');
const FIXTURE = join(HERE, 'fixtures', 'wave-state.sample.json');

const distPath = join(REPO, 'dist', 'skills', 'stx-feature.js');
if (!existsSync(distPath)) {
  console.error('✗ dist/skills/stx-feature.js not found — run `npm run build` first.');
  process.exit(1);
}

const wave = require(distPath);
const template = require(join(REPO, 'dist', 'lib', 'template.js'));

// ---------------------------------------------------------------------------
// Tiny assertion harness (this repo has no test runner configured)
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${error.message.split('\n').join('\n      ')}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function throws(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

// ---------------------------------------------------------------------------
// Set up a throwaway docs/waves tree holding the fixture wave
// ---------------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'stx-wave-'));
const wavesDir = join(scratch, 'docs', 'waves');
const state = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const waveDir = join(wavesDir, state.wave_id);
mkdirSync(waveDir, { recursive: true });
writeFileSync(join(waveDir, 'wave-state.json'), JSON.stringify(state, null, 2));

console.log(`\nRendering ${state.wave_id} into ${scratch}\n`);

// ---------------------------------------------------------------------------
// §1 Template engine
// ---------------------------------------------------------------------------

console.log('§1 template engine');

check('escapes interpolated values', () => {
  const out = template.renderTemplate('<p>{{v}}</p>', { v: '<script>x</script>' });
  assert(out === '<p>&lt;script&gt;x&lt;/script&gt;</p>', `got ${out}`);
});

check('triple-brace interpolation stays raw', () => {
  const out = template.renderTemplate('{{{v}}}', { v: '<b>hi</b>' });
  assert(out === '<b>hi</b>', `got ${out}`);
});

check('iterates nested each blocks with scalar items', () => {
  const out = template.renderTemplate(
    '{{#each rows}}[{{id}}:{{#each tags}}{{.}},{{/each}}]{{/each}}',
    { rows: [{ id: 'a', tags: ['x', 'y'] }, { id: 'b', tags: [] }] },
  );
  assert(out === '[a:x,y,][b:]', `got ${out}`);
});

check('if blocks skip falsy and empty-array values', () => {
  const src = '{{#if on}}Y{{/if}}{{#if off}}N{{/if}}{{#if empty}}E{{/if}}';
  const out = template.renderTemplate(src, { on: true, off: false, empty: [] });
  assert(out === 'Y', `got ${out}`);
});

check('an unresolved token is an error, not a blank', () => {
  throws(() => template.renderTemplate('{{missing}}', { present: 1 }), 'expected a throw on {{missing}}');
});

check('lookups do not walk up to the enclosing scope', () => {
  // `status` exists on the parent but not on the item — this must fail loudly
  // rather than silently rendering the parent's value.
  throws(
    () => template.renderTemplate('{{#each items}}{{status}}{{/each}}', { status: 'done', items: [{ id: 1 }] }),
    'expected a throw when an item lacks the field',
  );
});

check('an unbalanced block is a parse error', () => {
  throws(() => template.renderTemplate('{{#each a}}x', { a: [] }), 'expected a throw on an unclosed block');
});

// ---------------------------------------------------------------------------
// §2 Validation
// ---------------------------------------------------------------------------

console.log('\n§2 validation');

check('the fixture wave-state is valid', () => {
  const errors = wave.validateWaveState(state);
  assert(errors.length === 0, `expected no errors, got:\n${errors.join('\n')}`);
});

check('a bad task id is rejected', () => {
  const broken = structuredClone(state);
  broken.features[0].tasks[0].id = 'nope';
  const errors = wave.validateWaveState(broken);
  assert(errors.some(e => e.includes('must match F<n>-T<n>')), `got ${JSON.stringify(errors)}`);
});

check('a depends_on pointing at a non-existent task is rejected', () => {
  const broken = structuredClone(state);
  broken.features[0].tasks[1].depends_on = ['F9-T9'];
  const errors = wave.validateWaveState(broken);
  assert(errors.some(e => e.includes('not a task in this wave')), `got ${JSON.stringify(errors)}`);
});

check('a task cannot be both tested and untestable', () => {
  const broken = structuredClone(state);
  broken.features[1].tasks[1].test_path = 'tests/x.spec.ts';
  const errors = wave.validateWaveState(broken);
  assert(errors.some(e => e.includes('either tested or it is not')), `got ${JSON.stringify(errors)}`);
});

check('an unknown tier is rejected', () => {
  const broken = structuredClone(state);
  broken.features[0].tasks[0].tier = 'unknown';
  const errors = wave.validateWaveState(broken);
  assert(errors.some(e => e.includes('.tier')), `got ${JSON.stringify(errors)}`);
});

check('render refuses to write anything from an invalid state', () => {
  const badDir = join(scratch, 'docs', 'waves', 'wave-broken-0000');
  mkdirSync(badDir, { recursive: true });
  const broken = structuredClone(state);
  broken.wave_id = 'wave-broken-0000';
  broken.status = 'not-a-status';
  writeFileSync(join(badDir, 'wave-state.json'), JSON.stringify(broken));
  throws(() => wave.renderWave(badDir, TEMPLATES), 'expected renderWave to throw');
  assert(!existsSync(join(badDir, 'requirement-verse.html')), 'no artifact should have been written');
  rmSync(badDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// §3 Rendering
// ---------------------------------------------------------------------------

console.log('\n§3 rendering');

const { written } = wave.renderWave(waveDir, TEMPLATES);
const read = file => readFileSync(join(waveDir, file), 'utf8');

check('writes all four wave artifacts plus the cross-wave wiki', () => {
  const names = written.map(f => f.split('/').pop()).sort();
  const expected = ['architecture-verse.html', 'qa-verse.html', 'requirement-verse.html', 'result.html', 'wave-wiki.html'];
  assert(JSON.stringify(names) === JSON.stringify(expected), `got ${JSON.stringify(names)}`);
});

check('no rendered artifact contains an unresolved template token', () => {
  // Match the token SHAPE, not a bare "{{": state legitimately contains prose
  // about template syntax, and the renderer escapes it (&#39;{{&#39;), so only
  // a genuine `{{…}}` pair left in the output is a failure.
  const TOKEN = /\{\{[^{}]*\}\}/;
  for (const file of written) {
    const html = readFileSync(file, 'utf8');
    const body = html.slice(html.indexOf('<html'));
    const leftover = body.match(TOKEN);
    assert(!leftover, `${file} still contains ${leftover?.[0]}`);
  }
});

check('the wiki lands one level above the wave directory', () => {
  assert(existsSync(join(wavesDir, 'wave-wiki.html')), 'wave-wiki.html is not in docs/waves/');
  assert(!existsSync(join(waveDir, 'wave-wiki.html')), 'wave-wiki.html leaked into the wave dir');
});

check('requirement-verse carries every acceptance criterion', () => {
  const html = read('requirement-verse.html');
  // The renderer escapes markup, so compare against the escaped form.
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  for (const feature of state.features) {
    for (const criterion of feature.acceptance_criteria) {
      assert(html.includes(`<li>${esc(criterion)}</li>`), `missing criterion "${criterion.slice(0, 40)}…"`);
    }
  }
});

check('requirement-verse escapes markup from the initial request', () => {
  const html = read('requirement-verse.html');
  assert(html.includes('&lt;script&gt;'), 'the <script> in initial_request was not escaped');
  assert(!html.includes('<script>x'), 'raw script tag leaked into the page');
});

check('requirement-verse splits prose into paragraphs', () => {
  const html = read('requirement-verse.html');
  assert(html.includes('<p>The second paragraph'), 'paragraph splitting did not run');
});

check('architecture-verse renders escalations as Revision sections', () => {
  const html = read('architecture-verse.html');
  assert(html.includes('Revision 1 · task F1-T1'), 'the escalation did not become a Revision');
  assert(html.includes('Split the engine'), 'the architect summary is missing');
});

check('architecture-verse shows the frozen out-of-scope list, not the seed', () => {
  const html = read('architecture-verse.html');
  assert(html.includes('Rewriting the shared style block'), 'the Architect addition is missing');
});

check('architecture-verse labels an empty depends_on rather than blanking it', () => {
  const html = read('architecture-verse.html');
  assert(html.includes('<code>—</code>'), 'F1-T1 has no dependencies and should show an em dash');
  assert(html.includes('<code>F1-T1</code>'), 'F1-T2 should list its dependency');
});

check('qa-verse lists tested tasks and the untestable one separately', () => {
  const html = read('qa-verse.html');
  assert(html.includes('tests/render-wave.test.mjs'), 'test path missing');
  assert(html.includes('Manual verification protocol'), 'the unwritable task is missing');
  assert(html.includes('F2-T2'), 'the unwritable task id is missing');
  assert(!html.includes('Every task in this wave has an automated failing test'), 'wrong empty-state branch');
});

check('qa-verse switches to the all-covered message when nothing is unwritable', () => {
  const covered = structuredClone(state);
  delete covered.features[1].tasks[1].test_unwritable;
  covered.features[1].tasks[1].test_path = 'tests/badges.spec.ts';
  covered.features[1].tasks[1].test_kind = 'playwright';
  const ctx = wave.buildQaContext(covered, 'now');
  assert(ctx.no_unwritable === true, 'no_unwritable should be true');
  assert(ctx.test_entries.length === 4, `expected 4 test entries, got ${ctx.test_entries.length}`);
});

check('result.html derives reviewer rejection counts per task', () => {
  const ctx = wave.buildResultContext(state, 'now');
  const tasks = ctx.features.flatMap(f => f.tasks);
  const t1 = tasks.find(t => t.id === 'F1-T1');
  const t2 = tasks.find(t => t.id === 'F1-T2');
  // F1-T1 has one approved=false verdict; F1-T2 has none.
  assert(t1.reviewer_rejection_count === 1, `F1-T1 expected 1, got ${t1.reviewer_rejection_count}`);
  assert(t2.reviewer_rejection_count === 0, `F1-T2 expected 0, got ${t2.reviewer_rejection_count}`);
});

check('result.html derives total iterations and the agent tally', () => {
  const ctx = wave.buildResultContext(state, 'now');
  assert(ctx.TOTAL_ITERATIONS === 4, `expected 4 iterations, got ${ctx.TOTAL_ITERATIONS}`);
  assert(
    ctx.AGENTS_SPAWNED === 'Analyst×1, Architect×2, QA×1, Reviewer×3, Dev×4',
    `got ${ctx.AGENTS_SPAWNED}`,
  );
});

check('result.html renders the gates audit trail', () => {
  const html = read('result.html');
  assert(html.includes('requirement_verse'), 'gate rows are missing');
  assert(html.includes('auto-approved'), 'auto-approved gates are not labelled');
  assert(html.includes('user-approved'), 'user-approved gates are not labelled');
});

check('a concern without a line number renders without a stray colon', () => {
  const html = read('result.html');
  assert(html.includes('src/lib/template.ts:12'), 'the located concern lost its line number');
  assert(!html.includes('template.ts:</code>'), 'a concern rendered a dangling colon');
});

check('every status/tier CSS class used by an artifact exists in _styles.html', () => {
  const styles = readFileSync(join(TEMPLATES, '_styles.html'), 'utf8');
  const used = new Set();
  for (const file of written) {
    const html = readFileSync(file, 'utf8');
    const body = html.slice(html.indexOf('</style>'));
    for (const m of body.matchAll(/class="(?:status|tier) (status-[a-z0-9-]+|tier-[a-z0-9-]+)"/g)) {
      used.add(m[1]);
    }
  }
  assert(used.size > 0, 'no badge classes were found at all — the scan is broken');
  const missing = [...used].filter(cls => !styles.includes(`.${cls} `) && !styles.includes(`.${cls},`));
  assert(missing.length === 0, `no CSS for: ${missing.join(', ')}`);
});

check('rendering is idempotent apart from the timestamp', () => {
  const before = read('result.html');
  wave.renderWave(waveDir, TEMPLATES);
  const after = read('result.html');
  const strip = s => s.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'TIMESTAMP');
  assert(strip(before) === strip(after), 'a second render produced different output');
});

check('--only wiki rebuilds just the index', () => {
  const result = wave.renderWave(waveDir, TEMPLATES, ['wiki']);
  assert(result.written.length === 1, `expected 1 file, got ${result.written.length}`);
  assert(result.written[0].endsWith('wave-wiki.html'), `got ${result.written[0]}`);
});

check('a planning-stage wave skips artifacts with no state behind them', () => {
  const early = structuredClone(state);
  early.wave_id = 'wave-early-0001';
  early.status = 'gate-1';
  early.finished_at = null;
  // Features exist, tasks do not yet — so neither do the logs that reference them.
  for (const f of early.features) f.tasks = [];
  early.reviewer_verdicts = [];
  early.suspicious = [];
  early.escalations = [];
  const earlyDir = join(wavesDir, early.wave_id);
  mkdirSync(earlyDir, { recursive: true });
  writeFileSync(join(earlyDir, 'wave-state.json'), JSON.stringify(early));

  const result = wave.renderWave(earlyDir, TEMPLATES);
  const names = result.written.map(f => f.split('/').pop());
  assert(names.includes('requirement-verse.html'), 'requirement-verse should render at gate-1');
  assert(!names.includes('architecture-verse.html'), 'architecture-verse rendered with no tasks');
  assert(!names.includes('result.html'), 'result.html rendered before the wave finished');
  assert(result.skipped.includes('architecture'), 'architecture should be reported as skipped');
});

check('the wiki aggregates every wave directory, newest first', () => {
  wave.renderWave(waveDir, TEMPLATES, ['wiki']);
  const html = readFileSync(join(wavesDir, 'wave-wiki.html'), 'utf8');
  assert(html.includes('wave-sample-render-a1b2'), 'the sample wave is missing');
  assert(html.includes('wave-early-0001'), 'the second wave is missing');
  const ctx = wave.buildWikiContext(wavesDir, 'now');
  assert(ctx.WAVE_COUNT === 2, `expected 2 waves, got ${ctx.WAVE_COUNT}`);
  assert(ctx.DONE_COUNT === 1, `expected 1 done, got ${ctx.DONE_COUNT}`);
  assert(ctx.ACTIVE_COUNT === 1, `expected 1 active, got ${ctx.ACTIVE_COUNT}`);
});

// ---------------------------------------------------------------------------
// §4 Briefs
// ---------------------------------------------------------------------------

console.log('\n§4 briefs');

const fullStateBytes = JSON.stringify(state).length;

check('the architect brief carries features but none of the running logs', () => {
  const brief = wave.buildBrief(state, 'architect');
  assert(brief.features.length === 2, `expected 2 features, got ${brief.features.length}`);
  assert(brief.features[0].acceptance_criteria.length === 3, 'acceptance criteria are missing');
  const json = JSON.stringify(brief);
  assert(!json.includes('reviewer_verdicts'), 'the reviewer log leaked into the architect brief');
  assert(!json.includes('suspicious'), 'the suspicious log leaked into the architect brief');
  assert(!json.includes('scope_paths'), 'tasks leaked into the architect brief');
  assert(json.length < fullStateBytes / 2, `brief is ${json.length}B vs ${fullStateBytes}B of state`);
});

check('the qa brief carries tasks and acceptance hints, not reviewer history', () => {
  const brief = wave.buildBrief(state, 'qa');
  const tasks = brief.features.flatMap(f => f.tasks);
  assert(tasks.length === 4, `expected 4 tasks, got ${tasks.length}`);
  assert(tasks[0].acceptance_test_hint.length > 0, 'acceptance hint is missing');
  assert(!JSON.stringify(brief).includes('reviewer_verdicts'), 'the reviewer log leaked into the qa brief');
});

check('a dev brief is scoped to one task plus its prior verdicts', () => {
  const brief = wave.buildBrief(state, 'dev', 'F1-T1');
  assert(brief.task.id === 'F1-T1', `got ${brief.task.id}`);
  assert(brief.feature.id === 'F1', `got ${brief.feature.id}`);
  assert(brief.prior_reviewer_verdicts.length === 2, `expected 2 verdicts, got ${brief.prior_reviewer_verdicts.length}`);
  assert(brief.out_of_scope_frozen.length === 3, 'the frozen out-of-scope list is missing');
  assert(!JSON.stringify(brief).includes('F2-T1'), 'another feature\'s tasks leaked in');
});

check('a dev brief without a task id is refused', () => {
  throws(() => wave.buildBrief(state, 'dev'), 'expected a throw when --task is missing');
  throws(() => wave.buildBrief(state, 'reviewer', 'F9-T9'), 'expected a throw for an unknown task');
});

// ---------------------------------------------------------------------------
// §5 Codebase map
// ---------------------------------------------------------------------------

console.log('\n§5 codebase map');

check('the map indexes this repo without walking into node_modules', () => {
  const map = wave.buildCodebaseMap(REPO);
  assert(map.includes('# Codebase map'), 'missing title');
  assert(map.includes('stx-skills'), 'package name missing');
  assert(map.includes('src/lib/template.ts'), 'the new engine is not indexed');
  assert(map.includes('renderTemplate'), 'exported symbols are not indexed');
  assert(!map.includes('node_modules'), 'node_modules leaked into the map');
});

check('the map reports empty sections instead of failing on a bare directory', () => {
  const bare = mkdtempSync(join(tmpdir(), 'stx-bare-'));
  writeFileSync(join(bare, 'main.py'), 'print("no package.json here")\n');
  const map = wave.buildCodebaseMap(bare);
  assert(map.includes('_None found._'), 'expected an empty-section marker');
  assert(map.includes('## Components'), 'sections should still be present');
  rmSync(bare, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

rmSync(scratch, { recursive: true, force: true });

console.log(`\n${failures.length === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
