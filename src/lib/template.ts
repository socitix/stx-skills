/**
 * template — the minimal Handlebars subset used by the bundled STX HTML templates.
 *
 * The `/stx-feature` templates under `.claude/skills/stx-feature/templates/` were
 * originally transcribed by an LLM. They are now rendered deterministically from
 * `wave-state.json`, which means the engine only has to support the four
 * constructs those templates actually use:
 *
 *   {{ path }}            escaped interpolation
 *   {{{ path }}}          raw interpolation (pre-built HTML, e.g. the style block)
 *   {{#each path}}…{{/each}}   iterate an array; `{{.}}` is the scalar item
 *   {{#if path}}…{{/if}}       render the body when the value is truthy
 *
 * Deliberate non-features:
 *
 * - **No scope walking.** A lookup resolves in the current scope only. Inside an
 *   `{{#each tasks}}`, `{{status}}` means the *task's* status — it can never
 *   silently fall through to the enclosing feature's status. A field the item
 *   doesn't carry is a render error, not a blank.
 * - **No `{{else}}`, no helpers, no partial syntax.** Anything conditional beyond
 *   presence belongs in the context builder, where it is testable.
 *
 * Strictness is the point. An unresolved token means the context builder and the
 * template have drifted apart, and a wave artifact that silently swallows a
 * missing field is exactly the failure this engine exists to prevent.
 */

// =============================================================================
// Types
// =============================================================================

export type Scope = unknown;

type Node =
  | { t: 'text'; v: string }
  | { t: 'var'; path: string; raw: boolean }
  | { t: 'each'; path: string; body: Node[] }
  | { t: 'if'; path: string; body: Node[] };

export interface RenderOptions {
  /** Label used in error messages (usually the template filename). */
  name?: string;
}

export class TemplateError extends Error {}

// =============================================================================
// Escaping
// =============================================================================

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

/**
 * Turn a plain-text block into paragraph HTML. Blank lines separate paragraphs;
 * single newlines become <br>. Used for the prose fields agents write into
 * wave-state.json (existing_system_impact, initial_request) so templates can
 * drop them in via a raw `{{{…}}}` slot without the agent writing any markup.
 */
export function paragraphsToHtml(text: string): string {
  const blocks = String(text ?? '')
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return '<p></p>';
  return blocks
    .map(b => `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// =============================================================================
// Parser
// =============================================================================

const TOKEN = /\{\{\{([^{}]*)\}\}\}|\{\{([^{}]*)\}\}/g;

interface Frame {
  node: { t: 'each' | 'if'; path: string; body: Node[] };
  body: Node[];
}

/**
 * Parse a template into a node tree. Block tokens push a frame; the matching
 * close pops it. An unbalanced block is a parse error — better a hard failure at
 * build time than a half-rendered artifact at wave time.
 */
export function parseTemplate(src: string, name = 'template'): Node[] {
  const root: Node[] = [];
  const stack: Frame[] = [];
  const current = (): Node[] => (stack.length ? stack[stack.length - 1].body : root);

  let last = 0;
  TOKEN.lastIndex = 0;

  for (let m = TOKEN.exec(src); m !== null; m = TOKEN.exec(src)) {
    if (m.index > last) current().push({ t: 'text', v: src.slice(last, m.index) });
    last = m.index + m[0].length;

    const raw = m[1] !== undefined;
    const expr = (raw ? m[1] : m[2]).trim();

    if (expr.startsWith('!')) continue; // {{! comment }}

    if (expr.startsWith('#')) {
      const [kind, ...rest] = expr.slice(1).trim().split(/\s+/);
      if (kind !== 'each' && kind !== 'if') {
        throw new TemplateError(`${name}: unsupported block {{#${kind}}}`);
      }
      const path = rest.join(' ').trim();
      if (!path) throw new TemplateError(`${name}: {{#${kind}}} needs a path`);
      const node = { t: kind, path, body: [] as Node[] } as Frame['node'];
      current().push(node);
      stack.push({ node, body: node.body });
      continue;
    }

    if (expr.startsWith('/')) {
      const kind = expr.slice(1).trim();
      const frame = stack.pop();
      if (!frame) throw new TemplateError(`${name}: {{/${kind}}} without an opening block`);
      if (frame.node.t !== kind) {
        throw new TemplateError(
          `${name}: {{/${kind}}} closes a {{#${frame.node.t} ${frame.node.path}}}`,
        );
      }
      continue;
    }

    current().push({ t: 'var', path: expr, raw });
  }

  if (last < src.length) current().push({ t: 'text', v: src.slice(last) });

  if (stack.length) {
    const open = stack[stack.length - 1].node;
    throw new TemplateError(`${name}: unclosed {{#${open.t} ${open.path}}}`);
  }

  return root;
}

// =============================================================================
// Lookup + render
// =============================================================================

function lookup(scope: Scope, path: string, name: string): unknown {
  if (path === '.') return scope;

  let cursor: unknown = scope;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') {
      throw new TemplateError(`${name}: cannot resolve {{${path}}} — "${segment}" has no parent object`);
    }
    if (!(segment in (cursor as Record<string, unknown>))) {
      throw new TemplateError(`${name}: unresolved {{${path}}} — no "${segment}" in this scope`);
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function stringify(value: unknown, path: string, name: string): string {
  if (value === null || value === undefined) {
    throw new TemplateError(`${name}: {{${path}}} is ${String(value)} — supply a value or an empty string`);
  }
  if (typeof value === 'object') {
    throw new TemplateError(`${name}: {{${path}}} is an object — flatten it in the context builder`);
  }
  return String(value);
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function renderNodes(nodes: Node[], scope: Scope, name: string): string {
  let out = '';

  for (const node of nodes) {
    switch (node.t) {
      case 'text':
        out += node.v;
        break;

      case 'var': {
        const value = lookup(scope, node.path, name);
        const text = stringify(value, node.path, name);
        out += node.raw ? text : escapeHtml(text);
        break;
      }

      case 'each': {
        const value = lookup(scope, node.path, name);
        if (!Array.isArray(value)) {
          throw new TemplateError(`${name}: {{#each ${node.path}}} needs an array, got ${typeof value}`);
        }
        for (const item of value) out += renderNodes(node.body, item, name);
        break;
      }

      case 'if': {
        const value = lookup(scope, node.path, name);
        if (isTruthy(value)) out += renderNodes(node.body, scope, name);
        break;
      }
    }
  }

  return out;
}

/**
 * Render a template source string against a context object.
 *
 * Throws TemplateError on any unresolved token, type mismatch, or unbalanced
 * block. Callers are expected to let that propagate — a wave artifact is not
 * worth writing if it would be wrong.
 */
export function renderTemplate(src: string, context: Record<string, unknown>, options: RenderOptions = {}): string {
  const name = options.name ?? 'template';
  return renderNodes(parseTemplate(src, name), context, name);
}
