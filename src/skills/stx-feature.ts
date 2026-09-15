#!/usr/bin/env node

/**
 * stx-feature — wave CLI for the /stx-feature skill.
 *
 * The skill's stated model has always been "JSON is canonical, HTML is
 * presentation" — but until this CLI existed, the model was what rendered the
 * HTML, so the principle was asserted rather than enforced. This command makes
 * it true: agents write `wave-state.json` and nothing else, and every artifact
 * is produced here, deterministically.
 *
 *   validate <wave-dir>   Check wave-state.json against what the renderer needs.
 *   render   <wave-dir>   Render the wave's HTML artifacts + the cross-wave wiki.
 *   map                   Build codebase-map.md once per wave, before any spawn.
 *   brief    <wave-dir>   Emit the minimum slice of state one agent role needs.
 *
 * `map` and `brief` exist for the same reason as `render`: work every agent was
 * repeating (re-walking the repo; re-reading a rendered artifact on top of the
 * JSON it came from) is done once, by a script, and handed over as a small file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { renderTemplate, paragraphsToHtml, TemplateError } from '../lib/template';

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
// wave-state.json shape (mirrors templates/wave-state.schema.json)
// =============================================================================

interface Task {
  id: string;
  title: string;
  tier: string;
  scope_paths: string[];
  depends_on: string[];
  acceptance_test_hint?: string;
  existing_patterns_to_follow?: string[];
  test_path?: string | null;
  test_kind?: string | null;
  coverage_summary?: string;
  failure_output?: string;
  test_unwritable?: { reason: string; manual_protocol: string };
  status: string;
  iterations_used?: number;
  notes?: string;
}

interface Feature {
  id: string;
  title: string;
  actor: string;
  acceptance_criteria: string[];
  existing_system_impact?: string;
  out_of_scope?: string[];
  status: string;
  tasks: Task[];
}

interface Concern {
  kind: string;
  file?: string;
  line?: number;
  summary: string;
  severity: string;
}

interface ReviewerVerdict {
  task_id: string;
  iteration: number;
  at: string;
  approved: boolean;
  verdict: string;
  concerns?: Concern[];
  suggested_revisions?: string[];
}

interface Escalation {
  n: number;
  task_id: string;
  at: string;
  trigger: string;
  architect_summary?: string;
}

interface Suspicious {
  at: string;
  task_id: string;
  dev_id?: string;
  kind: string;
  description: string;
  resolution: string;
}

interface Gate {
  gate: string;
  auto_approved: boolean;
  approved_at: string;
  reason?: string;
}

interface WaveState {
  wave_id: string;
  wave_slug: string;
  started_at?: string;
  finished_at?: string | null;
  status: string;
  initial_request: string;
  worktree_path?: string;
  branch?: string;
  main_worktree_path?: string;
  config: Record<string, unknown>;
  gates?: Gate[];
  out_of_scope_seed?: string[];
  out_of_scope?: string[];
  vitest_installed?: string;
  next_action?: string;
  features: Feature[];
  suspicious?: Suspicious[];
  escalations?: Escalation[];
  reviewer_verdicts?: ReviewerVerdict[];
  files_touched?: { path: string; add: number; del: number }[];
  agents_spawned?: Record<string, number>;
  persona_versions?: Record<string, string>;
}

// =============================================================================
// Validation
//
// Deliberately hand-rolled: this package ships with only typescript and
// @types/node, and pulling a JSON-Schema runtime into an installed skill dir
// for ~90 lines of checks is a worse trade than writing the checks. It covers
// exactly what the renderer dereferences, which is the failure that matters —
// a malformed state should be rejected here, with a field path, rather than
// surfacing as a TemplateError halfway through writing an artifact.
// =============================================================================

const WAVE_STATUSES = ['planning', 'gate-1', 'gate-2', 'gate-3', 'dev-wave', 'done', 'halted-at-cap', 'blocked'];
const FEATURE_STATUSES = ['todo', 'in-progress', 'done', 'halted'];
const TASK_STATUSES = ['todo', 'in-progress', 'done', 'halted', 'skipped', 'paused'];
const TIERS = ['db', 'service', 'api', 'ui'];
const TEST_KINDS = ['playwright', 'e2e', 'vitest-unit'];
const VERDICTS = ['approved', 'concerns', 'test-file-edit-detected', 'assertion-weakened', 'sut-mocked'];
const SUSPICIOUS_KINDS = ['scope-drift', 'test-file-touch', 'mock-of-sut', 'build-break', 'out-of-scope'];
const RESOLUTIONS = ['resolved', 'accepted', 'open', 'halted'];
const TRIGGERS = ['soft-cap-hit', 'suspicious-ceiling', 'qa-pause', 'reviewer-halt'];

export function validateWaveState(state: WaveState): string[] {
  const errors: string[] = [];
  const fail = (where: string, what: string) => errors.push(`${where}: ${what}`);

  const str = (where: string, value: unknown) => {
    if (typeof value !== 'string' || value.length === 0) fail(where, 'must be a non-empty string');
  };
  const arr = (where: string, value: unknown) => {
    if (!Array.isArray(value)) fail(where, 'must be an array');
  };
  const oneOf = (where: string, value: unknown, allowed: string[]) => {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      fail(where, `must be one of ${allowed.join(' | ')} (got ${JSON.stringify(value)})`);
    }
  };

  if (!/^wave-[a-z0-9-]+-[a-z0-9]{4}$/.test(state.wave_id ?? '')) {
    fail('wave_id', 'must match wave-<slug>-<4 chars>');
  }
  if (!/^[a-z0-9-]+$/.test(state.wave_slug ?? '')) fail('wave_slug', 'must be kebab-case');
  oneOf('status', state.status, WAVE_STATUSES);
  str('initial_request', state.initial_request);
  if (typeof state.config !== 'object' || state.config === null) fail('config', 'must be an object');
  arr('features', state.features);
  if (!Array.isArray(state.features)) return errors;

  const taskIds = new Set<string>();
  for (const f of state.features) {
    for (const t of f.tasks ?? []) if (t && typeof t.id === 'string') taskIds.add(t.id);
  }

  state.features.forEach((f, i) => {
    const at = `features[${i}]`;
    if (!/^F[0-9]+$/.test(f.id ?? '')) fail(`${at}.id`, 'must match F<n>');
    str(`${at}.title`, f.title);
    str(`${at}.actor`, f.actor);
    arr(`${at}.acceptance_criteria`, f.acceptance_criteria);
    oneOf(`${at}.status`, f.status, FEATURE_STATUSES);
    arr(`${at}.tasks`, f.tasks);
    if (!Array.isArray(f.tasks)) return;

    f.tasks.forEach((t, j) => {
      const ta = `${at}.tasks[${j}]`;
      if (!/^F[0-9]+-T[0-9]+$/.test(t.id ?? '')) fail(`${ta}.id`, 'must match F<n>-T<n>');
      else if (!t.id.startsWith(`${f.id}-`)) fail(`${ta}.id`, `belongs to ${f.id} but is named ${t.id}`);
      str(`${ta}.title`, t.title);
      oneOf(`${ta}.tier`, t.tier, TIERS);
      arr(`${ta}.scope_paths`, t.scope_paths);
      arr(`${ta}.depends_on`, t.depends_on);
      oneOf(`${ta}.status`, t.status, TASK_STATUSES);
      if (t.test_kind != null) oneOf(`${ta}.test_kind`, t.test_kind, TEST_KINDS);
      for (const dep of t.depends_on ?? []) {
        if (!taskIds.has(dep)) fail(`${ta}.depends_on`, `"${dep}" is not a task in this wave`);
        if (dep === t.id) fail(`${ta}.depends_on`, 'a task cannot depend on itself');
      }
      if (t.test_unwritable && t.test_path) {
        fail(`${ta}`, 'has both test_path and test_unwritable — a task is either tested or it is not');
      }
    });
  });

  (state.reviewer_verdicts ?? []).forEach((v, i) => {
    const at = `reviewer_verdicts[${i}]`;
    if (!taskIds.has(v.task_id)) fail(`${at}.task_id`, `"${v.task_id}" is not a task in this wave`);
    if (typeof v.approved !== 'boolean') fail(`${at}.approved`, 'must be a boolean');
    oneOf(`${at}.verdict`, v.verdict, VERDICTS);
    str(`${at}.at`, v.at);
  });

  (state.suspicious ?? []).forEach((s, i) => {
    const at = `suspicious[${i}]`;
    oneOf(`${at}.kind`, s.kind, SUSPICIOUS_KINDS);
    oneOf(`${at}.resolution`, s.resolution, RESOLUTIONS);
    str(`${at}.description`, s.description);
  });

  (state.escalations ?? []).forEach((e, i) => {
    const at = `escalations[${i}]`;
    oneOf(`${at}.trigger`, e.trigger, TRIGGERS);
    if (typeof e.n !== 'number') fail(`${at}.n`, 'must be a number');
    str(`${at}.at`, e.at);
  });

  return errors;
}

// =============================================================================
// Context builders
//
// Every value a template dereferences is produced here — the engine does not
// walk up scopes and does not silently blank a missing field, so anything a
// template names must be materialised, with an explicit default where state
// legitimately has nothing to say.
// =============================================================================

const EM_DASH = '—';

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(v => String(v)) : [];
}

export function buildRequirementContext(state: WaveState, generatedAt: string): Record<string, unknown> {
  return {
    WAVE_ID: state.wave_id,
    WAVE_SLUG: state.wave_slug,
    GENERATED_AT: generatedAt,
    INITIAL_REQUEST_HTML: paragraphsToHtml(state.initial_request),
    out_of_scope_seed: list(state.out_of_scope_seed ?? state.out_of_scope),
    features: state.features.map(f => ({
      id: f.id,
      title: f.title,
      status: f.status,
      actor: f.actor,
      acceptance_criteria: list(f.acceptance_criteria),
      existing_system_impact_html: paragraphsToHtml(
        text(f.existing_system_impact, 'No existing-system impact recorded.'),
      ),
      out_of_scope: list(f.out_of_scope),
    })),
  };
}

export function buildArchitectureContext(state: WaveState, generatedAt: string): Record<string, unknown> {
  return {
    WAVE_ID: state.wave_id,
    WAVE_SLUG: state.wave_slug,
    GENERATED_AT: generatedAt,
    out_of_scope_frozen: list(state.out_of_scope ?? state.out_of_scope_seed),
    features: state.features.map(f => ({
      id: f.id,
      title: f.title,
      tasks: f.tasks.map(t => ({
        id: t.id,
        title: t.title,
        tier: t.tier,
        depends_on_label: t.depends_on.length > 0 ? t.depends_on.join(', ') : EM_DASH,
        scope_paths: list(t.scope_paths),
        acceptance_test_hint: text(t.acceptance_test_hint, 'Not yet specified.'),
        existing_patterns_to_follow: list(t.existing_patterns_to_follow),
      })),
    })),
    // Revisions are derived, never stored: the Architect appends an escalation
    // and the Revision section follows, so the original task block above can
    // never be overwritten by a re-engagement.
    revisions: (state.escalations ?? []).map(e => ({
      n: e.n,
      task_id: e.task_id,
      at: e.at,
      reason: e.trigger,
      amendment: text(e.architect_summary, 'No amendment recorded.'),
    })),
  };
}

export function buildQaContext(state: WaveState, generatedAt: string): Record<string, unknown> {
  const testEntries: Record<string, unknown>[] = [];
  const unwritable: Record<string, unknown>[] = [];

  for (const f of state.features) {
    for (const t of f.tasks) {
      if (t.test_unwritable) {
        unwritable.push({
          task_id: t.id,
          reason: t.test_unwritable.reason,
          manual_protocol: t.test_unwritable.manual_protocol,
        });
        continue;
      }
      if (!t.test_path) continue;
      testEntries.push({
        task_id: t.id,
        feature_id: f.id,
        test_kind: text(t.test_kind, 'e2e'),
        test_path: t.test_path,
        coverage_summary: text(t.coverage_summary, 'No coverage summary recorded.'),
        failure_output: text(t.failure_output, 'No failing-run output recorded.'),
      });
    }
  }

  return {
    WAVE_ID: state.wave_id,
    WAVE_SLUG: state.wave_slug,
    GENERATED_AT: generatedAt,
    VITEST_INSTALLED: text(state.vitest_installed, 'not-needed'),
    test_entries: testEntries,
    unwritable,
    has_unwritable: unwritable.length > 0,
    no_unwritable: unwritable.length === 0,
  };
}

const AGENT_LABELS: Record<string, string> = {
  analyst: 'Analyst',
  architect: 'Architect',
  qa: 'QA',
  reviewer: 'Reviewer',
  dev: 'Dev',
};

function formatAgentsSpawned(counts: Record<string, number> | undefined): string {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => typeof n === 'number' && n > 0);
  if (entries.length === 0) return EM_DASH;
  return entries.map(([role, n]) => `${AGENT_LABELS[role] ?? role}×${n}`).join(', ');
}

export function buildResultContext(state: WaveState, generatedAt: string): Record<string, unknown> {
  const rejectionsByTask = new Map<string, number>();
  for (const v of state.reviewer_verdicts ?? []) {
    if (!v.approved) rejectionsByTask.set(v.task_id, (rejectionsByTask.get(v.task_id) ?? 0) + 1);
  }

  let totalIterations = 0;
  for (const f of state.features) for (const t of f.tasks) totalIterations += t.iterations_used ?? 0;

  return {
    WAVE_ID: state.wave_id,
    WAVE_SLUG: state.wave_slug,
    GENERATED_AT: generatedAt,
    STARTED_AT: text(state.started_at, EM_DASH),
    FINISHED_AT: text(state.finished_at, EM_DASH),
    STATUS: state.status,
    TOTAL_ITERATIONS: totalIterations,
    AGENTS_SPAWNED: formatAgentsSpawned(state.agents_spawned),
    COMMIT_POLICY: text(state.config?.commit_policy as string, 'no-commit'),
    NEXT_ACTION: text(state.next_action, 'Review the artifacts, then run /stx-checkin or /stx-pr-merge to ship.'),
    gates: (state.gates ?? []).map(g => ({
      gate: g.gate,
      approval_label: g.auto_approved ? 'auto-approved' : 'user-approved',
      approval_class: g.auto_approved ? 'auto-approved' : 'user-approved',
      approved_at: g.approved_at,
      reason: text(g.reason, EM_DASH),
    })),
    features: state.features.map(f => ({
      id: f.id,
      title: f.title,
      status: f.status,
      tasks: f.tasks.map(t => ({
        id: t.id,
        title: t.title,
        tier: t.tier,
        iterations_used: t.iterations_used ?? 0,
        reviewer_rejection_count: rejectionsByTask.get(t.id) ?? 0,
        status: t.status,
        notes: text(t.notes, EM_DASH),
      })),
    })),
    reviewer_verdicts: (state.reviewer_verdicts ?? []).map(v => ({
      task_id: v.task_id,
      iteration: v.iteration,
      at: v.at,
      approved: v.approved,
      verdict: v.verdict,
      concerns: (v.concerns ?? []).map(concern => ({
        kind: concern.kind,
        severity: concern.severity,
        summary: concern.summary,
        file: text(concern.file),
        line_suffix: typeof concern.line === 'number' ? `:${concern.line}` : '',
      })),
      suggested_revisions: list(v.suggested_revisions),
    })),
    suspicious: (state.suspicious ?? []).map(s => ({
      at: s.at,
      task_id: s.task_id,
      kind: s.kind,
      description: s.description,
      resolution: s.resolution,
    })),
    escalations: (state.escalations ?? []).map(e => ({
      n: e.n,
      at: e.at,
      task_id: e.task_id,
      trigger: e.trigger,
      architect_summary: text(e.architect_summary, EM_DASH),
    })),
    files_touched: (state.files_touched ?? []).map(f => ({
      path: f.path,
      add: f.add,
      del: f.del,
    })),
  };
}

const ACTIVE_STATUSES = ['planning', 'gate-1', 'gate-2', 'gate-3', 'dev-wave'];
const HALTED_STATUSES = ['halted-at-cap', 'blocked'];

export function buildWikiContext(wavesDir: string, generatedAt: string): Record<string, unknown> {
  const rows: Record<string, unknown>[] = [];

  const entries = fs.existsSync(wavesDir) ? fs.readdirSync(wavesDir) : [];
  for (const entry of entries.filter(e => e.startsWith('wave-')).sort()) {
    const statePath = path.join(wavesDir, entry, 'wave-state.json');
    if (!fs.existsSync(statePath)) continue;

    let state: WaveState;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as WaveState;
    } catch {
      console.log(c.warn(`  ⚠ ${entry}/wave-state.json is not valid JSON — skipped in the wiki`));
      continue;
    }

    const features = Array.isArray(state.features) ? state.features : [];
    const waveId = text(state.wave_id, entry);
    const resultExists = fs.existsSync(path.join(wavesDir, entry, 'result.html'));
    const request = text(state.initial_request);

    rows.push({
      wave_id: waveId,
      wave_slug: text(state.wave_slug, waveId),
      status: text(state.status, 'planning'),
      started_at: text(state.started_at, EM_DASH),
      finished_at: text(state.finished_at, EM_DASH),
      initial_request_short: request.length > 140 ? `${request.slice(0, 137)}…` : request || EM_DASH,
      features_done: features.filter(f => f.status === 'done').length,
      features_total: features.length,
      link: resultExists ? `./${waveId}/result.html` : `./${waveId}/`,
      _sort: text(state.started_at, ''),
    });
  }

  rows.sort((a, b) => String(b._sort).localeCompare(String(a._sort)));
  for (const row of rows) delete row._sort;

  const statusOf = (row: Record<string, unknown>) => String(row.status);
  return {
    GENERATED_AT: generatedAt,
    WAVE_COUNT: rows.length,
    DONE_COUNT: rows.filter(r => statusOf(r) === 'done').length,
    ACTIVE_COUNT: rows.filter(r => ACTIVE_STATUSES.includes(statusOf(r))).length,
    HALTED_COUNT: rows.filter(r => HALTED_STATUSES.includes(statusOf(r))).length,
    waves: rows,
  };
}

// =============================================================================
// Rendering
// =============================================================================

const ARTIFACTS = ['requirement', 'architecture', 'qa', 'result', 'wiki'] as const;
type Artifact = (typeof ARTIFACTS)[number];

const TEMPLATE_FILES: Record<Artifact, string> = {
  requirement: 'requirement-verse.html',
  architecture: 'architecture-verse.html',
  qa: 'qa-verse.html',
  result: 'result.html',
  wiki: 'wave-wiki.html',
};

/** Templates ship next to the compiled script in an installed skill dir, and
 *  under .claude/skills/stx-feature/templates/ when running from the repo. */
