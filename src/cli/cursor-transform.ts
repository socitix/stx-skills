/**
 * Transforms Claude Code–native skill/agent markdown for Cursor IDE at install time.
 * Source of truth stays under stx-skills/.claude/ — never edit sources for Cursor.
 */

const _SPAWN_PASTE = /\*\*Spawn:\*\* `Agent` with `subagent_type: general-purpose`(?: \(or `Explore` for read-only research first if scoping is unclear\))?\. Paste the contents of `\.cursor\/agents\/(stx-[\w-]+)\.md` into the agent's prompt verbatim, then append:/g;

const _SPAWN_PASTE_SHORT = /\*\*Spawn:\*\* `Agent` with `subagent_type: general-purpose`\. Paste the contents of `\.cursor\/agents\/(stx-[\w-]+)\.md` into the agent's prompt verbatim, then append:/g;

const _REVIEWER_SPAWN = /\*\*Spawning the Reviewer\.\*\* After every Dev hand-back, spawn the Reviewer via `Agent` with `subagent_type: general-purpose`\. Paste the contents of `\.cursor\/agents\/(stx-[\w-]+)\.md` verbatim, then append:/g;

const _FIX_QA_SPAWN = /- \*\*QA agent\*\* — spawn via `Agent` tool with `subagent_type: general-purpose` \(or a dedicated test agent if available\)\. Paste the contents of `\.cursor\/agents\/(stx-[\w-]+)\.md` into the agent's prompt verbatim, then append/g;

const _FIX_CODER_SPAWN = /- \*\*Coder agent\*\* — spawn via `Agent` tool with `subagent_type: general-purpose`\. Paste the contents of `\.cursor\/agents\/(stx-[\w-]+)\.md` into the agent's prompt verbatim, then append/g;

const _PERSONA_SPAWN_PATTERN = /Spawn pattern: `Agent` with `subagent_type: general-purpose`(?: \(or `Explore` for read-only research first if scoping is unclear\))?/g;

/** Rewrite Claude paths and APIs to Cursor equivalents. */
export function transformForCursor(content: string): string {
  let s = content;

  s = s.replace(/\.claude\/agents/g, '.cursor/agents');
  s = s.replace(/\.claude\/skills/g, '.cursor/skills');

  s = s.replace(_SPAWN_PASTE, (_m, persona: string) =>
    `**Spawn:** Launch \`Task\` with \`subagent_type: "${persona}"\`. The persona contract lives in \`.cursor/agents/${persona}.md\`. Append to the Task prompt:`,
  );
  s = s.replace(_SPAWN_PASTE_SHORT, (_m, persona: string) =>
    `**Spawn:** Launch \`Task\` with \`subagent_type: "${persona}"\`. The persona contract lives in \`.cursor/agents/${persona}.md\`. Append to the Task prompt:`,
  );
  s = s.replace(_REVIEWER_SPAWN, (_m, persona: string) =>
    `**Spawning the Reviewer.** After every Dev hand-back, launch \`Task\` with \`subagent_type: "${persona}"\`. Append to the Task prompt:`,
  );
  s = s.replace(_FIX_QA_SPAWN, (_m, persona: string) =>
    `- **QA agent** — launch \`Task\` with \`subagent_type: "${persona}"\`. Append to the Task prompt`,
  );
  s = s.replace(_FIX_CODER_SPAWN, (_m, persona: string) =>
    `- **Coder agent** — launch \`Task\` with \`subagent_type: "${persona}"\`. Append to the Task prompt`,
  );

  s = s.replace(_PERSONA_SPAWN_PATTERN,
    'Spawn pattern: `Task` with matching persona `subagent_type` (see `.cursor/agents/`)',
  );
  s = s.replace(
    /Spawn pattern: `Agent` with `subagent_type: general-purpose`/g,
    'Spawn pattern: `Task` with matching persona `subagent_type` (see `.cursor/agents/`)',
  );

  s = s.replace(/\bAskUserQuestion\b/g, 'AskQuestion');
  s = s.replace(/\bAgent tool\b/g, 'Task tool');
  s = s.replace(/spawn via `Agent`/g, 'spawn via `Task`');
  s = s.replace(/spawn the Reviewer via `Agent`/g, 'spawn the Reviewer via `Task`');
  s = s.replace(/`Agent` with/g, '`Task` with');
  s = s.replace(/`Task` with `subagent_type: general-purpose`/g, '`Task` with `subagent_type: generalPurpose`');

  s = s.replace(
    /Each Dev agent is spawned with a tier-specialized prompt assembled from two persona files:/g,
    'Each Dev agent is spawned via `Task` with `subagent_type: generalPurpose`. The Task prompt must concatenate the two persona files:',
  );

  return s;
}

/** Add Cursor slash-command frontmatter when installing skills. */
export function addCursorSkillFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('---', 3);
  if (end === -1) return content;
  const fm = content.slice(0, end + 3);
  const body = content.slice(end + 3);
  if (fm.includes('disable-model-invocation')) return content;
  const updated = fm.replace(/\n---$/, '\ndisable-model-invocation: true\n---');
  return updated + body;
}

export function shouldTransformForCursor(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return ext === '.md' || ext === '.html';
}