function resolveTemplatesDir(explicit?: string): string {
  const candidates = [
    explicit,
    path.join(__dirname, 'templates'),
    path.join(__dirname, '..', '..', '.claude', 'skills', 'stx-feature', 'templates'),
    path.join(process.cwd(), '.claude', 'skills', 'stx-feature', 'templates'),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, '_styles.html'))) return dir;
  }
  throw new Error(
    `Could not find the bundled templates. Looked in:\n${candidates.map(p => `  ${p}`).join('\n')}\n` +
      'Pass --templates <dir> to point at them explicitly.',
  );
}

function readTemplate(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

/** The style block is injected raw, so its CSS braces are never parsed. */
function readStyles(dir: string): string {
  return readTemplate(dir, '_styles.html').replace(/^<!--[\s\S]*?-->\s*/, '');
}

/** Which artifacts have enough state behind them to be worth rendering. */
function renderableArtifacts(state: WaveState): Artifact[] {
  const out: Artifact[] = [];
  if (state.features.length > 0) out.push('requirement');
  if (state.features.some(f => f.tasks.length > 0)) out.push('architecture');
  if (state.features.some(f => f.tasks.some(t => t.test_path || t.test_unwritable))) out.push('qa');
  if (['done', 'halted-at-cap', 'blocked'].includes(state.status) || state.finished_at) out.push('result');
  return out;
}

interface RenderResult {
  written: string[];
  skipped: Artifact[];
}

export function renderWave(waveDir: string, templatesDir: string, only?: Artifact[]): RenderResult {
  const statePath = path.join(waveDir, 'wave-state.json');
  if (!fs.existsSync(statePath)) throw new Error(`No wave-state.json in ${waveDir}`);

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as WaveState;
  const errors = validateWaveState(state);
  if (errors.length > 0) {
    throw new Error(`wave-state.json is invalid:\n${errors.map(e => `  • ${e}`).join('\n')}`);
  }

  const generatedAt = new Date().toISOString();
  const styles = readStyles(templatesDir);
  const wavesDir = path.dirname(path.resolve(waveDir));

  const eligible = renderableArtifacts(state);
  // With no --only, consider every artifact and report the ones the wave has no
  // state for yet, so a mid-wave render says what it did not write and why.
  const wanted: Artifact[] = only ?? [...ARTIFACTS];
  const written: string[] = [];
  const skipped: Artifact[] = [];

  const builders: Record<Artifact, () => Record<string, unknown>> = {
    requirement: () => buildRequirementContext(state, generatedAt),
    architecture: () => buildArchitectureContext(state, generatedAt),
    qa: () => buildQaContext(state, generatedAt),
    result: () => buildResultContext(state, generatedAt),
    wiki: () => buildWikiContext(wavesDir, generatedAt),
  };

  for (const artifact of wanted) {
    if (artifact !== 'wiki' && !eligible.includes(artifact)) {
      skipped.push(artifact);
      continue;
    }
    const file = TEMPLATE_FILES[artifact];
    const context = { ...builders[artifact](), INLINE_STYLES: styles };
    const html = renderTemplate(readTemplate(templatesDir, file), context, { name: file });
    const dest = artifact === 'wiki' ? path.join(wavesDir, file) : path.join(waveDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, html, 'utf8');
    written.push(dest);
  }

  return { written, skipped };
}

// =============================================================================
// Briefs — the minimum slice of state one agent role needs
//
// Handing the Architect requirement-verse.html *and* the wave-state.json it was
// rendered from is the same data twice, and the HTML is the larger copy. A brief
// is the small half, with the running logs (reviewer verdicts, suspicious
// events) left out of every role that has no use for them.
// =============================================================================

const ROLES = ['analyst', 'architect', 'qa', 'reviewer', 'dev'] as const;
type Role = (typeof ROLES)[number];

function findTask(state: WaveState, taskId: string): { feature: Feature; task: Task } {
  for (const feature of state.features) {
    for (const task of feature.tasks) {
      if (task.id === taskId) return { feature, task };
    }
  }
  throw new Error(`Task "${taskId}" is not in this wave.`);
}

export function buildBrief(state: WaveState, role: Role, taskId?: string): Record<string, unknown> {
  const head = {
    wave_id: state.wave_id,
    wave_slug: state.wave_slug,
    branch: text(state.branch, EM_DASH),
    worktree_path: text(state.worktree_path, EM_DASH),
  };

  if (role === 'analyst') {
    return {
      ...head,
      role,
      initial_request: state.initial_request,
      out_of_scope_seed: list(state.out_of_scope_seed ?? state.out_of_scope),
    };
  }

  if (role === 'architect') {
    return {
      ...head,
      role,
      initial_request: state.initial_request,
      out_of_scope: list(state.out_of_scope ?? state.out_of_scope_seed),
      features: state.features.map(f => ({
        id: f.id,
        title: f.title,
        actor: f.actor,
        acceptance_criteria: list(f.acceptance_criteria),
        existing_system_impact: text(f.existing_system_impact),
        out_of_scope: list(f.out_of_scope),
      })),
    };
  }

  if (role === 'qa') {
    return {
      ...head,
      role,
      out_of_scope: list(state.out_of_scope ?? state.out_of_scope_seed),
      vitest_install_allowed: Boolean(state.config?.vitest_install_allowed),
      features: state.features.map(f => ({
        id: f.id,
        title: f.title,
        acceptance_criteria: list(f.acceptance_criteria),
        tasks: f.tasks.map(t => ({
          id: t.id,
          title: t.title,
          tier: t.tier,
          scope_paths: list(t.scope_paths),
          acceptance_test_hint: text(t.acceptance_test_hint),
        })),
      })),
    };
  }

  // reviewer / dev — one task, plus only the context needed to judge it.
  if (!taskId) throw new Error(`--for ${role} needs --task <id>`);
  const { feature, task } = findTask(state, taskId);
  const verdicts = (state.reviewer_verdicts ?? []).filter(v => v.task_id === taskId);

  return {
    ...head,
    role,
    out_of_scope_frozen: list(state.out_of_scope ?? state.out_of_scope_seed),
    feature: {
      id: feature.id,
      title: feature.title,
      acceptance_criteria: list(feature.acceptance_criteria),
    },
    task: {
      id: task.id,
      title: task.title,
      tier: task.tier,
      scope_paths: list(task.scope_paths),
      depends_on: list(task.depends_on),
      acceptance_test_hint: text(task.acceptance_test_hint),
      existing_patterns_to_follow: list(task.existing_patterns_to_follow),
      test_path: task.test_path ?? null,
      test_kind: task.test_kind ?? null,
      iterations_used: task.iterations_used ?? 0,
      status: task.status,
    },
    prior_reviewer_verdicts: verdicts,
    caps: {
      soft_cap: state.config?.soft_cap ?? 3,
      hard_cap: state.config?.hard_cap ?? 5,
      suspicious_ceiling: state.config?.suspicious_ceiling ?? 3,
    },
  };
}

// =============================================================================
// Codebase map — built once per wave, before any agent spawns
//
// Every agent otherwise re-walks components/, app/ and the service tree to cite
// real patterns with real line numbers. The map is that walk, done once, cheaply,
// and handed to all of them. It names files and exported symbols rather than
// summarising them: an agent still opens what it needs, it just no longer has to
// discover what exists.
// =============================================================================

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage',
  '.turbo', '.cache', '.vercel', 'vendor', '__pycache__', '.venv',
]);

function walkFiles(root: string, dir: string, depth: number, out: string[], maxDepth = 8): void {
  if (depth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(root, full, depth + 1, out, maxDepth);
    else out.push(path.relative(root, full));
  }
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function directoryTree(root: string, maxDepth: number): string[] {
  const lines: string[] = [];
  const walk = (dir: string, prefix: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs = entries
      .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && (!e.name.startsWith('.') || e.name === '.claude'))
      .sort((a, b) => a.name.localeCompare(b.name));
    const fileCount = entries.filter(e => e.isFile()).length;
    for (const d of dirs) {
      const child = path.join(dir, d.name);
      let childFiles = 0;
      try {
        childFiles = fs.readdirSync(child, { withFileTypes: true }).filter(e => e.isFile()).length;
      } catch {
        /* unreadable — report it as empty rather than failing the map */
      }
      lines.push(`${prefix}${d.name}/${childFiles > 0 ? `  (${plural(childFiles, 'file')})` : ''}`);
      walk(child, `${prefix}  `, depth + 1);
    }
    if (prefix === '' && fileCount > 0) lines.push(`(${plural(fileCount, 'file')} at repo root)`);
  };
  walk(root, '', 1);
  return lines;
}

const EXPORT_RE = /^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm;

function exportedSymbols(file: string): string[] {
  let source: string;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const names = new Set<string>();
  EXPORT_RE.lastIndex = 0;
  for (let m = EXPORT_RE.exec(source); m !== null; m = EXPORT_RE.exec(source)) names.add(m[1]);
  return [...names];
}

function headings(file: string, limit = 25): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => /^#{1,3}\s+\S/.test(l))
    .slice(0, limit)
    .map(l => l.trim());
}

function section(title: string, body: string[]): string {
  if (body.length === 0) return `## ${title}\n\n_None found._\n`;
  return `## ${title}\n\n${body.join('\n')}\n`;
}

export function buildCodebaseMap(root: string): string {
  const all: string[] = [];
  walkFiles(root, root, 1, all);

  const codeExts = /\.(tsx?|jsx?|mjs|cjs)$/;
  const isUnder = (rel: string, ...dirs: string[]) =>
    dirs.some(d => rel === d || rel.startsWith(`${d}/`));

  // --- package.json -----------------------------------------------------
  const pkgPath = path.join(root, 'package.json');
  const pkg = fs.existsSync(pkgPath)
    ? (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, any>)
    : {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const frameworks = ['next', 'react', 'vue', 'svelte', 'express', 'fastify', '@supabase/supabase-js',
    'firebase', 'firebase-admin', 'prisma', 'drizzle-orm', 'tailwindcss', 'vitest', 'jest',
    '@playwright/test', 'typescript']
    .filter(d => d in deps)
    .map(d => `${d}@${deps[d]}`);

  const meta = [
    `- **Package:** \`${pkg.name ?? path.basename(root)}\`${pkg.version ? ` v${pkg.version}` : ''}`,
    `- **Detected stack:** ${frameworks.length > 0 ? frameworks.join(', ') : 'none detected'}`,
    `- **Scripts:** ${Object.keys(pkg.scripts ?? {}).map(s => `\`${s}\``).join(', ') || 'none'}`,
    `- **Files scanned:** ${all.length}`,
  ];

  // --- components -------------------------------------------------------
  const componentFiles = all
    .filter(f => codeExts.test(f) && isUnder(f, 'components', 'src/components', 'app/components'))
    .sort();
  const components = componentFiles.slice(0, 250).map(f => {
    const symbols = exportedSymbols(path.join(root, f));
    return `- \`${f}\`${symbols.length > 0 ? ` — ${symbols.slice(0, 8).join(', ')}` : ''}`;
  });
  if (componentFiles.length > 250) components.push(`- _…and ${componentFiles.length - 250} more_`);

  // --- routes -----------------------------------------------------------
  const routes = all
    .filter(f => /(^|\/)(page|route|layout|template|loading|error)\.(tsx?|jsx?)$/.test(f) && isUnder(f, 'app', 'src/app'))
    .concat(all.filter(f => codeExts.test(f) && isUnder(f, 'pages', 'src/pages')))
    .sort()
    .slice(0, 250)
    .map(f => `- \`${f}\``);

  // --- services / lib ---------------------------------------------------
  const serviceFiles = all
    .filter(f => codeExts.test(f) && isUnder(f, 'lib', 'src/lib', 'services', 'src/services', 'server', 'src/server'))
    .sort();
  const services = serviceFiles.slice(0, 250).map(f => {
    const symbols = exportedSymbols(path.join(root, f));
    return `- \`${f}\`${symbols.length > 0 ? ` — ${symbols.slice(0, 8).join(', ')}` : ''}`;
  });
  if (serviceFiles.length > 250) services.push(`- _…and ${serviceFiles.length - 250} more_`);

  // --- tests ------------------------------------------------------------
  const testFiles = all.filter(
    f => /\.(test|spec)\.(tsx?|jsx?|mjs)$/.test(f) || isUnder(f, 'tests', 'e2e', 'playwright-tests', '__tests__'),
  );
  const runnerConfigs = all.filter(f =>
    /^(vitest|jest|playwright|cypress)\.config\.[a-z]+$/.test(path.basename(f)) && !f.includes('/'),
  );
  const tests = [
    `- **Test files:** ${testFiles.length}`,
    `- **Runner configs:** ${runnerConfigs.length > 0 ? runnerConfigs.map(f => `\`${f}\``).join(', ') : 'none found'}`,
    ...[...new Set(testFiles.map(f => path.dirname(f)))].sort().slice(0, 30).map(d => `- \`${d}/\``),
  ];

  // --- docs -------------------------------------------------------------
  const docs: string[] = [];
  for (const doc of ['CLAUDE.md', 'AGENTS.md', 'README.md', 'docs/design-system.md']) {
    const hs = headings(path.join(root, doc));
    if (hs.length === 0) continue;
    docs.push(`### \`${doc}\``, '', ...hs.map(h => `- ${h.replace(/^#+\s*/, '')}`), '');
  }
  const designDir = path.join(root, 'docs', 'design');
  if (fs.existsSync(designDir)) {
    const designFiles = all.filter(f => isUnder(f, 'docs/design')).sort().slice(0, 40);
    docs.push('### `docs/design/`', '', ...designFiles.map(f => `- \`${f}\``), '');
  }

  const generatedAt = new Date().toISOString();
  return [
    `# Codebase map`,
    '',
    `Generated ${generatedAt} by \`stx-feature map\` for \`${root}\`.`,
    '',
    'Built **once per wave**, before any agent spawns, so that no agent has to re-walk the',
    'repository to discover what exists. This is an index, not a summary — open the files it',
    'names when you need their contents, and cite them with real line numbers.',
    '',
    section('Project', meta),
    section('Directory tree (depth 3)', directoryTree(root, 3).slice(0, 200).map(l => `    ${l}`)),
    section('Components', components),
    section('Routes', routes),
    section('Services / lib', services),
    section('Tests', tests),
    section('Project docs', docs),
  ].join('\n');
}

// =============================================================================
// CLI
// =============================================================================

const USAGE = `${Colors.bold}stx-feature${Colors.reset} — wave CLI for the /stx-feature skill

  ${Colors.cyan}render${Colors.reset} <wave-dir> [--only <a,b>] [--templates <dir>]
      Render the wave's HTML artifacts from wave-state.json, plus rebuild the
      cross-wave docs/waves/wave-wiki.html. Artifacts with no state behind them
      yet are skipped. Names: ${ARTIFACTS.join(', ')}.

  ${Colors.cyan}validate${Colors.reset} <wave-dir>
      Check wave-state.json against what the renderer needs. Exit 1 on any error.

  ${Colors.cyan}map${Colors.reset} [--root <dir>] [--out <file>]
      Write codebase-map.md. Run once per wave, before any agent spawns.

  ${Colors.cyan}brief${Colors.reset} <wave-dir> --for <${ROLES.join('|')}> [--task <id>] [--out <file>]
      Write the minimum slice of wave-state.json that one agent role needs.
      Defaults to <wave-dir>/briefs/<role>[-<task>].json.

Examples:
  stx-feature map --out docs/waves/wave-foo-a1b2/codebase-map.md
  stx-feature brief docs/waves/wave-foo-a1b2 --for architect
  stx-feature brief docs/waves/wave-foo-a1b2 --for dev --task F1-T2
  stx-feature render docs/waves/wave-foo-a1b2
  stx-feature render docs/waves/wave-foo-a1b2 --only wiki
`;

interface Flags {
  positional: string[];
  only?: string;
  templates?: string;
  root?: string;
  out?: string;
  for?: string;
  task?: string;
  help: boolean;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { positional: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`--${key} needs a value`);
      (flags as unknown as Record<string, unknown>)[key.replace(/-/g, '_')] = value;
    } else flags.positional.push(arg);
  }
  return flags;
}

function requireWaveDir(flags: Flags): string {
  const dir = flags.positional[1];
  if (!dir) throw new Error('Missing <wave-dir>. See --help.');
  if (!fs.existsSync(dir)) throw new Error(`No such directory: ${dir}`);
  return dir;
}

function readState(waveDir: string): WaveState {
  const statePath = path.join(waveDir, 'wave-state.json');
  if (!fs.existsSync(statePath)) throw new Error(`No wave-state.json in ${waveDir}`);
  return JSON.parse(fs.readFileSync(statePath, 'utf8')) as WaveState;
}

function cmdValidate(flags: Flags): number {
  const waveDir = requireWaveDir(flags);
  const errors = validateWaveState(readState(waveDir));
  if (errors.length === 0) {
    console.log(c.success(`  ✓ ${path.join(waveDir, 'wave-state.json')} is valid`));
    return 0;
  }
  console.log(c.error(`  ✗ ${path.join(waveDir, 'wave-state.json')} has ${errors.length} problem(s):`));
  for (const e of errors) console.log(c.error(`    • ${e}`));
  return 1;
}

function cmdRender(flags: Flags): number {
  const waveDir = requireWaveDir(flags);
  let only: Artifact[] | undefined;
  if (flags.only) {
    only = flags.only.split(',').map(s => s.trim()) as Artifact[];
    const bad = only.filter(a => !ARTIFACTS.includes(a));
    if (bad.length > 0) throw new Error(`Unknown artifact(s): ${bad.join(', ')}. Known: ${ARTIFACTS.join(', ')}`);
  }

  const { written, skipped } = renderWave(waveDir, resolveTemplatesDir(flags.templates), only);
  for (const file of written) console.log(c.success(`  ✓ ${c.file(file)}`));
  for (const artifact of skipped) {
    console.log(c.dim(`  · ${artifact} skipped — no state behind it yet`));
  }
  if (written.length === 0) console.log(c.warn('  ⚠ nothing rendered'));
  return 0;
}

function cmdMap(flags: Flags): number {
  const root = path.resolve(flags.root ?? process.cwd());
  const out = flags.out ?? 'codebase-map.md';
  const markdown = buildCodebaseMap(root);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, markdown, 'utf8');
  console.log(c.success(`  ✓ ${c.file(out)} ${c.dim(`(${(markdown.length / 1024).toFixed(1)} KB)`)}`));
  return 0;
}

function cmdBrief(flags: Flags): number {
  const waveDir = requireWaveDir(flags);
  const role = flags.for as Role | undefined;
  if (!role || !ROLES.includes(role)) {
    throw new Error(`--for must be one of ${ROLES.join(' | ')}`);
  }

  const state = readState(waveDir);
  const errors = validateWaveState(state);
  if (errors.length > 0) {
    throw new Error(`wave-state.json is invalid:\n${errors.map(e => `  • ${e}`).join('\n')}`);
  }

  const brief = buildBrief(state, role, flags.task);
  const name = flags.task ? `${role}-${flags.task}` : role;
  const out = flags.out ?? path.join(waveDir, 'briefs', `${name}.json`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const json = `${JSON.stringify(brief, null, 2)}\n`;
  fs.writeFileSync(out, json, 'utf8');
  console.log(c.success(`  ✓ ${c.file(out)} ${c.dim(`(${(json.length / 1024).toFixed(1)} KB)`)}`));
  return 0;
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  const command = flags.positional[0];

  if (flags.help || !command) {
    console.log(USAGE);
    process.exit(flags.help ? 0 : 1);
  }

  const commands: Record<string, (f: Flags) => number> = {
    render: cmdRender,
    validate: cmdValidate,
    map: cmdMap,
    brief: cmdBrief,
  };

  const handler = commands[command];
  if (!handler) {
    console.log(c.error(`  ✗ Unknown command "${command}". See --help.`));
    process.exit(1);
  }

  try {
    process.exit(handler(flags));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const label = error instanceof TemplateError ? 'template error' : 'error';
    console.log(c.error(`  ✗ ${label}: ${message}`));
    process.exit(1);
  }
}

if (require.main === module) main();
